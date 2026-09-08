"""Position accounting.

Average-price accounting, which is what futures and CFD venues use for margin and what
brokers report.  Realised PnL is booked when a position is reduced; unrealised PnL is
marked continuously.

Every PnL figure goes through :meth:`Instrument.pnl`, which converts through ticks and
tick value.  Computing ``(exit - entry) * multiplier`` directly would disagree with the
venue for any instrument whose tick value is not simply the multiplier times the tick.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.events import FillEvent, Side
from core.instruments.instrument import Instrument
from core.util.clock import Nanos
from core.util.numeric import round_money

__all__ = ["Position", "RealizedTrade"]


@dataclass(frozen=True, slots=True)
class RealizedTrade:
    """A closed (or partially closed) round trip, booked when a position is reduced."""

    instrument_id: str
    strategy_id: str
    side: Side
    quantity: float
    entry_price: float
    exit_price: float
    gross_pnl: float
    fees: float
    entry_ts: Nanos
    exit_ts: Nanos
    mae: float = 0.0
    mfe: float = 0.0

    @property
    def net_pnl(self) -> float:
        """PnL after the fees attributed to this trade.

        This is the only PnL number that means anything.  Gross is reported alongside it
        so the cost drag is visible, never so it can be quoted on its own.
        """
        return round_money(self.gross_pnl - self.fees)

    @property
    def holding_ns(self) -> int:
        return self.exit_ts - self.entry_ts

    @property
    def is_win(self) -> bool:
        return self.net_pnl > 0

    def to_dict(self) -> dict[str, object]:
        return {
            "instrument_id": self.instrument_id,
            "strategy_id": self.strategy_id,
            "side": self.side.value,
            "quantity": self.quantity,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "gross_pnl": round_money(self.gross_pnl),
            "fees": round_money(self.fees),
            "net_pnl": self.net_pnl,
            "entry_ts": self.entry_ts,
            "exit_ts": self.exit_ts,
            "holding_ns": self.holding_ns,
            "mae": round_money(self.mae),
            "mfe": round_money(self.mfe),
            "is_win": self.is_win,
        }


@dataclass(slots=True)
class Position:
    """A single instrument's position for one strategy.

    Mutable: it is the running state the fill stream updates.  Immutable snapshots are
    published as :class:`~core.events.trading.PositionEvent`.
    """

    instrument: Instrument
    strategy_id: str = ""
    quantity: float = 0.0
    avg_price: float = 0.0
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    mark_price: float = 0.0
    entry_ts: Nanos = 0
    last_fill_ts: Nanos = 0
    fill_count: int = 0
    mae: float = 0.0
    mfe: float = 0.0
    closed_trades: list[RealizedTrade] = field(default_factory=list)

    @property
    def instrument_id(self) -> str:
        return self.instrument.instrument_id

    @property
    def is_flat(self) -> bool:
        return self.quantity == 0.0

    @property
    def is_long(self) -> bool:
        return self.quantity > 0.0

    @property
    def side(self) -> Side | None:
        if self.quantity > 0:
            return Side.BUY
        if self.quantity < 0:
            return Side.SELL
        return None

    @property
    def unrealized_pnl(self) -> float:
        """Mark-to-market PnL on the open quantity.

        Zero when flat or unmarked — not stale, and never carried over from a previous
        position.
        """
        if self.quantity == 0 or self.mark_price <= 0 or self.avg_price <= 0:
            return 0.0
        sign = 1 if self.quantity > 0 else -1
        return self.instrument.pnl(self.avg_price, self.mark_price, abs(self.quantity), sign)

    @property
    def total_pnl(self) -> float:
        return round_money(self.realized_pnl + self.unrealized_pnl - self.fees_paid)

    @property
    def notional(self) -> float:
        price = self.mark_price if self.mark_price > 0 else self.avg_price
        return self.instrument.notional(price, abs(self.quantity))

    def mark(self, price: float) -> None:
        """Update the mark price and the excursion extremes.

        MAE/MFE are tracked here rather than reconstructed later, because reconstructing
        them from bars would use the bar's extremes, which the position may never actually
        have experienced at a moment it could have acted on.
        """
        if price <= 0:
            return
        self.mark_price = price
        if self.quantity == 0:
            return
        pnl = self.unrealized_pnl
        self.mae = min(self.mae, pnl)
        self.mfe = max(self.mfe, pnl)

    def apply_fill(self, fill: FillEvent) -> RealizedTrade | None:
        """Apply an execution, returning a realised trade if the position was reduced.

        Handles the three cases explicitly — opening/increasing, reducing, and reversing —
        because a reversal that is treated as a simple reduction books the wrong realised
        PnL and leaves the new position with the old average price.
        """
        if fill.quantity <= 0:
            return None

        signed = fill.signed_quantity()
        fees = fill.total_fees
        self.fees_paid = round_money(self.fees_paid + fees)
        self.last_fill_ts = fill.ts_fill or fill.ts
        self.fill_count += 1

        if self.quantity == 0:
            self._open(signed, fill.price, self.last_fill_ts)
            return None

        same_direction = (self.quantity > 0) == (signed > 0)
        if same_direction:
            self._increase(signed, fill.price)
            return None

        closing_qty = min(abs(signed), abs(self.quantity))
        trade = self._reduce(closing_qty, fill.price, fees)

        remainder = abs(signed) - closing_qty
        if remainder > 0:
            # Reversal: the residual opens a fresh position at the fill price, with its
            # own entry timestamp and excursion tracking.
            self._open(remainder * (1 if signed > 0 else -1), fill.price, self.last_fill_ts)
        return trade

    def _open(self, signed_qty: float, price: float, ts: Nanos) -> None:
        self.quantity = signed_qty
        self.avg_price = price
        self.entry_ts = ts
        self.mark_price = price
        self.mae = 0.0
        self.mfe = 0.0

    def _increase(self, signed_qty: float, price: float) -> None:
        total = self.quantity + signed_qty
        self.avg_price = (self.avg_price * abs(self.quantity) + price * abs(signed_qty)) / abs(total)
        self.quantity = total

    def _reduce(self, closing_qty: float, price: float, fees: float) -> RealizedTrade:
        sign = 1 if self.quantity > 0 else -1
        gross = self.instrument.pnl(self.avg_price, price, closing_qty, sign)
        self.realized_pnl = round_money(self.realized_pnl + gross)

        trade = RealizedTrade(
            instrument_id=self.instrument_id,
            strategy_id=self.strategy_id,
            side=Side.BUY if sign > 0 else Side.SELL,
            quantity=closing_qty,
            entry_price=self.avg_price,
            exit_price=price,
            gross_pnl=gross,
            fees=fees,
            entry_ts=self.entry_ts,
            exit_ts=self.last_fill_ts,
            mae=self.mae,
            mfe=self.mfe,
        )
        self.closed_trades.append(trade)

        self.quantity += closing_qty * (-sign)
        if abs(self.quantity) < 1e-12:
            self.quantity = 0.0
            self.avg_price = 0.0
            self.entry_ts = 0
            self.mae = 0.0
            self.mfe = 0.0
        return trade
