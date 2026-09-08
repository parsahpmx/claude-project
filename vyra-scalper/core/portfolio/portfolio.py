"""Portfolio state: cash, positions, equity, drawdown and loss buckets.

Equity is recomputed from first principles on every mark rather than accumulated
incrementally, so a missed update cannot leave the book quietly wrong:

``equity = starting_equity + realised_pnl - fees + unrealised_pnl``

Daily and weekly loss buckets are keyed by **trading date** from the session calendar,
not by UTC date.  An overnight session that opens at 17:00 local belongs to the next
trading date; bucketing it by UTC would reset the daily-loss limit in the middle of a
live position (``core/instruments/sessions.py``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from core.events import FillEvent, PositionEvent, Side
from core.instruments.instrument import Instrument
from core.instruments.sessions import SessionCalendar
from core.portfolio.position import Position, RealizedTrade
from core.util.clock import Nanos, local_date
from core.util.logging import get_logger
from core.util.numeric import round_money

__all__ = ["EquityPoint", "Portfolio"]

_log = get_logger("portfolio")


@dataclass(frozen=True, slots=True)
class EquityPoint:
    """One point on the equity curve."""

    ts: Nanos
    equity: float
    realized_pnl: float
    unrealized_pnl: float
    fees: float
    drawdown: float
    drawdown_pct: float
    gross_exposure: float
    open_positions: int

    def to_dict(self) -> dict[str, float | int]:
        return {
            "ts": self.ts,
            "equity": self.equity,
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl,
            "fees": self.fees,
            "drawdown": self.drawdown,
            "drawdown_pct": self.drawdown_pct,
            "gross_exposure": self.gross_exposure,
            "open_positions": self.open_positions,
        }


class Portfolio:
    """Positions, cash and the equity curve.

    Args:
        starting_equity: opening account equity.
        instruments: instruments that may be traded.
        calendars: session calendars used to bucket PnL by trading date.
        record_curve: whether to retain every equity point.  Always on in backtest;
            live runs sample instead, since a tick-rate curve over a week is large and
            adds nothing a sampled one does not show.
    """

    __slots__ = (
        "_calendars",
        "_curve",
        "_daily_pnl",
        "_equity",
        "_instruments",
        "_peak_equity",
        "_positions",
        "_realized_trades",
        "_record_curve",
        "_session_start_equity",
        "_starting_equity",
        "_current_trading_date",
        "_weekly_pnl",
    )

    def __init__(
        self,
        starting_equity: float,
        instruments: dict[str, Instrument],
        calendars: dict[str, SessionCalendar] | None = None,
        record_curve: bool = True,
    ) -> None:
        if starting_equity <= 0:
            raise ValueError(f"starting_equity must be positive, got {starting_equity}")
        self._starting_equity = starting_equity
        self._instruments = instruments
        self._calendars = calendars or {}
        self._positions: dict[str, Position] = {}
        self._realized_trades: list[RealizedTrade] = []
        self._equity = starting_equity
        self._peak_equity = starting_equity
        self._session_start_equity = starting_equity
        self._current_trading_date: date | None = None
        self._daily_pnl: dict[date, float] = {}
        self._weekly_pnl: dict[date, float] = {}
        self._curve: list[EquityPoint] = []
        self._record_curve = record_curve

    # -- accessors ----------------------------------------------------------------------

    @property
    def starting_equity(self) -> float:
        return self._starting_equity

    @property
    def equity(self) -> float:
        return self._equity

    @property
    def peak_equity(self) -> float:
        return self._peak_equity

    @property
    def session_start_equity(self) -> float:
        return self._session_start_equity

    @property
    def realized_pnl(self) -> float:
        return round_money(sum(p.realized_pnl for p in self._positions.values()))

    @property
    def unrealized_pnl(self) -> float:
        return round_money(sum(p.unrealized_pnl for p in self._positions.values()))

    @property
    def fees_paid(self) -> float:
        return round_money(sum(p.fees_paid for p in self._positions.values()))

    @property
    def gross_exposure(self) -> float:
        return round_money(sum(p.notional for p in self._positions.values()))

    @property
    def drawdown(self) -> float:
        """Money below the equity peak.  Zero at a new high, never negative."""
        return round_money(max(0.0, self._peak_equity - self._equity))

    @property
    def drawdown_pct(self) -> float:
        if self._peak_equity <= 0:
            return 0.0
        return self.drawdown / self._peak_equity

    @property
    def leverage(self) -> float:
        if self._equity <= 0:
            return float("inf")
        return self.gross_exposure / self._equity

    @property
    def realized_trades(self) -> tuple[RealizedTrade, ...]:
        return tuple(self._realized_trades)

    @property
    def equity_curve(self) -> tuple[EquityPoint, ...]:
        return tuple(self._curve)

    @property
    def open_positions(self) -> dict[str, Position]:
        return {k: p for k, p in self._positions.items() if not p.is_flat}

    def position(self, instrument_id: str) -> Position:
        """The position for ``instrument_id``, created flat if it does not yet exist."""
        existing = self._positions.get(instrument_id)
        if existing is not None:
            return existing
        instrument = self._instruments.get(instrument_id)
        if instrument is None:
            raise KeyError(f"portfolio does not track instrument {instrument_id!r}")
        position = Position(instrument)
        self._positions[instrument_id] = position
        return position

    # -- mutation -----------------------------------------------------------------------

    def apply_fill(self, fill: FillEvent) -> RealizedTrade | None:
        """Apply an execution and refresh equity."""
        position = self.position(fill.instrument_id)
        if not position.strategy_id:
            position.strategy_id = fill.strategy_id
        trade = position.apply_fill(fill)
        if trade is not None:
            self._realized_trades.append(trade)
            self._book_to_period(trade)
        self.mark(fill.instrument_id, fill.price, fill.ts_fill or fill.ts)
        return trade

    def mark(self, instrument_id: str, price: float, ts: Nanos) -> EquityPoint:
        """Mark one instrument and recompute equity."""
        position = self._positions.get(instrument_id)
        if position is not None:
            position.mark(price)
        return self._recompute(ts)

    def mark_all(self, prices: dict[str, float], ts: Nanos) -> EquityPoint:
        for instrument_id, price in prices.items():
            position = self._positions.get(instrument_id)
            if position is not None:
                position.mark(price)
        return self._recompute(ts)

    def _recompute(self, ts: Nanos) -> EquityPoint:
        realized = self.realized_pnl
        unrealized = self.unrealized_pnl
        fees = self.fees_paid
        self._equity = round_money(self._starting_equity + realized + unrealized - fees)
        self._peak_equity = max(self._peak_equity, self._equity)

        point = EquityPoint(
            ts=ts,
            equity=self._equity,
            realized_pnl=realized,
            unrealized_pnl=unrealized,
            fees=fees,
            drawdown=self.drawdown,
            drawdown_pct=self.drawdown_pct,
            gross_exposure=self.gross_exposure,
            open_positions=len(self.open_positions),
        )
        if self._record_curve:
            self._curve.append(point)
        return point

    # -- period accounting --------------------------------------------------------------

    def trading_date(self, instrument_id: str, ts: Nanos) -> date:
        """The trading date for ``ts``, from the instrument's session calendar."""
        calendar = self._calendars.get(instrument_id)
        if calendar is not None:
            return calendar.session_date(ts)
        instrument = self._instruments.get(instrument_id)
        return local_date(ts, instrument.timezone if instrument else "UTC")

    def _book_to_period(self, trade: RealizedTrade) -> None:
        day = self.trading_date(trade.instrument_id, trade.exit_ts)
        week = day - timedelta(days=day.weekday())
        self._daily_pnl[day] = round_money(self._daily_pnl.get(day, 0.0) + trade.net_pnl)
        self._weekly_pnl[week] = round_money(self._weekly_pnl.get(week, 0.0) + trade.net_pnl)

    def start_session(self, trading_date: date) -> None:
        """Mark the start of a trading date and reset the session equity reference.

        The daily-loss limit measures against this reference.  It is set from the
        *session* boundary, so a limit cannot silently reset partway through an overnight
        session.
        """
        if self._current_trading_date == trading_date:
            return
        self._current_trading_date = trading_date
        self._session_start_equity = self._equity
        _log.info(
            "session_started",
            trading_date=trading_date.isoformat(),
            session_start_equity=self._equity,
        )

    def session_pnl(self) -> float:
        """PnL since the session opened, realised *and* unrealised.

        Including unrealised is deliberate: a position drifting through the daily-loss
        limit must trip it without waiting to be closed.
        """
        return round_money(self._equity - self._session_start_equity)

    def session_pnl_pct(self) -> float:
        if self._session_start_equity <= 0:
            return 0.0
        return self.session_pnl() / self._session_start_equity

    def daily_pnl(self, day: date) -> float:
        return self._daily_pnl.get(day, 0.0)

    def weekly_pnl(self, any_day_in_week: date) -> float:
        week = any_day_in_week - timedelta(days=any_day_in_week.weekday())
        return self._weekly_pnl.get(week, 0.0)

    def weekly_pnl_pct(self, any_day_in_week: date) -> float:
        if self._starting_equity <= 0:
            return 0.0
        return self.weekly_pnl(any_day_in_week) / self._starting_equity

    def exposure_pct(self, instrument_id: str) -> float:
        position = self._positions.get(instrument_id)
        if position is None or self._equity <= 0:
            return 0.0
        return position.notional / self._equity

    def group_exposure_pct(self, instrument_ids: tuple[str, ...]) -> float:
        if self._equity <= 0:
            return 0.0
        total = sum(
            p.notional for iid, p in self._positions.items() if iid in instrument_ids
        )
        return total / self._equity

    def to_position_event(self, instrument_id: str, ts: Nanos, sequence_id: int) -> PositionEvent:
        position = self.position(instrument_id)
        return PositionEvent(
            instrument_id=instrument_id,
            exchange=position.instrument.exchange,
            ts_exchange=0,
            ts_receive=ts,
            ts_processed=ts,
            sequence_id=sequence_id,
            source="PORTFOLIO",
            strategy_id=position.strategy_id,
            quantity=position.quantity,
            avg_price=position.avg_price,
            realized_pnl=position.realized_pnl,
            unrealized_pnl=position.unrealized_pnl,
            mark_price=position.mark_price,
            notional=position.notional,
        )

    def summary(self) -> dict[str, float | int]:
        return {
            "starting_equity": self._starting_equity,
            "equity": self._equity,
            "peak_equity": self._peak_equity,
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl,
            "fees_paid": self.fees_paid,
            "net_pnl": round_money(self._equity - self._starting_equity),
            "drawdown": self.drawdown,
            "drawdown_pct": round(self.drawdown_pct, 6),
            "gross_exposure": self.gross_exposure,
            "leverage": round(self.leverage, 6),
            "open_positions": len(self.open_positions),
            "closed_trades": len(self._realized_trades),
        }
