"""Order, fill, position and risk events.

These are the audit record of the system.  Every one is immutable and append-only: a
correction is a new event that supersedes an old one, never an in-place edit
(``ARCHITECTURE.md`` §7).  That is what makes the execution log admissible as evidence
when a position and a broker statement disagree.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar

from core.events.base import Event
from core.events.enums import (
    EventType,
    OrderState,
    OrderType,
    Side,
    TimeInForce,
)
from core.util.clock import Nanos
from core.util.numeric import is_finite, round_money

__all__ = ["FillEvent", "OrderEvent", "PositionEvent", "RiskEvent"]


@dataclass(frozen=True, slots=True)
class OrderEvent(Event):
    """A snapshot of an order's state at one instant.

    Each state transition emits a new ``OrderEvent``; the sequence of them is the order's
    history.  ``core.execution.order_manager.ManagedOrder`` holds the mutable working
    state, and emits these as it changes.
    """

    event_type: ClassVar[EventType] = EventType.ORDER

    order_id: str = ""
    client_order_id: str = ""
    broker_order_id: str | None = None
    strategy_id: str = ""
    parent_signal_id: str = ""
    risk_decision_id: str = ""
    side: Side = Side.BUY
    quantity: float = 0.0
    order_type: OrderType = OrderType.MARKET
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: float | None = None
    stop_price: float | None = None
    state: OrderState = OrderState.PENDING_NEW
    filled_qty: float = 0.0
    avg_fill_price: float | None = None
    reason_codes: tuple[str, ...] = ()
    ts_signal: Nanos = 0
    ts_created: Nanos = 0
    ts_submitted: Nanos = 0
    ts_ack: Nanos = 0
    ts_terminal: Nanos = 0
    attempt: int = 0

    @property
    def remaining_qty(self) -> float:
        """Unfilled quantity, floored at zero."""
        return max(0.0, self.quantity - self.filled_qty)

    @property
    def is_complete(self) -> bool:
        return self.state.is_terminal

    @property
    def fill_ratio(self) -> float:
        """Filled fraction in [0, 1]; ``0.0`` for a zero-quantity order."""
        if self.quantity <= 0:
            return 0.0
        return min(1.0, self.filled_qty / self.quantity)

    @property
    def latency_signal_to_submit(self) -> int | None:
        """Nanoseconds from signal generation to submission, if both stamps exist."""
        if self.ts_signal == 0 or self.ts_submitted == 0:
            return None
        return self.ts_submitted - self.ts_signal

    @property
    def latency_submit_to_ack(self) -> int | None:
        if self.ts_submitted == 0 or self.ts_ack == 0:
            return None
        return self.ts_ack - self.ts_submitted


@dataclass(frozen=True, slots=True)
class FillEvent(Event):
    """An execution.  Immutable and never amended — a bust is a separate offsetting fill.

    Attributes:
        expected_price: what the execution model predicted at submission.  Comparing it
            with :attr:`price` yields ``slippage_vs_expected``, the number that reveals an
            optimistic simulator before it costs real money (``EXECUTION_SPEC.md`` §8).
        decision_price: mid at the moment the signal was generated; the basis for
            implementation shortfall.
    """

    event_type: ClassVar[EventType] = EventType.FILL

    fill_id: str = ""
    order_id: str = ""
    client_order_id: str = ""
    broker_fill_id: str | None = None
    strategy_id: str = ""
    side: Side = Side.BUY
    quantity: float = 0.0
    price: float = 0.0
    commission: float = 0.0
    exchange_fees: float = 0.0
    is_partial: bool = False
    liquidity_flag: str = ""
    expected_price: float | None = None
    decision_price: float | None = None
    spread_at_fill: float | None = None
    ts_fill: Nanos = 0

    def __post_init__(self) -> None:
        for name in ("quantity", "price", "commission", "exchange_fees"):
            value = getattr(self, name)
            if not is_finite(value):
                raise ValueError(f"FillEvent.{name} must be finite, got {value!r}")
        if self.quantity < 0:
            raise ValueError(f"FillEvent.quantity must be non-negative, got {self.quantity}")

    @property
    def total_fees(self) -> float:
        return round_money(self.commission + self.exchange_fees)

    def slippage_vs_expected(self, tick_size: float) -> float | None:
        """Adverse slippage against the model's prediction, in ticks.

        Positive means worse than expected for the side traded.  ``None`` when no
        expectation was recorded.
        """
        if self.expected_price is None or tick_size <= 0:
            return None
        raw = (self.price - self.expected_price) * self.side.sign
        return raw / tick_size

    def slippage_vs_decision(self, tick_size: float) -> float | None:
        """Implementation shortfall against the decision price, in ticks."""
        if self.decision_price is None or tick_size <= 0:
            return None
        raw = (self.price - self.decision_price) * self.side.sign
        return raw / tick_size

    def signed_quantity(self) -> float:
        """Quantity signed by side, for position arithmetic."""
        return self.quantity * self.side.sign


@dataclass(frozen=True, slots=True)
class PositionEvent(Event):
    """A position snapshot emitted whenever the book changes or is marked."""

    event_type: ClassVar[EventType] = EventType.POSITION

    strategy_id: str = ""
    quantity: float = 0.0
    avg_price: float = 0.0
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    mark_price: float = 0.0
    notional: float = 0.0

    @property
    def is_flat(self) -> bool:
        return self.quantity == 0.0

    @property
    def direction(self) -> Side | None:
        """``Side`` of the exposure, or ``None`` when flat."""
        if self.quantity > 0:
            return Side.BUY
        if self.quantity < 0:
            return Side.SELL
        return None

    @property
    def total_pnl(self) -> float:
        return round_money(self.realized_pnl + self.unrealized_pnl)


@dataclass(frozen=True, slots=True)
class RiskEvent(Event):
    """A risk decision, limit breach, or kill-switch transition.

    Recorded for **approvals as well as rejections**: an audit trail that only contains
    refusals cannot demonstrate that a limit was evaluated at all (``RISK_SPEC.md`` §1).
    """

    event_type: ClassVar[EventType] = EventType.RISK

    risk_event_id: str = ""
    kind: str = ""
    severity: str = "INFO"
    strategy_id: str = ""
    signal_id: str | None = None
    decision_id: str | None = None
    action: str = ""
    reason_codes: tuple[str, ...] = ()
    binding_limit: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def is_halt(self) -> bool:
        return self.action == "HALT" or self.kind.startswith("KILL_SWITCH")
