"""The kill switch at the venue boundary.

The execution engine already refuses to submit while the switch is tripped
(``core/execution/engine.py``). This is the same rule enforced one layer lower, at the last
object before a socket, and it exists because the two failure modes are different:

* the engine's check protects against *the engine deciding wrongly*;
* this one protects against *anything reaching the adapter without going through the
  engine* — a script, a reconciliation path, a future component, a bug.

The guard **fails closed**. If halt state cannot be read at all — a dead Redis, a corrupt
state file, an exception from the source — the adapter behaves exactly as if the switch
were tripped. An unknown halt state is not a safe state, and the only failure this class
can afford is the one that stops trading it should have allowed.

What a halt does *not* block is as important as what it does. Cancels and flattens are
always permitted: a switch that stranded open exposure at a venue would make tripping it
more dangerous than leaving it armed, which would eventually teach an operator not to trip
it. Only calls that can open or increase exposure are refused.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from core.brokers.base import (
    AccountSnapshot,
    BrokerAdapter,
    BrokerCapabilities,
    BrokerError,
    BrokerErrorCode,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderAmendment,
    OrderRequest,
)
from core.risk.kill_switch import KillSwitch
from core.util.logging import get_logger

__all__ = ["GuardStats", "GuardedBrokerAdapter", "HaltSource", "LocalHaltSource"]

_log = get_logger("brokers.guard")


@runtime_checkable
class HaltSource(Protocol):
    """Where the guard reads halt state from.

    Deliberately narrower than :class:`~core.risk.kill_switch.KillSwitch`: the guard needs
    two booleans and nothing else, so a cross-process source (a shared store, a cache) can
    satisfy it without reimplementing the switch's lifecycle. Raising from either method is
    a valid answer — the guard reads it as "halted".
    """

    def is_halted(self) -> bool: ...

    def allows_risk_reducing_exit(self) -> bool: ...

    @property
    def description(self) -> str:
        """Where this state came from, for the refusal message and the audit trail."""


class LocalHaltSource:
    """Halt state from an in-process :class:`KillSwitch`.

    Correct only while every component that can trade shares this one object. A second
    process holding its own switch is not halted by this one — that is what the shared
    store in ``core.storage`` is for.
    """

    __slots__ = ("_switch",)

    def __init__(self, switch: KillSwitch) -> None:
        self._switch = switch

    def is_halted(self) -> bool:
        return self._switch.is_tripped

    def allows_risk_reducing_exit(self) -> bool:
        return self._switch.allows_risk_reducing_exit()

    @property
    def description(self) -> str:
        return f"in-process kill switch ({self._switch.state.value})"


class GuardStats:
    """What the guard did. Counted because a guard nobody can observe is a guard nobody
    trusts, and because "blocked while halted" is a metric worth exporting."""

    __slots__ = ("blocked_reduce_only", "blocked_submissions", "passed", "read_failures")

    def __init__(self) -> None:
        self.blocked_submissions = 0
        self.blocked_reduce_only = 0
        self.read_failures = 0
        self.passed = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "blocked_submissions": self.blocked_submissions,
            "blocked_reduce_only": self.blocked_reduce_only,
            "read_failures": self.read_failures,
            "passed": self.passed,
        }


class GuardedBrokerAdapter(BrokerAdapter):
    """Any adapter, with the halt rule enforced on the way out.

    Wrapping rather than subclassing each adapter is deliberate: the rule is identical for
    every venue, and a rule reimplemented per adapter is a rule that will differ per
    adapter.
    """

    __slots__ = ("_inner", "_source", "_stats")

    def __init__(self, inner: BrokerAdapter, source: HaltSource) -> None:
        self._inner = inner
        self._source = source
        self._stats = GuardStats()

    @property
    def inner(self) -> BrokerAdapter:
        """The wrapped adapter. For tests and reconciliation, never to bypass the guard."""
        return self._inner

    @property
    def stats(self) -> GuardStats:
        return self._stats

    # -- the rule -----------------------------------------------------------------------

    def _halt_state(self) -> tuple[bool, bool]:
        """``(halted, exits_allowed)``, with any failure read as halted.

        A source that raises is a source that cannot tell us trading is safe. The read
        failure is logged at CRITICAL with a reason code, because a guard silently failing
        closed looks identical to a venue that has gone quiet.
        """
        try:
            halted = self._source.is_halted()
            exits = self._source.allows_risk_reducing_exit() if halted else True
        except Exception as exc:
            self._stats.read_failures += 1
            _log.critical(
                "halt_state_unreadable",
                source=self._safe_description(),
                detail=str(exc),
                reason_codes=["KILL_SWITCH_STATE_UNREADABLE"],
            )
            # Exits are refused too: if we cannot read the switch we cannot know the
            # emergency policy, and guessing FLATTEN would send orders on no evidence.
            return True, False
        return halted, exits

    def _safe_description(self) -> str:
        try:
            return self._source.description
        except Exception:  # pragma: no cover - a description that raises is still a source
            return "<unavailable>"

    def _refuse(self, action: str, detail: str) -> BrokerError:
        _log.critical(
            "outbound_call_blocked_by_kill_switch",
            broker=self._inner.broker_id,
            action=action,
            source=self._safe_description(),
            reason_codes=["KILL_SWITCH_ACTIVE"],
        )
        return BrokerError(
            BrokerErrorCode.KILL_SWITCH_ACTIVE,
            f"{action} refused: {detail}",
            venue_detail=self._safe_description(),
        )

    # -- guarded calls ------------------------------------------------------------------

    def submit_order(self, request: OrderRequest) -> OrderAck:
        halted, exits_allowed = self._halt_state()
        if halted:
            if not request.reduce_only:
                self._stats.blocked_submissions += 1
                raise self._refuse("submit_order", "trading is halted")
            if not exits_allowed:
                self._stats.blocked_reduce_only += 1
                raise self._refuse(
                    "submit_order",
                    "trading is halted and the emergency policy does not permit exits",
                )
        self._stats.passed += 1
        return self._inner.submit_order(request)

    def replace_order(self, client_order_id: str, changes: OrderAmendment) -> OrderAck:
        """Refused outright while halted.

        A replace can raise quantity or move a limit to a worse price, and the guard cannot
        see the resting order to tell. Cancelling is always available, so refusing costs an
        operator nothing they cannot do another way.
        """
        halted, _ = self._halt_state()
        if halted:
            self._stats.blocked_submissions += 1
            raise self._refuse("replace_order", "trading is halted")
        self._stats.passed += 1
        return self._inner.replace_order(client_order_id, changes)

    # -- always permitted ---------------------------------------------------------------
    #
    # Reducing or closing exposure, and every read. A halt that stranded open positions at
    # a venue would make tripping the switch the more dangerous choice.

    def cancel_order(self, client_order_id: str) -> None:
        self._inner.cancel_order(client_order_id)

    def flatten_position(self, instrument_id: str) -> None:
        self._inner.flatten_position(instrument_id)

    def flatten_all(self) -> None:
        self._inner.flatten_all()

    @property
    def broker_id(self) -> str:
        return self._inner.broker_id

    @property
    def capabilities(self) -> BrokerCapabilities:
        return self._inner.capabilities

    def connect(self) -> None:
        self._inner.connect()

    def disconnect(self) -> None:
        self._inner.disconnect()

    def health_check(self) -> BrokerHealth:
        return self._inner.health_check()

    def get_account(self) -> AccountSnapshot:
        return self._inner.get_account()

    def get_positions(self) -> dict[str, BrokerPosition]:
        return self._inner.get_positions()

    def get_orders(self) -> dict[str, OrderRequest]:
        return self._inner.get_orders()

    def subscribe_quotes(self, instrument_ids: list[str]) -> None:
        self._inner.subscribe_quotes(instrument_ids)

    def subscribe_trades(self, instrument_ids: list[str]) -> None:
        self._inner.subscribe_trades(instrument_ids)

    def subscribe_orderbook(self, instrument_ids: list[str]) -> None:
        self._inner.subscribe_orderbook(instrument_ids)

    def subscribe_account_updates(self) -> None:
        self._inner.subscribe_account_updates()
