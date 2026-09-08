"""Streaming indicators.

Every indicator here consumes closed bars or trade prints one at a time and exposes
:attr:`is_ready`.  None of them can see the future, because none of them ever holds an
array they could index past the present.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from core.events import Aggressor, BarEvent, TradeEvent
from core.features.rolling import EMA, NotReady, RollingStd
from core.util.clock import Nanos

__all__ = [
    "ATR",
    "MACD",
    "ROC",
    "RSI",
    "AnchoredVWAP",
    "OpeningRange",
    "OrderFlowTracker",
    "ParkinsonVolatility",
    "RealizedVolatility",
    "SessionRange",
    "SwingPoint",
    "SwingStructure",
]


class ATR:
    """Average true range (Wilder smoothing).

    True range includes the gap from the previous close, so a market that opens through a
    stop is measured as the volatility it actually was rather than as a quiet bar.
    """

    __slots__ = ("_atr", "_period", "_prev_close", "_seed", "_seed_count")

    def __init__(self, period: int = 14) -> None:
        if period < 1:
            raise ValueError(f"ATR period must be >= 1, got {period}")
        self._period = period
        self._prev_close: float | None = None
        self._seed = 0.0
        self._seed_count = 0
        self._atr: float | None = None

    def update(self, bar: BarEvent) -> None:
        bar.require_closed()
        if self._prev_close is None:
            true_range = bar.high - bar.low
        else:
            true_range = max(
                bar.high - bar.low,
                abs(bar.high - self._prev_close),
                abs(bar.low - self._prev_close),
            )
        self._prev_close = bar.close

        if self._atr is None:
            self._seed += true_range
            self._seed_count += 1
            if self._seed_count == self._period:
                self._atr = self._seed / self._period
            return
        # Wilder's smoothing: equivalent to an EMA with alpha = 1/period.
        self._atr = (self._atr * (self._period - 1) + true_range) / self._period

    @property
    def is_ready(self) -> bool:
        return self._atr is not None

    @property
    def value(self) -> float:
        if self._atr is None:
            raise NotReady(f"ATR({self._period}) has {self._seed_count} of {self._period} bars")
        return self._atr


class AnchoredVWAP:
    """Volume-weighted average price from an anchor, with standard-deviation bands.

    Built from **trade prints only**.  A VWAP computed from quote mids is not a VWAP, and
    substituting one when a period had no trades would invent a level the market never
    transacted at.

    The variance is volume-weighted around the running VWAP, which is the dispersion a
    mean-reversion band should use: it measures where volume actually traded, not where
    the midpoint wandered.
    """

    __slots__ = ("_anchor_ns", "_m2", "_notional", "_trade_count", "_volume", "_vwap")

    def __init__(self) -> None:
        self._anchor_ns: Nanos = 0
        self._notional = 0.0
        self._volume = 0.0
        self._vwap = 0.0
        self._m2 = 0.0
        self._trade_count = 0

    def anchor(self, ts: Nanos) -> None:
        """Reset the accumulation to start at ``ts`` (a session open, or an event)."""
        self._anchor_ns = ts
        self._notional = 0.0
        self._volume = 0.0
        self._vwap = 0.0
        self._m2 = 0.0
        self._trade_count = 0

    @property
    def anchor_ns(self) -> Nanos:
        return self._anchor_ns

    def update_trade(self, price: float, size: float) -> None:
        if size <= 0:
            return
        self._volume += size
        self._notional += price * size
        previous = self._vwap
        self._vwap = self._notional / self._volume
        # Volume-weighted West's algorithm for the running dispersion.
        self._m2 += size * (price - previous) * (price - self._vwap)
        self._trade_count += 1

    def update_bar(self, bar: BarEvent) -> None:
        """Fold a closed bar in via its own VWAP, when tick data is unavailable."""
        bar.require_closed()
        if bar.volume > 0 and bar.vwap is not None:
            self.update_trade(bar.vwap, bar.volume)

    @property
    def is_ready(self) -> bool:
        return self._volume > 0

    @property
    def trade_count(self) -> int:
        return self._trade_count

    @property
    def value(self) -> float:
        if self._volume <= 0:
            raise NotReady("AnchoredVWAP has no volume since the anchor")
        return self._vwap

    @property
    def std(self) -> float:
        """Volume-weighted standard deviation of traded price around the VWAP."""
        if self._volume <= 0:
            raise NotReady("AnchoredVWAP has no volume since the anchor")
        return math.sqrt(max(0.0, self._m2 / self._volume))

    def band(self, sigma: float) -> tuple[float, float]:
        """``(lower, upper)`` band at ``sigma`` standard deviations."""
        std = self.std
        return self.value - sigma * std, self.value + sigma * std

    def deviation_sigma(self, price: float) -> float | None:
        """How many standard deviations ``price`` sits from the VWAP.

        ``None`` when dispersion is zero — every print at one price.  Returning ``0``
        there would read as "at the mean" and let a strategy fire on a degenerate band.
        """
        std = self.std
        if std <= 0:
            return None
        return (price - self.value) / std


class RSI:
    """Relative strength index (Wilder)."""

    __slots__ = ("_avg_gain", "_avg_loss", "_period", "_prev_close", "_seed_count", "_seed_gain", "_seed_loss")

    def __init__(self, period: int = 14) -> None:
        if period < 2:
            raise ValueError(f"RSI period must be >= 2, got {period}")
        self._period = period
        self._prev_close: float | None = None
        self._seed_gain = 0.0
        self._seed_loss = 0.0
        self._seed_count = 0
        self._avg_gain: float | None = None
        self._avg_loss: float | None = None

    def update(self, close: float) -> None:
        if self._prev_close is None:
            self._prev_close = close
            return
        change = close - self._prev_close
        self._prev_close = close
        gain, loss = max(0.0, change), max(0.0, -change)

        if self._avg_gain is None:
            self._seed_gain += gain
            self._seed_loss += loss
            self._seed_count += 1
            if self._seed_count == self._period:
                self._avg_gain = self._seed_gain / self._period
                self._avg_loss = self._seed_loss / self._period
            return
        assert self._avg_loss is not None
        self._avg_gain = (self._avg_gain * (self._period - 1) + gain) / self._period
        self._avg_loss = (self._avg_loss * (self._period - 1) + loss) / self._period

    @property
    def is_ready(self) -> bool:
        return self._avg_gain is not None

    @property
    def value(self) -> float:
        if self._avg_gain is None or self._avg_loss is None:
            raise NotReady(f"RSI({self._period}) is still seeding")
        if self._avg_loss == 0:
            return 100.0
        rs = self._avg_gain / self._avg_loss
        return 100.0 - 100.0 / (1.0 + rs)


class ROC:
    """Rate of change over ``period`` observations, as a fraction."""

    __slots__ = ("_buffer", "_period")

    def __init__(self, period: int = 10) -> None:
        if period < 1:
            raise ValueError(f"ROC period must be >= 1, got {period}")
        self._period = period
        self._buffer: deque[float] = deque(maxlen=period + 1)

    def update(self, value: float) -> None:
        self._buffer.append(value)

    @property
    def is_ready(self) -> bool:
        return len(self._buffer) == self._period + 1

    @property
    def value(self) -> float:
        if not self.is_ready:
            raise NotReady(f"ROC({self._period}) has {len(self._buffer)} samples")
        old = self._buffer[0]
        if old == 0:
            raise NotReady("ROC base value is zero")
        return (self._buffer[-1] - old) / old


class MACD:
    """Moving-average convergence/divergence."""

    __slots__ = ("_fast", "_signal", "_slow")

    def __init__(self, fast: int = 12, slow: int = 26, signal: int = 9) -> None:
        if fast >= slow:
            raise ValueError(f"MACD fast ({fast}) must be shorter than slow ({slow})")
        self._fast = EMA(fast)
        self._slow = EMA(slow)
        self._signal = EMA(signal)

    def update(self, value: float) -> None:
        self._fast.update(value)
        self._slow.update(value)
        if self._fast.is_ready and self._slow.is_ready:
            self._signal.update(self._fast.value - self._slow.value)

    @property
    def is_ready(self) -> bool:
        return self._signal.is_ready

    @property
    def line(self) -> float:
        return self._fast.value - self._slow.value

    @property
    def signal(self) -> float:
        return self._signal.value

    @property
    def histogram(self) -> float:
        return self.line - self.signal


class RealizedVolatility:
    """Annualised realised volatility from log returns of closed bars."""

    __slots__ = ("_bars_per_year", "_last_close", "_std")

    def __init__(self, period: int = 20, bars_per_year: float = 252 * 390) -> None:
        self._std = RollingStd(period)
        self._last_close: float | None = None
        self._bars_per_year = bars_per_year

    def update(self, close: float) -> None:
        if self._last_close is not None and self._last_close > 0 and close > 0:
            self._std.update(math.log(close / self._last_close))
        self._last_close = close

    @property
    def is_ready(self) -> bool:
        return self._std.is_ready

    @property
    def value(self) -> float:
        """Annualised standard deviation of log returns."""
        return self._std.value * math.sqrt(self._bars_per_year)


class ParkinsonVolatility:
    """Parkinson high/low range estimator, annualised.

    Uses intrabar range rather than close-to-close, so it is roughly five times more
    efficient per observation — worthwhile when bars are scarce.
    """

    __slots__ = ("_bars_per_year", "_buffer", "_period")

    _FACTOR = 1.0 / (4.0 * math.log(2.0))

    def __init__(self, period: int = 20, bars_per_year: float = 252 * 390) -> None:
        if period < 2:
            raise ValueError(f"Parkinson period must be >= 2, got {period}")
        self._period = period
        self._buffer: deque[float] = deque(maxlen=period)
        self._bars_per_year = bars_per_year

    def update(self, bar: BarEvent) -> None:
        bar.require_closed()
        if bar.low > 0 and bar.high > 0:
            self._buffer.append(math.log(bar.high / bar.low) ** 2)

    @property
    def is_ready(self) -> bool:
        return len(self._buffer) == self._period

    @property
    def value(self) -> float:
        if not self.is_ready:
            raise NotReady(f"Parkinson({self._period}) has {len(self._buffer)} bars")
        mean_sq = math.fsum(self._buffer) / self._period
        return math.sqrt(self._FACTOR * mean_sq * self._bars_per_year)


@dataclass(frozen=True, slots=True)
class SwingPoint:
    """A confirmed swing high or low."""

    ts: Nanos
    price: float
    is_high: bool


class SwingStructure:
    """Market structure from confirmed swing points.

    A swing is confirmed only after ``strength`` bars have printed on **both** sides of
    it.  That delay is the honest one: identifying a swing from bars that have not yet
    printed is the most common look-ahead bug in structure-based strategies.  Everything
    here is therefore reported with a lag of ``strength`` bars, by construction.
    """

    __slots__ = ("_bars", "_last_break", "_strength", "_swings", "_trend")

    def __init__(self, strength: int = 2, max_swings: int = 20) -> None:
        if strength < 1:
            raise ValueError(f"swing strength must be >= 1, got {strength}")
        self._strength = strength
        self._bars: deque[BarEvent] = deque(maxlen=2 * strength + 1)
        self._swings: deque[SwingPoint] = deque(maxlen=max_swings)
        self._trend = 0
        self._last_break: str | None = None

    def update(self, bar: BarEvent) -> None:
        bar.require_closed()
        self._bars.append(bar)
        if len(self._bars) < 2 * self._strength + 1:
            return

        centre = self._bars[self._strength]
        others = [b for i, b in enumerate(self._bars) if i != self._strength]
        if all(centre.high > b.high for b in others):
            self._add(SwingPoint(centre.ts_close, centre.high, is_high=True))
        elif all(centre.low < b.low for b in others):
            self._add(SwingPoint(centre.ts_close, centre.low, is_high=False))

    def _add(self, point: SwingPoint) -> None:
        self._swings.append(point)
        self._classify()

    def _classify(self) -> None:
        highs = [s for s in self._swings if s.is_high]
        lows = [s for s in self._swings if not s.is_high]
        if len(highs) < 2 or len(lows) < 2:
            return
        higher_high = highs[-1].price > highs[-2].price
        higher_low = lows[-1].price > lows[-2].price
        lower_high = highs[-1].price < highs[-2].price
        lower_low = lows[-1].price < lows[-2].price

        previous = self._trend
        if higher_high and higher_low:
            self._trend = 1
        elif lower_high and lower_low:
            self._trend = -1

        if previous != 0 and self._trend != 0 and previous != self._trend:
            # Change of character: structure flipped direction.
            self._last_break = "CHOCH"
        elif self._trend != 0 and previous == self._trend:
            self._last_break = "BOS"

    @property
    def is_ready(self) -> bool:
        return len([s for s in self._swings if s.is_high]) >= 2 and (
            len([s for s in self._swings if not s.is_high]) >= 2
        )

    @property
    def trend(self) -> int:
        """``1`` for higher highs and lows, ``-1`` for lower, ``0`` for undetermined."""
        return self._trend

    @property
    def last_break(self) -> str | None:
        """``"BOS"``, ``"CHOCH"`` or ``None``."""
        return self._last_break

    @property
    def last_swing_high(self) -> SwingPoint | None:
        highs = [s for s in self._swings if s.is_high]
        return highs[-1] if highs else None

    @property
    def last_swing_low(self) -> SwingPoint | None:
        lows = [s for s in self._swings if not s.is_high]
        return lows[-1] if lows else None


class SessionRange:
    """Session and previous-session extremes — the liquidity levels of §6.

    Previous-session values are only published once a session has actually completed, so
    the "previous day high" on the first day of a dataset is ``None`` rather than a
    partial figure computed from whatever data happened to load first.
    """

    __slots__ = ("_high", "_low", "_open", "_prev_close", "_prev_high", "_prev_low", "_session_ns")

    def __init__(self) -> None:
        self._session_ns: Nanos = 0
        self._high: float | None = None
        self._low: float | None = None
        self._open: float | None = None
        self._prev_high: float | None = None
        self._prev_low: float | None = None
        self._prev_close: float | None = None

    def start_session(self, ts: Nanos, previous_close: float | None = None) -> None:
        """Roll to a new session, promoting the current extremes to 'previous'."""
        if self._high is not None and self._low is not None:
            self._prev_high, self._prev_low = self._high, self._low
            self._prev_close = previous_close if previous_close is not None else self._prev_close
        self._session_ns = ts
        self._high = self._low = self._open = None

    def update(self, bar: BarEvent) -> None:
        bar.require_closed()
        if self._open is None:
            self._open = bar.open
        self._high = bar.high if self._high is None else max(self._high, bar.high)
        self._low = bar.low if self._low is None else min(self._low, bar.low)
        self._prev_close = bar.close

    @property
    def session_high(self) -> float | None:
        return self._high

    @property
    def session_low(self) -> float | None:
        return self._low

    @property
    def session_open(self) -> float | None:
        return self._open

    @property
    def previous_high(self) -> float | None:
        return self._prev_high

    @property
    def previous_low(self) -> float | None:
        return self._prev_low

    @property
    def previous_close(self) -> float | None:
        return self._prev_close


class OpeningRange:
    """High and low of the first ``minutes`` of a session."""

    __slots__ = ("_end_ns", "_high", "_low", "_minutes", "_start_ns")

    def __init__(self, minutes: float = 15.0) -> None:
        if minutes <= 0:
            raise ValueError(f"opening range minutes must be positive, got {minutes}")
        self._minutes = minutes
        self._start_ns: Nanos = 0
        self._end_ns: Nanos = 0
        self._high: float | None = None
        self._low: float | None = None

    def start_session(self, session_open_ns: Nanos) -> None:
        self._start_ns = session_open_ns
        self._end_ns = session_open_ns + int(self._minutes * 60 * 1_000_000_000)
        self._high = self._low = None

    def update(self, bar: BarEvent) -> None:
        bar.require_closed()
        if self._end_ns == 0 or bar.ts_close > self._end_ns:
            return
        self._high = bar.high if self._high is None else max(self._high, bar.high)
        self._low = bar.low if self._low is None else min(self._low, bar.low)

    def is_complete(self, ts: Nanos) -> bool:
        return self._end_ns > 0 and ts >= self._end_ns and self._high is not None

    @property
    def high(self) -> float | None:
        return self._high

    @property
    def low(self) -> float | None:
        return self._low

    @property
    def range(self) -> float | None:
        if self._high is None or self._low is None:
            return None
        return self._high - self._low


class OrderFlowTracker:
    """Delta, cumulative delta and aggression ratios from tagged prints.

    Prints with :attr:`~core.events.enums.Aggressor.UNKNOWN` are counted separately and
    excluded from delta.  Splitting them evenly, or assigning them by the last quote,
    would manufacture order flow that was never observed.
    """

    __slots__ = (
        "_buy_volume",
        "_cumulative_delta",
        "_delta_window",
        "_sell_volume",
        "_trade_count",
        "_unknown_volume",
    )

    def __init__(self, window: int = 100) -> None:
        self._buy_volume = 0.0
        self._sell_volume = 0.0
        self._unknown_volume = 0.0
        self._cumulative_delta = 0.0
        self._trade_count = 0
        self._delta_window: deque[float] = deque(maxlen=window)

    def update(self, trade: TradeEvent) -> None:
        self._trade_count += 1
        if trade.aggressor is Aggressor.BUY:
            self._buy_volume += trade.size
            self._cumulative_delta += trade.size
            self._delta_window.append(trade.size)
        elif trade.aggressor is Aggressor.SELL:
            self._sell_volume += trade.size
            self._cumulative_delta -= trade.size
            self._delta_window.append(-trade.size)
        else:
            self._unknown_volume += trade.size
            self._delta_window.append(0.0)

    def reset_session(self) -> None:
        self._buy_volume = self._sell_volume = self._unknown_volume = 0.0
        self._cumulative_delta = 0.0
        self._trade_count = 0
        self._delta_window.clear()

    @property
    def cumulative_delta(self) -> float:
        return self._cumulative_delta

    @property
    def window_delta(self) -> float:
        return math.fsum(self._delta_window)

    @property
    def buy_volume(self) -> float:
        return self._buy_volume

    @property
    def sell_volume(self) -> float:
        return self._sell_volume

    @property
    def unknown_volume(self) -> float:
        """Volume whose aggressor the feed did not tag.  Reported, never allocated."""
        return self._unknown_volume

    @property
    def tagged_volume(self) -> float:
        return self._buy_volume + self._sell_volume

    @property
    def aggressive_buyer_ratio(self) -> float | None:
        """Buy share of *tagged* volume, or ``None`` when nothing was tagged."""
        total = self.tagged_volume
        if total <= 0:
            return None
        return self._buy_volume / total

    @property
    def aggressive_seller_ratio(self) -> float | None:
        ratio = self.aggressive_buyer_ratio
        return None if ratio is None else 1.0 - ratio

    @property
    def trade_imbalance(self) -> float | None:
        """Signed imbalance in [-1, 1], or ``None`` when nothing was tagged."""
        total = self.tagged_volume
        if total <= 0:
            return None
        return (self._buy_volume - self._sell_volume) / total
