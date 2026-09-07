"""Market data events.

The schema is the one mandated by ``DATA_SPEC.md`` §2.  Validation happens in
``core.market_data.normalization``, not in these constructors: an event object is a
*record of what arrived*, including malformed values, and refusing to construct it would
lose the evidence.  The one exception is structural nonsense that would corrupt
downstream arithmetic (non-finite numbers), which is rejected at construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar

from core.events.base import Event
from core.events.enums import Aggressor, EventType, SessionState, Timeframe
from core.util.clock import Nanos
from core.util.numeric import is_finite

__all__ = [
    "BarEvent",
    "NewsEvent",
    "OrderBookEvent",
    "QuoteEvent",
    "SessionEvent",
    "TradeEvent",
]


@dataclass(frozen=True, slots=True)
class QuoteEvent(Event):
    """Top-of-book update."""

    event_type: ClassVar[EventType] = EventType.QUOTE

    bid: float = 0.0
    ask: float = 0.0
    bid_size: float = 0.0
    ask_size: float = 0.0

    def __post_init__(self) -> None:
        # Malformed-but-finite values (crossed book, off-tick price, zero size) are
        # preserved and flagged by the normaliser: discarding them would destroy the
        # evidence of a degraded feed.  Non-finite values are refused outright, because a
        # NaN compares false against every threshold and would pass each risk check it
        # meets downstream.
        for name in ("bid", "ask", "bid_size", "ask_size"):
            value = getattr(self, name)
            if not is_finite(value):
                raise ValueError(f"QuoteEvent.{name} must be finite, got {value!r}")

    @property
    def mid(self) -> float:
        """Arithmetic mid.  Undefined for a one-sided book; see :meth:`is_two_sided`."""
        return (self.bid + self.ask) / 2.0

    @property
    def spread(self) -> float:
        """Absolute spread.  Negative on a crossed book — deliberately not clamped."""
        return self.ask - self.bid

    @property
    def microprice(self) -> float:
        """Size-weighted mid: ``(bid*ask_size + ask*bid_size) / (bid_size + ask_size)``.

        Leans toward the side with less size, which is the side more likely to be
        consumed.  Falls back to :attr:`mid` when both sizes are zero rather than
        dividing by zero.
        """
        total = self.bid_size + self.ask_size
        if total <= 0:
            return self.mid
        return (self.bid * self.ask_size + self.ask * self.bid_size) / total

    @property
    def is_two_sided(self) -> bool:
        """True when both sides carry a usable price and size."""
        return self.bid > 0 and self.ask > 0 and self.bid_size > 0 and self.ask_size > 0

    @property
    def is_crossed(self) -> bool:
        """True when the bid is at or above the ask — a locked or crossed book."""
        return self.bid >= self.ask and self.bid > 0 and self.ask > 0

    def far_touch(self, buying: bool) -> float:
        """Price an aggressor pays: the ask when buying, the bid when selling."""
        return self.ask if buying else self.bid

    def near_touch(self, buying: bool) -> float:
        """Price a passive order rests at: the bid when buying, the ask when selling."""
        return self.bid if buying else self.ask


@dataclass(frozen=True, slots=True)
class TradeEvent(Event):
    """A trade print."""

    event_type: ClassVar[EventType] = EventType.TRADE

    price: float = 0.0
    size: float = 0.0
    aggressor: Aggressor = Aggressor.UNKNOWN
    trade_id: str = ""

    def __post_init__(self) -> None:
        for name in ("price", "size"):
            value = getattr(self, name)
            if not is_finite(value):
                raise ValueError(f"TradeEvent.{name} must be finite, got {value!r}")

    @property
    def notional(self) -> float:
        """Price times size, before any contract multiplier."""
        return self.price * self.size

    @property
    def signed_size(self) -> float:
        """Size signed by aggressor, or ``0.0`` when the aggressor is unknown.

        Returning zero for ``UNKNOWN`` keeps delta calculations honest: an untagged
        print contributes no information about aggression, and assigning it a side would
        manufacture order flow that was never observed.
        """
        if self.aggressor is Aggressor.BUY:
            return self.size
        if self.aggressor is Aggressor.SELL:
            return -self.size
        return 0.0


@dataclass(frozen=True, slots=True)
class OrderBookEvent(Event):
    """Depth snapshot.

    ``bids`` and ``asks`` are ordered best-first tuples of ``(price, size)``.  Tuples
    rather than lists so the event stays hashable and genuinely immutable.
    """

    event_type: ClassVar[EventType] = EventType.ORDERBOOK

    bids: tuple[tuple[float, float], ...] = ()
    asks: tuple[tuple[float, float], ...] = ()
    is_snapshot: bool = True

    @property
    def depth(self) -> int:
        """Number of levels available on the thinner side."""
        return min(len(self.bids), len(self.asks))

    @property
    def best_bid(self) -> tuple[float, float] | None:
        return self.bids[0] if self.bids else None

    @property
    def best_ask(self) -> tuple[float, float] | None:
        return self.asks[0] if self.asks else None

    def liquidity(self, side_bids: bool, levels: int) -> float:
        """Total displayed size over the top ``levels`` of one side."""
        book = self.bids if side_bids else self.asks
        return sum(size for _, size in book[:levels])


@dataclass(frozen=True, slots=True)
class BarEvent(Event):
    """An OHLCV bar.

    Attributes:
        is_closed: ``True`` only for a completed bar.  Historical feature series accept
            closed bars exclusively; passing a partial bar into a series raises, which is
            the mechanical guarantee against look-ahead (``DATA_SPEC.md`` §5).
        vwap: volume-weighted average of trade prints in the period, or ``None`` when the
            period had no trades.  Never substituted with the midpoint.
    """

    event_type: ClassVar[EventType] = EventType.BAR

    timeframe: Timeframe = Timeframe.M1
    ts_open: Nanos = 0
    ts_close: Nanos = 0
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    close: float = 0.0
    volume: float = 0.0
    trade_count: int = 0
    vwap: float | None = None
    is_closed: bool = False

    def __post_init__(self) -> None:
        for name in ("open", "high", "low", "close", "volume"):
            value = getattr(self, name)
            if not is_finite(value):
                raise ValueError(f"BarEvent.{name} must be finite, got {value!r}")
        if self.vwap is not None and not is_finite(self.vwap):
            raise ValueError(f"BarEvent.vwap must be finite or None, got {self.vwap!r}")

    @property
    def range(self) -> float:
        return self.high - self.low

    @property
    def body(self) -> float:
        """Signed close-minus-open."""
        return self.close - self.open

    @property
    def typical_price(self) -> float:
        """``(high + low + close) / 3`` — the standard proxy when no VWAP exists."""
        return (self.high + self.low + self.close) / 3.0

    @property
    def is_valid(self) -> bool:
        """Structural sanity: finite values and ``low <= open, close <= high``."""
        if not all(is_finite(v) for v in (self.open, self.high, self.low, self.close)):
            return False
        return self.low <= min(self.open, self.close) and self.high >= max(self.open, self.close)

    def require_closed(self) -> BarEvent:
        """Return ``self`` if closed, otherwise raise.

        Called by every consumer that appends to a historical series.

        Raises:
            ValueError: when the bar is still forming.
        """
        if not self.is_closed:
            raise ValueError(
                f"partial {self.timeframe.value} bar for {self.instrument_id} "
                f"at {self.ts_close} used where a closed bar is required "
                "(look-ahead guard, DATA_SPEC.md §5)"
            )
        return self


@dataclass(frozen=True, slots=True)
class SessionEvent(Event):
    """A change in venue session state."""

    event_type: ClassVar[EventType] = EventType.SESSION

    session_state: SessionState = SessionState.CLOSED
    session_id: str = ""
    session_date: str = ""

    @property
    def is_tradeable(self) -> bool:
        return self.session_state is SessionState.OPEN


@dataclass(frozen=True, slots=True)
class NewsEvent(Event):
    """A scheduled or breaking news item, used for blackout windows."""

    event_type: ClassVar[EventType] = EventType.NEWS

    headline: str = ""
    importance: int = 0
    scheduled_ts: Nanos = 0
    affected_instruments: tuple[str, ...] = ()
    category: str = ""

    @property
    def is_high_impact(self) -> bool:
        """Importance 3 on the conventional 1–3 scale (e.g. FOMC, NFP, CPI)."""
        return self.importance >= 3
