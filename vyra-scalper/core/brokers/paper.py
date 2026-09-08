"""Paper trading adapter.

Live market data, simulated fills. The point of paper trading is that **only the adapter
differs from live**: the same strategies, features, risk engine and execution engine run
against the same feed, and orders stop at this boundary instead of reaching a venue
(``ARCHITECTURE.md`` §2).

It is built on :class:`~core.brokers.simulated.SimulatedBrokerAdapter` because the matching
logic should be identical to the backtester's — a paper result that disagreed with a
backtest over the same data would tell you nothing about either. What this class adds is
the behaviour a *live* adapter has and a backtest adapter does not: a connection that can
drop, a heartbeat, wall-clock latency measurement, and a hard guarantee that nothing
leaves the process.

Shadow mode is the same object with :attr:`shadow` set: it builds the real production
order and records what would have happened, without even simulating a fill.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.brokers.base import (
    AccountSnapshot,
    BrokerCapabilities,
    BrokerError,
    BrokerErrorCode,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderAmendment,
    OrderRequest,
)
from core.brokers.simulated import SimulatedBrokerAdapter
from core.events import Event, ExecutionMode, FillEvent
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.instruments.instrument import Instrument
from core.util.clock import NS_PER_MS, NS_PER_SEC, Nanos, now_ns
from core.util.logging import get_logger

__all__ = ["PaperBrokerAdapter", "ShadowRecord"]

_log = get_logger("brokers.paper")


@dataclass(frozen=True, slots=True)
class ShadowRecord:
    """What a shadow-mode order *would* have done.

    Recorded instead of simulated. Comparing these against a parallel paper run — same
    signals, same risk decisions, fills simulated — is what tells you whether the fill
    model is optimistic before capital is at risk (``ARCHITECTURE.md`` §2).
    """

    ts: Nanos
    client_order_id: str
    instrument_id: str
    strategy_id: str
    side: str
    quantity: float
    order_type: str
    limit_price: float | None
    stop_price: float | None
    bid_at_decision: float | None
    ask_at_decision: float | None
    would_have_filled_at: float | None

    def to_dict(self) -> dict[str, Any]:
        from dataclasses import asdict

        return asdict(self)


class PaperBrokerAdapter(SimulatedBrokerAdapter):
    """Simulated fills against a live feed. Orders never leave the process.

    Args:
        shadow: when ``True``, orders are recorded and never matched. The engine still
            builds them, sizes them and routes them, so every code path except the venue
            call is exercised.
        heartbeat_timeout_s: how long without a market event before the connection is
            considered stale. A live adapter's connection can die silently; a backtest
            adapter's cannot, which is exactly the difference paper trading exists to test.
    """

    def __init__(
        self,
        instruments: dict[str, Instrument],
        cost_model: CostModel,
        fill_simulator: FillSimulator | None = None,
        starting_equity: float = 100_000.0,
        order_latency_ns: int = 1_500_000,
        cancel_latency_ns: int = 1_500_000,
        seed: int = 0,
        shadow: bool = False,
        heartbeat_timeout_s: float = 30.0,
    ) -> None:
        super().__init__(
            instruments=instruments,
            cost_model=cost_model,
            fill_simulator=fill_simulator,
            starting_equity=starting_equity,
            order_latency_ns=order_latency_ns,
            cancel_latency_ns=cancel_latency_ns,
            seed=seed,
            broker_id="shadow" if shadow else "paper",
        )
        self._shadow = shadow
        self._heartbeat_timeout_ns = int(heartbeat_timeout_s * NS_PER_SEC)
        self._last_event_ns: Nanos = 0
        self._connected_at_ns: Nanos = 0
        self._shadow_records: list[ShadowRecord] = []
        self._submit_latencies_ms: list[float] = []

    # -- identity -----------------------------------------------------------------------

    @property
    def mode(self) -> ExecutionMode:
        return ExecutionMode.SHADOW if self._shadow else ExecutionMode.PAPER

    @property
    def shadow(self) -> bool:
        return self._shadow

    @property
    def shadow_records(self) -> tuple[ShadowRecord, ...]:
        return tuple(self._shadow_records)

    @property
    def capabilities(self) -> BrokerCapabilities:
        """Identical to the simulated adapter's.

        Paper trading that permitted order types the intended live venue does not would
        validate a strategy that cannot be deployed. When a live venue is configured, its
        capabilities should be mirrored here.
        """
        return super().capabilities

    # -- connection ---------------------------------------------------------------------

    def connect(self) -> None:
        super().connect()
        self._connected_at_ns = now_ns()
        self._last_event_ns = 0
        _log.info("paper_broker_connected", broker=self.broker_id, shadow=self._shadow)

    def health_check(self) -> BrokerHealth:
        """Report connectivity, including a feed that has gone quiet.

        A live connection can be open at the socket level while delivering nothing. Paper
        mode models that, so the operational response is exercised before it matters.
        """
        wall_now = now_ns()
        if not self._connected:
            return BrokerHealth(connected=False, ts=wall_now, message="not connected")

        if self._last_event_ns == 0:
            return BrokerHealth(
                connected=True, ts=wall_now, latency_ms=self._average_latency_ms(),
                message="connected, no market data yet",
                last_heartbeat_ns=self._connected_at_ns,
            )

        silence_ns = wall_now - self._last_event_ns
        if silence_ns > self._heartbeat_timeout_ns:
            return BrokerHealth(
                connected=False,
                ts=wall_now,
                latency_ms=self._average_latency_ms(),
                message=(
                    f"no market data for {silence_ns / NS_PER_SEC:.1f}s "
                    f"(timeout {self._heartbeat_timeout_ns / NS_PER_SEC:.0f}s)"
                ),
                last_heartbeat_ns=self._last_event_ns,
            )
        return BrokerHealth(
            connected=True, ts=wall_now, latency_ms=self._average_latency_ms(),
            last_heartbeat_ns=self._last_event_ns,
        )

    def _average_latency_ms(self) -> float | None:
        if not self._submit_latencies_ms:
            return None
        return sum(self._submit_latencies_ms) / len(self._submit_latencies_ms)

    # -- order entry --------------------------------------------------------------------

    def submit_order(self, request: OrderRequest) -> OrderAck:
        """Accept an order.

        In paper mode it enters the simulated book. In shadow mode it is recorded and
        acknowledged but never matched — the engine sees a working order that will never
        fill, which is the honest simulation of "we did not send this".
        """
        start = now_ns()
        ack = self._record_shadow(request) if self._shadow else super().submit_order(request)
        self._submit_latencies_ms.append((now_ns() - start) / NS_PER_MS)
        if len(self._submit_latencies_ms) > 1_000:
            del self._submit_latencies_ms[: len(self._submit_latencies_ms) // 2]
        return ack

    def _record_shadow(self, request: OrderRequest) -> OrderAck:
        self._require_connected()
        if request.instrument_id not in self._instruments:
            return self._reject(request, BrokerErrorCode.INVALID_CONTRACT, "unknown instrument")

        # Idempotency applies in shadow mode too. A resubmitted client order id must not
        # produce a second record, or the counterfactual would count a position twice and
        # the comparison against a paper run would be wrong in exactly the direction that
        # flatters the strategy.
        known = self._accepted_ids.get(request.client_order_id)
        if known is not None:
            _log.warning(
                "duplicate_client_order_id",
                client_order_id=request.client_order_id,
                broker_order_id=known,
                shadow=True,
            )
            return OrderAck(
                client_order_id=request.client_order_id,
                broker_order_id=known,
                accepted=True,
                ts=self._now,
                reason="IDEMPOTENT_REPLAY",
            )

        quote = self._quotes.get(request.instrument_id)
        would_fill: float | None = None
        if quote is not None and quote.is_two_sided:
            would_fill = quote.far_touch(request.side.value == "BUY")

        self._order_counter += 1
        broker_order_id = f"SHADOW-{self._order_counter:08d}"
        self._accepted_ids[request.client_order_id] = broker_order_id
        self._shadow_records.append(
            ShadowRecord(
                ts=self._now,
                client_order_id=request.client_order_id,
                instrument_id=request.instrument_id,
                strategy_id=request.strategy_id,
                side=request.side.value,
                quantity=request.quantity,
                order_type=request.order_type.value,
                limit_price=request.limit_price,
                stop_price=request.stop_price,
                bid_at_decision=quote.bid if quote else None,
                ask_at_decision=quote.ask if quote else None,
                would_have_filled_at=would_fill,
            )
        )
        _log.info(
            "shadow_order_recorded",
            client_order_id=request.client_order_id,
            instrument=request.instrument_id,
            side=request.side.value,
            quantity=request.quantity,
            would_have_filled_at=would_fill,
        )
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id=broker_order_id,
            accepted=True,
            ts=self._now,
            reason="SHADOW_RECORDED",
        )

    def cancel_order(self, client_order_id: str) -> None:
        if self._shadow:
            # Nothing rests in shadow mode, so a cancel is a no-op for a known id and an
            # error for an unknown one — the same contract a real venue offers.
            self._require_connected()
            if client_order_id not in self._accepted_ids:
                raise BrokerError(
                    BrokerErrorCode.UNKNOWN_ORDER, f"no order {client_order_id!r}"
                )
            return
        super().cancel_order(client_order_id)

    def replace_order(self, client_order_id: str, changes: OrderAmendment) -> OrderAck:
        if self._shadow:
            self._require_connected()
            if client_order_id not in self._accepted_ids:
                raise BrokerError(
                    BrokerErrorCode.UNKNOWN_ORDER, f"no order {client_order_id!r}"
                )
            return OrderAck(
                client_order_id=client_order_id,
                broker_order_id=self._accepted_ids[client_order_id],
                accepted=True,
                ts=self._now,
                reason="SHADOW_RECORDED",
            )
        return super().replace_order(client_order_id, changes)

    # -- market data --------------------------------------------------------------------

    def advance(self, event: Event) -> list[FillEvent]:
        """Feed a live market event in, and match resting orders against it.

        Shadow mode records the event for quote context but never matches: an order that
        was never sent cannot fill.
        """
        self._last_event_ns = now_ns()
        if self._shadow:
            from core.events import QuoteEvent

            self._now = max(self._now, event.ts)
            if isinstance(event, QuoteEvent):
                self._quotes[event.instrument_id] = event
            return []
        return super().advance(event)

    def get_positions(self) -> dict[str, BrokerPosition]:
        """Positions.

        Always empty in shadow mode: nothing was sent, so nothing is held. Reporting a
        simulated position here would make the shadow book diverge from the real account
        it is shadowing.
        """
        if self._shadow:
            self._require_connected()
            return {}
        return super().get_positions()

    def get_account(self) -> AccountSnapshot:
        if self._shadow:
            self._require_connected()
            return AccountSnapshot(
                account_id="SHADOW",
                equity=self._starting_equity,
                cash=self._starting_equity,
                currency="USD",
                ts=self._now,
            )
        return super().get_account()

    def flatten_all(self) -> None:
        if self._shadow:
            _log.info("shadow_flatten_all_noop", broker=self.broker_id)
            return
        super().flatten_all()
