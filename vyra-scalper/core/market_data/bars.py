"""Bar construction from tick data.

This module carries the single most important correctness property in the platform: a bar
is emitted **only once an event arrives at or after its close boundary**.  Nothing that
happened inside the bar's window can therefore influence a decision made before the bar
closed (``DATA_SPEC.md`` §5, ``BACKTEST_SPEC.md`` §3).

Two further rules follow from "never silently repair data":

* an empty period produces **no bar** — no zero-volume phantom candles;
* a period with no trade prints has ``vwap is None``, never the midpoint.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.events import BarEvent, Event, QuoteEvent, Timeframe, TradeEvent
from core.instruments.sessions import SessionCalendar
from core.util.clock import Nanos, align_down
from core.util.logging import get_logger

__all__ = ["BarBuilder", "BarEngine", "BarGap"]

_log = get_logger("market_data.bars")


@dataclass(frozen=True, slots=True)
class BarGap:
    """A period in which no data arrived, recorded rather than filled."""

    instrument_id: str
    timeframe: Timeframe
    start_ns: Nanos
    end_ns: Nanos
    periods_missing: int

    def to_dict(self) -> dict[str, object]:
        return {
            "instrument_id": self.instrument_id,
            "timeframe": self.timeframe.value,
            "start_ns": self.start_ns,
            "end_ns": self.end_ns,
            "periods_missing": self.periods_missing,
        }


class BarBuilder:
    """Accumulates one timeframe's bar for one instrument.

    Mutable by design — it is a hot-path accumulator — but it only ever *emits* immutable
    :class:`~core.events.market.BarEvent` objects.
    """

    __slots__ = (
        "_close",
        "_high",
        "_instrument_id",
        "_exchange",
        "_low",
        "_notional",
        "_open",
        "_source",
        "_trade_count",
        "_ts_close",
        "_ts_open",
        "_volume",
        "timeframe",
    )

    def __init__(self, instrument_id: str, exchange: str, timeframe: Timeframe, source: str) -> None:
        self._instrument_id = instrument_id
        self._exchange = exchange
        self.timeframe = timeframe
        self._source = source
        self._reset(0, 0)

    def _reset(self, ts_open: Nanos, ts_close: Nanos) -> None:
        self._ts_open = ts_open
        self._ts_close = ts_close
        self._open = 0.0
        self._high = 0.0
        self._low = 0.0
        self._close = 0.0
        self._volume = 0.0
        self._notional = 0.0
        self._trade_count = 0

    @property
    def is_empty(self) -> bool:
        return self._trade_count == 0 and self._open == 0.0

    @property
    def ts_close(self) -> Nanos:
        return self._ts_close

    @property
    def ts_open(self) -> Nanos:
        return self._ts_open

    def start(self, ts_open: Nanos, ts_close: Nanos) -> None:
        self._reset(ts_open, ts_close)

    def update_price(self, price: float, size: float, is_trade: bool) -> None:
        """Fold one observation into the bar.

        Args:
            price: trade price, or quote mid when no trade data is available.
            size: traded size; ``0`` for quote-derived updates.
            is_trade: whether this observation was an actual print.  Only prints
                contribute to volume, trade count and VWAP.
        """
        if self._open == 0.0:
            self._open = self._high = self._low = price
        else:
            if price > self._high:
                self._high = price
            elif price < self._low:
                self._low = price
        self._close = price
        if is_trade:
            self._volume += size
            self._notional += price * size
            self._trade_count += 1

    def snapshot(self, *, closed: bool, sequence_id: int, ts_processed: Nanos) -> BarEvent:
        """Materialise the current accumulator as a :class:`BarEvent`."""
        vwap = self._notional / self._volume if self._volume > 0 else None
        return BarEvent(
            instrument_id=self._instrument_id,
            exchange=self._exchange,
            ts_exchange=0,
            ts_receive=ts_processed,
            ts_processed=ts_processed,
            sequence_id=sequence_id,
            source=self._source,
            timeframe=self.timeframe,
            ts_open=self._ts_open,
            ts_close=self._ts_close,
            open=self._open,
            high=self._high,
            low=self._low,
            close=self._close,
            volume=self._volume,
            trade_count=self._trade_count,
            vwap=vwap,
            is_closed=closed,
        )


class BarEngine:
    """Builds bars across multiple timeframes for one instrument.

    Args:
        instrument_id: canonical id.
        exchange: venue identifier, copied onto emitted bars.
        timeframes: which bars to build.
        calendar: optional session calendar.  When supplied, intraday bar boundaries are
            anchored to the session open rather than to UTC midnight, and the daily bar
            closes at the session close.  Without it, boundaries are epoch-aligned, which
            is correct only for a genuinely 24/7 instrument.
        use_quotes_when_no_trades: fold quote mids into bars for instruments whose feed
            carries no prints (many CFD feeds).  Off by default: a bar built from mids is
            a different object from a bar built from trades, and mixing them silently
            would make VWAP and volume incomparable across instruments.
    """

    __slots__ = (
        "_builders",
        "_calendar",
        "_exchange",
        "_gaps",
        "_instrument_id",
        "_last_ts",
        "_sequence",
        "_source",
        "_timeframes",
        "_use_quotes",
    )

    def __init__(
        self,
        instrument_id: str,
        exchange: str,
        timeframes: list[Timeframe],
        calendar: SessionCalendar | None = None,
        source: str = "BAR_ENGINE",
        use_quotes_when_no_trades: bool = False,
    ) -> None:
        if not timeframes:
            raise ValueError("BarEngine requires at least one timeframe")
        self._instrument_id = instrument_id
        self._exchange = exchange
        self._timeframes = list(timeframes)
        self._calendar = calendar
        self._source = source
        self._use_quotes = use_quotes_when_no_trades
        self._builders = {
            tf: BarBuilder(instrument_id, exchange, tf, source) for tf in timeframes
        }
        self._last_ts: Nanos = 0
        self._sequence = 0
        self._gaps: list[BarGap] = []

    @property
    def gaps(self) -> tuple[BarGap, ...]:
        """Periods in which no data arrived.  Recorded, never filled."""
        return tuple(self._gaps)

    def _origin(self, ts: Nanos) -> Nanos:
        """Alignment origin: the session open when known, otherwise the epoch."""
        if self._calendar is None:
            return 0
        return self._calendar.session_open_ns(ts) or 0

    def _boundaries(self, ts: Nanos, timeframe: Timeframe) -> tuple[Nanos, Nanos]:
        """``(ts_open, ts_close)`` of the period containing ``ts``."""
        if timeframe is Timeframe.D1 and self._calendar is not None:
            bounds = self._calendar.session_bounds(ts)
            if bounds is not None:
                return bounds
        origin = self._origin(ts)
        start = align_down(ts, timeframe.ns, origin)
        return start, start + timeframe.ns

    def on_event(self, event: Event) -> list[BarEvent]:
        """Feed one market event, returning any bars that closed as a result.

        The returned bars all have ``is_closed=True`` and a ``ts_close`` at or before
        ``event.ts``.  A bar is never emitted before an event proves that its window has
        elapsed — which is precisely what makes the series free of look-ahead.
        """
        price, size, is_trade = self._extract(event)
        if price is None:
            return []

        closed: list[BarEvent] = []
        for timeframe in self._timeframes:
            builder = self._builders[timeframe]
            ts_open, ts_close = self._boundaries(event.ts, timeframe)

            if builder.ts_close and event.ts >= builder.ts_close:
                if not builder.is_empty:
                    self._sequence += 1
                    closed.append(
                        builder.snapshot(
                            closed=True, sequence_id=self._sequence, ts_processed=event.ts
                        )
                    )
                self._record_gap(timeframe, builder.ts_close, ts_open)
                builder.start(ts_open, ts_close)
            elif builder.ts_close == 0:
                builder.start(ts_open, ts_close)

            builder.update_price(price, size or 0.0, is_trade)

        self._last_ts = max(self._last_ts, event.ts)
        return closed

    def _extract(self, event: Event) -> tuple[float | None, float, bool]:
        """Reduce an event to ``(price, size, is_trade)``, or ``(None, 0, False)``."""
        if isinstance(event, TradeEvent):
            return event.price, event.size, True
        if isinstance(event, QuoteEvent) and self._use_quotes:
            if not event.is_two_sided:
                return None, 0.0, False
            return event.mid, 0.0, False
        return None, 0.0, False

    def _record_gap(self, timeframe: Timeframe, previous_close: Nanos, next_open: Nanos) -> None:
        """Record — never fill — periods that produced no data."""
        if next_open <= previous_close:
            return
        missing = (next_open - previous_close) // timeframe.ns
        if missing <= 0:
            return
        gap = BarGap(self._instrument_id, timeframe, previous_close, next_open, int(missing))
        self._gaps.append(gap)
        _log.debug(
            "bar_gap_recorded",
            instrument=self._instrument_id,
            timeframe=timeframe.value,
            periods_missing=int(missing),
        )

    def close_session(self, ts: Nanos) -> list[BarEvent]:
        """Force-close every open bar, e.g. on a session-close event.

        Without this, the last bar of a session would only close when the *next* session's
        first tick arrived, dating it hours later and letting overnight information into
        an intraday bar.
        """
        closed: list[BarEvent] = []
        for timeframe in self._timeframes:
            builder = self._builders[timeframe]
            if builder.ts_close and not builder.is_empty:
                self._sequence += 1
                closed.append(
                    builder.snapshot(closed=True, sequence_id=self._sequence, ts_processed=ts)
                )
                builder.start(0, 0)
        return closed

    def current_partial(self, timeframe: Timeframe) -> BarEvent | None:
        """The bar still forming, marked ``is_closed=False``.

        Available for live display and for strategies that explicitly opt into intrabar
        state.  It cannot enter a historical series: every series append calls
        :meth:`~core.events.market.BarEvent.require_closed`, which raises on a partial.
        """
        builder = self._builders.get(timeframe)
        if builder is None or builder.is_empty:
            return None
        return builder.snapshot(closed=False, sequence_id=0, ts_processed=self._last_ts)
