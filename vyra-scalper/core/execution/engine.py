"""The execution engine.

Turns approved signals into venue orders, applying the entry policy, negotiating venue
capabilities, enforcing timeouts and re-checking the kill switch immediately before every
submission (``EXECUTION_SPEC.md``).

Two properties worth stating plainly:

* **The kill switch is re-checked at submission time**, not only at risk time.  State can
  change between the decision and the send, and the send is the last moment that matters.
* **Retries never fire blind.** After an ambiguous failure the engine queries venue state
  first.  Resubmitting without asking is how a timeout that actually arrived becomes two
  positions.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from core.brokers.base import (
    BrokerAdapter,
    BrokerError,
    OrderAck,
    OrderRequest,
)
from core.events import (
    FillEvent,
    OrderState,
    OrderType,
    QuoteEvent,
    Side,
    TimeInForce,
)
from core.execution.order_manager import ManagedOrder, OrderManager
from core.instruments.instrument import Instrument
from core.risk.engine import RiskDecision
from core.risk.kill_switch import KillSwitch
from core.signals.signal import EntryType, Signal
from core.util.clock import NS_PER_MS, Nanos
from core.util.logging import get_logger

__all__ = ["EntryPolicy", "ExecutionConfig", "ExecutionEngine", "SubmissionResult"]

_log = get_logger("execution.engine")


class EntryPolicy(StrEnum):
    """How aggressively to seek a fill (``EXECUTION_SPEC.md`` §3)."""

    MARKET = "MARKET"
    MARKETABLE_LIMIT = "MARKETABLE_LIMIT"
    SMART_LIMIT = "SMART_LIMIT"
    PASSIVE_LIMIT = "PASSIVE_LIMIT"


@dataclass(frozen=True, slots=True)
class ExecutionConfig:
    """Execution policy, loaded from ``execution.yaml``."""

    entry_policy: EntryPolicy = EntryPolicy.MARKETABLE_LIMIT
    exit_policy: EntryPolicy = EntryPolicy.MARKET
    aggression_ticks: float = 1.0
    entry_timeout_ms: float = 3000.0
    passive_timeout_ms: float = 10000.0
    max_retries: int = 2
    backoff_ms: tuple[float, ...] = (250.0, 1000.0)
    allow_stacking: bool = False
    query_state_before_retry: bool = True
    slippage_alert_ticks: float = 5.0
    latency_alert_ms: float = 500.0
    max_reject_rate: float = 0.2
    reject_rate_window: int = 20

    @classmethod
    def from_config(cls, section) -> ExecutionConfig:  # type: ignore[no-untyped-def]
        marketable = section.section("marketable_limit", required=False)
        passive = section.section("passive_limit", required=False)
        retry = section.section("retry", required=False)
        duplicate = section.section("duplicate_protection", required=False)
        monitoring = section.section("monitoring", required=False)
        return cls(
            entry_policy=EntryPolicy(section.str_("entry_policy", "MARKETABLE_LIMIT")),
            exit_policy=EntryPolicy(section.str_("exit_policy", "MARKET")),
            aggression_ticks=marketable.float_("aggression_ticks", 1.0),
            entry_timeout_ms=marketable.float_("timeout_ms", 3000.0),
            passive_timeout_ms=passive.float_("timeout_ms", 10000.0),
            max_retries=retry.int_("max_retries", 2),
            backoff_ms=tuple(float(x) for x in retry.list_("backoff_ms", [250.0, 1000.0])),
            allow_stacking=duplicate.bool_("allow_stacking", False),
            query_state_before_retry=duplicate.bool_("idempotent_client_order_id", True),
            slippage_alert_ticks=monitoring.float_("slippage_alert_ticks", 5.0),
            latency_alert_ms=monitoring.float_("latency_alert_ms", 500.0),
            max_reject_rate=monitoring.float_("max_reject_rate", 0.2),
        )


@dataclass(frozen=True, slots=True)
class SubmissionResult:
    """The outcome of attempting to place one order."""

    order: ManagedOrder | None
    submitted: bool
    reason: str = ""

    @property
    def blocked(self) -> bool:
        return not self.submitted


class ExecutionEngine:
    """Places and manages orders on behalf of approved signals."""

    __slots__ = (
        "_broker",
        "_config",
        "_instruments",
        "_kill_switch",
        "_order_manager",
        "_recent_outcomes",
    )

    def __init__(
        self,
        broker: BrokerAdapter,
        order_manager: OrderManager,
        instruments: dict[str, Instrument],
        kill_switch: KillSwitch,
        config: ExecutionConfig | None = None,
    ) -> None:
        self._broker = broker
        self._order_manager = order_manager
        self._instruments = instruments
        self._kill_switch = kill_switch
        self._config = config or ExecutionConfig()
        self._recent_outcomes: list[bool] = []

    @property
    def order_manager(self) -> OrderManager:
        return self._order_manager

    @property
    def config(self) -> ExecutionConfig:
        return self._config

    # -- submission ---------------------------------------------------------------------

    def submit(
        self,
        signal: Signal,
        decision: RiskDecision,
        quote: QuoteEvent | None,
        ts: Nanos,
    ) -> SubmissionResult:
        """Place an order for an approved signal.

        Returns a :class:`SubmissionResult` rather than raising, so one blocked order does
        not abort the event loop.  Every blocked path carries a reason.
        """
        if not decision.permits_order:
            return SubmissionResult(None, False, "RISK_DECISION_DOES_NOT_PERMIT")

        # Re-checked here, not just at risk time: state can change between the decision
        # and the send, and the send is the last moment that matters.  Entries are always
        # blocked when tripped; an exit is blocked only under a policy that says hold.
        if self._kill_switch.is_tripped and (
            signal.is_entry or not self._kill_switch.allows_risk_reducing_exit()
        ):
            return SubmissionResult(None, False, "KILL_SWITCH_ACTIVE")

        instrument = self._instruments.get(signal.instrument_id)
        if instrument is None:
            return SubmissionResult(None, False, "UNKNOWN_INSTRUMENT")

        if (
            signal.is_entry
            and not self._config.allow_stacking
            and self._order_manager.has_in_flight(
                signal.strategy_id, signal.instrument_id, signal.direction
            )
        ):
            return SubmissionResult(None, False, "DUPLICATE_IN_FLIGHT")

        plan = self._plan_order(signal, instrument, quote)
        if plan is None:
            return SubmissionResult(None, False, "NO_EXECUTABLE_PRICE")
        order_type, tif, limit_price, stop_price, timeout_ms = plan

        negotiated = self._negotiate(order_type, tif)
        if negotiated is None:
            _log.warning(
                "unsupported_order_type",
                broker=self._broker.broker_id,
                order_type=order_type.value,
                time_in_force=tif.value,
            )
            return SubmissionResult(None, False, "UNSUPPORTED_ORDER_TYPE")
        order_type, tif = negotiated
        if order_type is OrderType.MARKET:
            limit_price = None

        order = self._order_manager.create(
            signal=signal,
            decision=decision,
            exchange=instrument.exchange,
            order_type=order_type,
            time_in_force=tif,
            limit_price=limit_price,
            stop_price=stop_price,
            ts=ts,
            decision_price=quote.mid if quote and quote.is_two_sided else None,
            expires_at_ns=ts + int(timeout_ms * NS_PER_MS) if timeout_ms > 0 else 0,
        )
        return self._send(order, ts)

    def _plan_order(
        self, signal: Signal, instrument: Instrument, quote: QuoteEvent | None
    ) -> tuple[OrderType, TimeInForce, float | None, float | None, float] | None:
        """Map the signal's entry preference and the configured policy onto an order."""
        policy = self._config.exit_policy if not signal.is_entry else self._config.entry_policy
        if signal.entry_type is EntryType.MARKET:
            policy = EntryPolicy.MARKET

        if policy is EntryPolicy.MARKET:
            return OrderType.MARKET, TimeInForce.DAY, None, None, 0.0

        buying = signal.direction is Side.BUY
        tick = instrument.tick_size

        if policy in (EntryPolicy.MARKETABLE_LIMIT, EntryPolicy.SMART_LIMIT):
            if quote is not None and quote.is_two_sided:
                far = quote.far_touch(buying)
                near = quote.near_touch(buying)
                if policy is EntryPolicy.MARKETABLE_LIMIT:
                    # Cross beyond the far touch: high fill probability with a bounded
                    # worst-case price, which is the point of a marketable limit.
                    price = far + (self._config.aggression_ticks * tick * (1 if buying else -1))
                else:
                    price = near
            else:
                price = signal.suggested_entry
            return (
                OrderType.LIMIT,
                TimeInForce.DAY,
                instrument.round_price(price),
                None,
                self._config.entry_timeout_ms,
            )

        # PASSIVE_LIMIT
        price = quote.near_touch(buying) if quote and quote.is_two_sided else signal.suggested_entry
        return (
            OrderType.LIMIT,
            TimeInForce.DAY,
            instrument.round_price(price),
            None,
            self._config.passive_timeout_ms,
        )

    def _negotiate(
        self, order_type: OrderType, tif: TimeInForce
    ) -> tuple[OrderType, TimeInForce] | None:
        """Check venue capability, downgrading along a declared path where possible.

        Returns ``None`` when no supported form exists.  The engine never sends an order
        type the venue has told us it will refuse.
        """
        capabilities = self._broker.capabilities
        if capabilities.supports(order_type, tif):
            return order_type, tif

        if order_type in capabilities.order_types and tif not in capabilities.time_in_force:
            if TimeInForce.DAY in capabilities.time_in_force:
                _log.info("tif_downgraded", requested=tif.value, applied="DAY")
                return order_type, TimeInForce.DAY
            if TimeInForce.GTC in capabilities.time_in_force:
                _log.info("tif_downgraded", requested=tif.value, applied="GTC")
                return order_type, TimeInForce.GTC

        if order_type is OrderType.LIMIT and OrderType.MARKET in capabilities.order_types:
            # A declared, logged downgrade: certainty of fill in exchange for price.
            for candidate in (tif, TimeInForce.DAY, TimeInForce.GTC):
                if candidate in capabilities.time_in_force:
                    _log.warning(
                        "order_type_downgraded", requested="LIMIT", applied="MARKET",
                        reason="venue does not support LIMIT",
                    )
                    return OrderType.MARKET, candidate
        return None

    def _send(self, order: ManagedOrder, ts: Nanos) -> SubmissionResult:
        """Submit to the venue, with the retry policy applied to transient failures."""
        request = OrderRequest(
            client_order_id=order.client_order_id,
            instrument_id=order.instrument_id,
            side=order.side,
            quantity=order.quantity,
            order_type=order.order_type,
            time_in_force=order.time_in_force,
            limit_price=order.limit_price,
            stop_price=order.stop_price,
            strategy_id=order.strategy_id,
            ts_created=order.ts_created,
            # Carried to the venue boundary so the guard there can apply the same rule
            # this engine applied above, without having to see the signal.
            reduce_only=not order.is_entry,
        )

        order.transition(OrderState.SUBMITTED, ts)
        order.ts_submitted = ts

        ack = self._attempt(request, order, ts)
        if ack is None:
            # Ambiguous outcome: the order may or may not exist at the venue.  UNKNOWN is
            # a real state resolved by reconciliation, not a guess in either direction.
            order.transition(OrderState.UNKNOWN, ts, "AMBIGUOUS_SUBMISSION")
            self._record_outcome(False)
            return SubmissionResult(order, False, "AMBIGUOUS_SUBMISSION")

        if not ack.accepted:
            self._order_manager.on_terminal(
                order, OrderState.REJECTED_BROKER, ts, ack.reason or "BROKER_REJECT"
            )
            self._record_outcome(False)
            return SubmissionResult(order, False, ack.reason or "BROKER_REJECT")

        self._order_manager.on_ack(order, ack.broker_order_id, ts)
        self._record_outcome(True)
        _log.info(
            "order_submitted",
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            instrument=order.instrument_id,
            side=order.side.value,
            quantity=order.quantity,
            order_type=order.order_type.value,
            limit_price=order.limit_price,
        )
        return SubmissionResult(order, True)

    def _attempt(
        self, request: OrderRequest, order: ManagedOrder, ts: Nanos
    ) -> OrderAck | None:
        """Submit with retries.  ``None`` means the outcome is genuinely unknown."""
        for attempt in range(self._config.max_retries + 1):
            try:
                return self._broker.submit_order(request)
            except BrokerError as exc:
                if not exc.is_transient or attempt >= self._config.max_retries:
                    return OrderAck(
                        client_order_id=request.client_order_id,
                        broker_order_id="",
                        accepted=False,
                        ts=ts,
                        reason=exc.message,
                        error_code=exc.code,
                    )
                # Before retrying, ask the venue whether the previous attempt landed.
                # Retrying blind is how one timeout becomes two positions.
                if self._config.query_state_before_retry and self._order_arrived(request):
                    _log.warning(
                        "retry_aborted_order_already_at_venue",
                        client_order_id=request.client_order_id,
                    )
                    return OrderAck(
                        client_order_id=request.client_order_id,
                        broker_order_id="",
                        accepted=True,
                        ts=ts,
                        reason="ALREADY_AT_VENUE",
                    )
                order.attempt = attempt + 1
                _log.warning(
                    "order_submit_retry",
                    client_order_id=request.client_order_id,
                    attempt=attempt + 1,
                    error_code=exc.code.value,
                )
        return None

    def _order_arrived(self, request: OrderRequest) -> bool:
        """Whether the venue already knows this client order id.

        A failure to answer is treated as "unknown", never as "no": assuming absence is
        what produces the duplicate.
        """
        checker = getattr(self._broker, "is_known_order", None)
        if callable(checker):
            try:
                return bool(checker(request.client_order_id))
            except BrokerError:
                return True
        try:
            return request.client_order_id in self._broker.get_orders()
        except BrokerError:
            return True

    # -- lifecycle management ------------------------------------------------------------

    def on_fill(self, fill: FillEvent) -> ManagedOrder | None:
        """Route a fill to its order and record execution quality."""
        order = self._order_manager.by_client_id(fill.client_order_id)
        if order is None:
            _log.error(
                "fill_for_unknown_order",
                client_order_id=fill.client_order_id,
                instrument=fill.instrument_id,
                quantity=fill.quantity,
                reason_codes=["UNKNOWN_POSITION"],
            )
            return None
        self._order_manager.on_fill(order, fill)
        self._check_execution_quality(order, fill)
        return order

    def _check_execution_quality(self, order: ManagedOrder, fill: FillEvent) -> None:
        """Alert on abnormal slippage or latency.

        Reports only.  Whether an anomaly trips the kill switch is the risk engine's
        decision, kept in one place so the triggers stay auditable.
        """
        instrument = self._instruments.get(fill.instrument_id)
        if instrument is None:
            return
        slippage = fill.slippage_vs_expected(instrument.tick_size)
        if slippage is not None and slippage > self._config.slippage_alert_ticks:
            _log.warning(
                "abnormal_slippage",
                order_id=order.order_id,
                instrument=fill.instrument_id,
                slippage_ticks=round(slippage, 4),
                threshold=self._config.slippage_alert_ticks,
            )
        if order.ts_signal and fill.ts_fill:
            latency_ms = (fill.ts_fill - order.ts_signal) / NS_PER_MS
            if latency_ms > self._config.latency_alert_ms:
                _log.warning(
                    "abnormal_latency",
                    order_id=order.order_id,
                    signal_to_fill_ms=round(latency_ms, 3),
                    threshold=self._config.latency_alert_ms,
                )

    def cancel_expired(self, ts: Nanos) -> list[ManagedOrder]:
        """Cancel orders whose timeout has elapsed.

        An expired order is cancelled, not re-entered: whether the opportunity is still
        there is the strategy's judgement, not the execution engine's.
        """
        expired = self._order_manager.expired_orders(ts)
        for order in expired:
            try:
                self._broker.cancel_order(order.client_order_id)
            except BrokerError as exc:
                _log.warning(
                    "cancel_failed",
                    order_id=order.order_id,
                    error_code=exc.code.value,
                    message=exc.message,
                )
                continue
            state = (
                OrderState.EXPIRED if order.filled_qty == 0 else OrderState.CANCELLED
            )
            self._order_manager.on_terminal(order, state, ts, "ENTRY_TIMEOUT")
        return expired

    def cancel_all(self, ts: Nanos, reason: str = "KILL_SWITCH") -> int:
        """Cancel every working order.  Failures are logged, never swallowed silently."""
        cancelled = 0
        for order in self._order_manager.working_orders():
            try:
                self._broker.cancel_order(order.client_order_id)
                self._order_manager.on_terminal(order, OrderState.CANCELLED, ts, reason)
                cancelled += 1
            except BrokerError as exc:
                _log.error(
                    "cancel_all_failed_for_order",
                    order_id=order.order_id,
                    error_code=exc.code.value,
                    message=exc.message,
                )
        return cancelled

    def _record_outcome(self, accepted: bool) -> None:
        self._recent_outcomes.append(accepted)
        if len(self._recent_outcomes) > self._config.reject_rate_window:
            self._recent_outcomes.pop(0)

    @property
    def recent_reject_rate(self) -> float:
        """Rejection rate over the recent window, for the kill-switch trigger."""
        if not self._recent_outcomes:
            return 0.0
        return sum(1 for ok in self._recent_outcomes if not ok) / len(self._recent_outcomes)
