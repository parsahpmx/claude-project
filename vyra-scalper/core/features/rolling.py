"""Incremental rolling statistics.

Every primitive here is **streaming**: it accepts one observation at a time in O(1) and
never holds the full history.  Two reasons, both structural rather than stylistic:

* a scalping engine cannot afford to recompute a window on every tick;
* an accumulator that has only ever seen past observations *cannot* look ahead, whereas a
  function over an array can be given a slice that includes the future.

Each estimator reports :attr:`is_ready`.  Reading a value before it is ready raises rather
than returning a partially-warmed number, because a strategy trading on a 3-sample "20
period" average is trading on something other than what its configuration claims.
"""

from __future__ import annotations

import math
from collections import deque

__all__ = ["EMA", "SMA", "NotReady", "RollingMax", "RollingMin", "RollingStd", "WelfordVar"]


class NotReady(RuntimeError):
    """Raised when a statistic is read before its window has filled."""


class SMA:
    """Simple moving average over a fixed window.

    Maintains a running sum, and periodically re-sums to bound floating-point drift: over
    a multi-day tick session an incrementally maintained sum accumulates error that
    eventually shows up in the last decimal places of a signal threshold.
    """

    __slots__ = ("_buffer", "_period", "_resum_countdown", "_sum")

    _RESUM_INTERVAL = 10_000

    def __init__(self, period: int) -> None:
        if period < 1:
            raise ValueError(f"SMA period must be >= 1, got {period}")
        self._period = period
        self._buffer: deque[float] = deque(maxlen=period)
        self._sum = 0.0
        self._resum_countdown = self._RESUM_INTERVAL

    def update(self, value: float) -> None:
        if len(self._buffer) == self._period:
            self._sum -= self._buffer[0]
        self._buffer.append(value)
        self._sum += value
        self._resum_countdown -= 1
        if self._resum_countdown <= 0:
            self._sum = math.fsum(self._buffer)
            self._resum_countdown = self._RESUM_INTERVAL

    @property
    def is_ready(self) -> bool:
        return len(self._buffer) == self._period

    @property
    def value(self) -> float:
        if not self.is_ready:
            raise NotReady(f"SMA({self._period}) has {len(self._buffer)} of {self._period} samples")
        return self._sum / self._period

    @property
    def count(self) -> int:
        return len(self._buffer)


class EMA:
    """Exponential moving average with an SMA seed.

    Seeding from the first ``period`` observations rather than from the first single
    observation removes the long startup transient that otherwise makes the first hundred
    bars of every backtest behave differently from the rest.
    """

    __slots__ = ("_alpha", "_period", "_seed", "_value")

    def __init__(self, period: int) -> None:
        if period < 1:
            raise ValueError(f"EMA period must be >= 1, got {period}")
        self._period = period
        self._alpha = 2.0 / (period + 1.0)
        self._seed = SMA(period)
        self._value: float | None = None

    def update(self, value: float) -> None:
        if self._value is None:
            self._seed.update(value)
            if self._seed.is_ready:
                self._value = self._seed.value
            return
        self._value += self._alpha * (value - self._value)

    @property
    def is_ready(self) -> bool:
        return self._value is not None

    @property
    def value(self) -> float:
        if self._value is None:
            raise NotReady(f"EMA({self._period}) is still seeding ({self._seed.count} samples)")
        return self._value


class WelfordVar:
    """Streaming mean and variance (Welford's algorithm).

    Numerically stable where the naive "sum of squares minus square of sum" is not: for
    index prices near 5 000, that formula loses most of its significant digits and can
    return a negative variance.
    """

    __slots__ = ("_count", "_m2", "_mean")

    def __init__(self) -> None:
        self._count = 0
        self._mean = 0.0
        self._m2 = 0.0

    def update(self, value: float) -> None:
        self._count += 1
        delta = value - self._mean
        self._mean += delta / self._count
        self._m2 += delta * (value - self._mean)

    @property
    def count(self) -> int:
        return self._count

    @property
    def mean(self) -> float:
        if self._count == 0:
            raise NotReady("WelfordVar has no samples")
        return self._mean

    @property
    def variance(self) -> float:
        """Sample variance (n-1 denominator).  Requires at least two observations."""
        if self._count < 2:
            raise NotReady(f"WelfordVar needs 2 samples for variance, has {self._count}")
        return self._m2 / (self._count - 1)

    @property
    def std(self) -> float:
        return math.sqrt(max(0.0, self.variance))

    @property
    def is_ready(self) -> bool:
        return self._count >= 2


class RollingStd:
    """Standard deviation over a fixed window.

    Recomputed from the window with :func:`math.fsum` rather than maintained
    incrementally: a rolling Welford update with removals is unstable, and the window
    sizes used here (tens to low hundreds) make the exact computation cheap enough.
    """

    __slots__ = ("_buffer", "_period")

    def __init__(self, period: int) -> None:
        if period < 2:
            raise ValueError(f"RollingStd period must be >= 2, got {period}")
        self._period = period
        self._buffer: deque[float] = deque(maxlen=period)

    def update(self, value: float) -> None:
        self._buffer.append(value)

    @property
    def is_ready(self) -> bool:
        return len(self._buffer) == self._period

    @property
    def mean(self) -> float:
        if not self.is_ready:
            raise NotReady(f"RollingStd({self._period}) has {len(self._buffer)} samples")
        return math.fsum(self._buffer) / self._period

    @property
    def value(self) -> float:
        mean = self.mean
        variance = math.fsum((x - mean) ** 2 for x in self._buffer) / (self._period - 1)
        return math.sqrt(max(0.0, variance))

    @property
    def count(self) -> int:
        return len(self._buffer)


class _RollingExtreme:
    """Monotonic-deque extreme over a window, O(1) amortised per update."""

    __slots__ = ("_deque", "_index", "_period", "_is_max")

    def __init__(self, period: int, is_max: bool) -> None:
        if period < 1:
            raise ValueError(f"rolling extreme period must be >= 1, got {period}")
        self._period = period
        self._is_max = is_max
        self._deque: deque[tuple[int, float]] = deque()
        self._index = 0

    def update(self, value: float) -> None:
        self._index += 1
        while self._deque and (
            (self._deque[-1][1] <= value) if self._is_max else (self._deque[-1][1] >= value)
        ):
            self._deque.pop()
        self._deque.append((self._index, value))
        while self._deque and self._deque[0][0] <= self._index - self._period:
            self._deque.popleft()

    @property
    def is_ready(self) -> bool:
        return self._index >= self._period

    @property
    def value(self) -> float:
        if not self._deque:
            raise NotReady("rolling extreme has no samples")
        return self._deque[0][1]

    @property
    def count(self) -> int:
        return self._index


class RollingMax(_RollingExtreme):
    """Maximum over the last ``period`` observations."""

    def __init__(self, period: int) -> None:
        super().__init__(period, is_max=True)


class RollingMin(_RollingExtreme):
    """Minimum over the last ``period`` observations."""

    def __init__(self, period: int) -> None:
        super().__init__(period, is_max=False)
