"""Order lifecycle management.

Owns the mutable state of every order and enforces the state machine.  Illegal
transitions raise rather than mutating, because an order whose state silently regresses is
an order whose position is wrong.

Also holds the in-flight registry that provides the second layer of duplicate protection
(``EXECUTION_SPEC.md`` §4): at most one working entry order per
``(strategy, instrument, direction)`` unless stacking is explicitly enabled.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.events import (
    FillEvent,
    OrderEvent,
    OrderState,
    OrderType,
    Side,
    TimeInForce,
)
from core.risk.engine import RiskDecision
from core.signals.signal import Signal
from core.util.clock import Nanos
from core.util.ids import client_order_id
from core.util.logging import get_logger
from core.util.numeric import round_money

__all__ = ["InvalidOrderTransition", "ManagedOrder", "OrderManager"]

_log = get_logger("execution.order_manager")


class InvalidOrderTransition(RuntimeError):
    """Raised on an illegal order state transition."""


_LEGAL_TRANSITIONS: dict[OrderState, frozenset[OrderState]] = {
    OrderState.PENDING_NEW: frozenset(
        {OrderState.SUBMITTED, OrderState.REJECTED_LOCAL, OrderState.CANCELLED}
    ),
    OrderState.SUBMITTED: frozenset(
        {
            OrderState.WORKING,
            OrderState.PARTIALLY_FILLED,
            OrderState.FILLED,
            OrderState.REJECTED_BROKER,
            OrderState.CANCELLED,
            OrderState.UNKNOWN,
            OrderState.EXPIRED,
        }
    ),
    OrderState.WORKING: frozenset(
        {
            OrderState.PARTIALLY_FILLED,
            OrderState.FILLED,
            OrderState.CANCELLED,
            OrderState.EXPIRED,
            OrderState.UNKNOWN,
        }
    ),
    OrderState.PARTIALLY_FILLED: frozenset(
        {
            OrderState.PARTIALLY_FILLED,
            OrderState.FILLED,
            OrderState.CANCELLED,
            OrderState.EXPIRED,
            OrderState.UNKNOWN,
        }
    ),
    # UNKNOWN is resolved only by reconciliation, which may land it anywhere.
    OrderState.UNKNOWN: frozenset(
        {
            OrderState.WORKING,
            OrderState.PARTIALLY_FILLED,
            OrderState.FILLED,
            OrderState.CANCELLED,
            OrderState.REJECTED_BROKER,
            OrderState.EXPIRED,
        }
    ),
    OrderState.FILLED: frozenset(),
    OrderState.CANCELLED: frozenset(),
    OrderState.EXPIRED: frozenset(),
    OrderState.REJECTED_LOCAL: frozenset(),
    OrderState.REJECTED_BROKER: frozenset(),
}


@dataclass(slots=True)
class ManagedOrder:
    """Mutable working state for one order."""

    order_id: str
    client_order_id: str
    strategy_id: str
    instrument_id: str
    exchange: str
    side: Side
    quantity: float
    order_type: OrderType
    time_in_force: TimeInForce
    limit_price: float | None = None
    stop_price: float | None = None
    parent_signal_id: str = ""
    risk_decision_id: str = ""
    state: OrderState = OrderState.PENDING_NEW
    broker_order_id: str | None = None
    filled_qty: float = 0.0
    notional_filled: float = 0.0
    fees: float = 0.0
    reason_codes: tuple[str, ...] = ()
    attempt: int = 0
    is_entry: bool = True
    decision_price: float | None = None
    ts_signal: Nanos = 0
    ts_created: Nanos = 0
    ts_submitted: Nanos = 0
    ts_ack: Nanos = 0
    ts_first_fill: Nanos = 0
    ts_last_fill: Nanos = 0
    ts_terminal: Nanos = 0
    expires_at_ns: Nanos = 0
    fills: list[FillEvent] = field(default_factory=list)

    @property
    def remaining_qty(self) -> float:
        return max(0.0, self.quantity - self.filled_qty)

    @property
    def avg_fill_price(self) -> float | None:
        """Size-weighted average across every fill, or ``None`` before the first."""
        if self.filled_qty <= 0:
            return None
        return self.notional_filled / self.filled_qty

    @property
    def is_working(self) -> bool:
        return self.state.is_working

    @property
    def is_terminal(self) -> bool:
        return self.state.is_terminal

    @property
    def in_flight_key(self) -> tuple[str, str, str]:
        return (self.strategy_id, self.instrument_id, self.side.value)

    def transition(self, new_state: OrderState, ts: Nanos, reason: str = "") -> None:
        """Move to ``new_state``.

        Raises:
            InvalidOrderTransition: when the move is not legal.  Silently accepting one —
                a fill after a cancel, say — would leave a position the engine believes it
                does not have.
        """
        if new_state is self.state and new_state is not OrderState.PARTIALLY_FILLED:
            return
        allowed = _LEGAL_TRANSITIONS.get(self.state, frozenset())
        if new_state not in allowed:
            raise InvalidOrderTransition(
                f"order {self.order_id}: cannot move {self.state.value} -> "
                f"{new_state.value}; legal: {sorted(s.value for s in allowed) or 'none (terminal)'}"
            )
        self.state = new_state
        if reason:
            self.reason_codes = (*self.reason_codes, reason)
        if new_state.is_terminal:
            self.ts_terminal = ts

    def apply_fill(self, fill: FillEvent) -> None:
        """Accumulate a fill.  Fills are never overwritten, only added.

        Raises:
            InvalidOrderTransition: when a fill arrives for a terminal order, or would
                over-fill it.  Both mean our view and the venue's have diverged, which
                reconciliation must resolve rather than arithmetic absorbing it.
        """
        if self.state.is_terminal:
            raise InvalidOrderTransition(
                f"order {self.order_id}: fill of {fill.quantity} arrived in terminal "
                f"state {self.state.value}"
            )
        if fill.quantity > self.remaining_qty + 1e-9:
            raise InvalidOrderTransition(
                f"order {self.order_id}: fill of {fill.quantity} exceeds remaining "
                f"{self.remaining_qty}"
            )

        self.fills.append(fill)
        self.filled_qty += fill.quantity
        self.notional_filled += fill.quantity * fill.price
        self.fees = round_money(self.fees + fill.total_fees)
        if self.ts_first_fill == 0:
            self.ts_first_fill = fill.ts_fill or fill.ts
        self.ts_last_fill = fill.ts_fill or fill.ts

        target = OrderState.FILLED if self.remaining_qty <= 1e-9 else OrderState.PARTIALLY_FILLED
        self.transition(target, self.ts_last_fill)

    def to_event(self, sequence_id: int, ts: Nanos) -> OrderEvent:
        return OrderEvent(
            instrument_id=self.instrument_id,
            exchange=self.exchange,
            ts_exchange=0,
            ts_receive=ts,
            ts_processed=ts,
            sequence_id=sequence_id,
            source="ORDER_MANAGER",
            order_id=self.order_id,
            client_order_id=self.client_order_id,
            broker_order_id=self.broker_order_id,
            strategy_id=self.strategy_id,
            parent_signal_id=self.parent_signal_id,
            risk_decision_id=self.risk_decision_id,
            side=self.side,
            quantity=self.quantity,
            order_type=self.order_type,
            time_in_force=self.time_in_force,
            limit_price=self.limit_price,
            stop_price=self.stop_price,
            state=self.state,
            filled_qty=self.filled_qty,
            avg_fill_price=self.avg_fill_price,
            reason_codes=self.reason_codes,
            ts_signal=self.ts_signal,
            ts_created=self.ts_created,
            ts_submitted=self.ts_submitted,
            ts_ack=self.ts_ack,
            ts_terminal=self.ts_terminal,
            attempt=self.attempt,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "order_id": self.order_id,
            "client_order_id": self.client_order_id,
            "broker_order_id": self.broker_order_id,
            "strategy_id": self.strategy_id,
            "instrument_id": self.instrument_id,
            "side": self.side.value,
            "quantity": self.quantity,
            "order_type": self.order_type.value,
            "time_in_force": self.time_in_force.value,
            "limit_price": self.limit_price,
            "stop_price": self.stop_price,
            "state": self.state.value,
            "filled_qty": self.filled_qty,
            "avg_fill_price": self.avg_fill_price,
            "fees": self.fees,
            "reason_codes": list(self.reason_codes),
            "parent_signal_id": self.parent_signal_id,
            "risk_decision_id": self.risk_decision_id,
            "ts_signal": self.ts_signal,
            "ts_created": self.ts_created,
            "ts_submitted": self.ts_submitted,
            "ts_ack": self.ts_ack,
            "ts_first_fill": self.ts_first_fill,
            "ts_terminal": self.ts_terminal,
            "attempt": self.attempt,
            "is_entry": self.is_entry,
        }


class OrderManager:
    """Creates orders from approved signals and tracks their lifecycle.

    :meth:`create` requires a :class:`~core.risk.engine.RiskDecision`.  There is no
    constructor path that produces an order without one, which is how the "no strategy may
    bypass risk" rule is enforced structurally rather than by review.
    """

    __slots__ = ("_allow_stacking", "_counter", "_in_flight", "_orders", "_run_token")

    def __init__(self, run_token: str, allow_stacking: bool = False) -> None:
        self._run_token = run_token
        self._allow_stacking = allow_stacking
        self._counter = 0
        self._orders: dict[str, ManagedOrder] = {}
        self._in_flight: dict[tuple[str, str, str], str] = {}

    @property
    def orders(self) -> dict[str, ManagedOrder]:
        return dict(self._orders)

    def get(self, order_id: str) -> ManagedOrder | None:
        return self._orders.get(order_id)

    def by_client_id(self, client_id: str) -> ManagedOrder | None:
        return next(
            (o for o in self._orders.values() if o.client_order_id == client_id), None
        )

    def working_orders(self) -> list[ManagedOrder]:
        return [o for o in self._orders.values() if o.is_working]

    def has_in_flight(self, strategy_id: str, instrument_id: str, side: Side) -> bool:
        key = (strategy_id, instrument_id, side.value)
        order_id = self._in_flight.get(key)
        if order_id is None:
            return False
        order = self._orders.get(order_id)
        if order is None or order.is_terminal:
            # Stale registry entry: clear it rather than blocking forever on an order that
            # has already reached a terminal state.
            self._in_flight.pop(key, None)
            return False
        # Anything not yet terminal counts, PENDING_NEW included.  Requiring `is_working`
        # would leave the window between creation and submission unguarded, which is
        # precisely where a second signal for the same instrument and side would slip
        # through and open a duplicate position.
        return True

    def create(
        self,
        signal: Signal,
        decision: RiskDecision,
        exchange: str,
        order_type: OrderType,
        time_in_force: TimeInForce,
        limit_price: float | None = None,
        stop_price: float | None = None,
        ts: Nanos | None = None,
        decision_price: float | None = None,
        expires_at_ns: Nanos = 0,
        attempt: int = 0,
    ) -> ManagedOrder:
        """Build an order from an approved decision.

        Raises:
            ValueError: if ``decision`` does not permit an order, or if it belongs to a
                different signal.  Both would mean an order is being created against a
                risk verdict that was never given for it.
        """
        if not decision.permits_order:
            raise ValueError(
                f"cannot create an order from a {decision.action.value} decision "
                f"({decision.decision_id}); reason codes: {list(decision.reason_codes)}"
            )
        if decision.signal_id != signal.signal_id:
            raise ValueError(
                f"risk decision {decision.decision_id} belongs to signal "
                f"{decision.signal_id!r}, not {signal.signal_id!r}"
            )

        self._counter += 1
        order_id = f"ord-{self._run_token}-{self._counter:08d}"
        stamp = ts if ts is not None else signal.ts
        order = ManagedOrder(
            order_id=order_id,
            client_order_id=client_order_id(
                self._run_token, signal.strategy_id, signal.instrument_id,
                signal.signal_id, attempt,
            ),
            strategy_id=signal.strategy_id,
            instrument_id=signal.instrument_id,
            exchange=exchange,
            side=signal.direction,
            quantity=decision.approved_qty,
            order_type=order_type,
            time_in_force=time_in_force,
            limit_price=limit_price,
            stop_price=stop_price,
            parent_signal_id=signal.signal_id,
            risk_decision_id=decision.decision_id,
            is_entry=signal.is_entry,
            decision_price=decision_price,
            ts_signal=signal.ts,
            ts_created=stamp,
            expires_at_ns=expires_at_ns,
            attempt=attempt,
        )
        self._orders[order_id] = order
        if order.is_entry:
            self._in_flight[order.in_flight_key] = order_id
        return order

    def on_ack(self, order: ManagedOrder, broker_order_id: str, ts: Nanos) -> None:
        order.broker_order_id = broker_order_id
        order.ts_ack = ts
        if order.state is OrderState.SUBMITTED:
            order.transition(OrderState.WORKING, ts)

    def on_fill(self, order: ManagedOrder, fill: FillEvent) -> None:
        order.apply_fill(fill)
        if order.is_terminal:
            self._release(order)

    def on_terminal(self, order: ManagedOrder, state: OrderState, ts: Nanos, reason: str) -> None:
        order.transition(state, ts, reason)
        self._release(order)

    def _release(self, order: ManagedOrder) -> None:
        key = order.in_flight_key
        if self._in_flight.get(key) == order.order_id:
            del self._in_flight[key]

    def expired_orders(self, ts: Nanos) -> list[ManagedOrder]:
        """Working orders whose timeout has elapsed.

        Every order carries a timeout: an order with none is a position nobody chose to
        have (``EXECUTION_SPEC.md`` §3).
        """
        return [
            o
            for o in self._orders.values()
            if o.is_working and o.expires_at_ns and ts >= o.expires_at_ns
        ]

    def stats(self) -> dict[str, float | int]:
        orders = list(self._orders.values())
        terminal = [o for o in orders if o.is_terminal]
        rejected = [
            o
            for o in terminal
            if o.state in (OrderState.REJECTED_BROKER, OrderState.REJECTED_LOCAL)
        ]
        cancelled = [o for o in terminal if o.state is OrderState.CANCELLED]
        filled = [o for o in terminal if o.state is OrderState.FILLED]
        submitted = [o for o in orders if o.ts_submitted > 0]
        return {
            "total": len(orders),
            "filled": len(filled),
            "rejected": len(rejected),
            "cancelled": len(cancelled),
            "working": len(self.working_orders()),
            "reject_rate": len(rejected) / len(submitted) if submitted else 0.0,
            "fill_rate": len(filled) / len(submitted) if submitted else 0.0,
        }
