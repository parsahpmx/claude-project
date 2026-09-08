"""Order book microstructure.

Computes the depth-derived quantities of ``DATA_SPEC.md`` §6 from a stream of
:class:`~core.events.market.OrderBookEvent` snapshots and trade prints.

**The CFD boundary is enforced here, not by convention.** A broker CFD "book" is that
broker's own quoting, not centralised market liquidity, and treating the two as the same
kind of evidence is how a microstructure strategy ends up trading one broker's spread
policy. Features are therefore namespaced by provenance — ``exch.*`` for a venue with real
depth, ``cfd.*`` for broker quoting — and :meth:`OrderBookEngine.features` refuses to emit
under the wrong namespace for the instrument's asset class.

Everything is incremental. Nothing holds a window it could index into the future.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from core.events import OrderBookEvent, TradeEvent
from core.instruments.instrument import Instrument
from core.util.clock import NS_PER_SEC, Nanos

__all__ = [
    "BookSnapshot",
    "DepthNamespace",
    "LiquidityWall",
    "OrderBookEngine",
]


class DepthNamespace:
    """Feature-name prefixes that keep provenance attached to the number.

    Two constants rather than an enum because they are string prefixes used in feature
    keys, and a stable string is what the rest of the system stores and queries.
    """

    EXCHANGE = "exch"
    CFD = "cfd"

    @staticmethod
    def for_instrument(instrument: Instrument) -> str:
        return (
            DepthNamespace.EXCHANGE
            if instrument.supports_exchange_depth
            else DepthNamespace.CFD
        )


@dataclass(frozen=True, slots=True)
class LiquidityWall:
    """A level holding conspicuously more size than its neighbours."""

    price: float
    size: float
    is_bid: bool
    multiple_of_median: float

    def to_dict(self) -> dict[str, float | bool]:
        return {
            "price": self.price,
            "size": self.size,
            "is_bid": self.is_bid,
            "multiple_of_median": round(self.multiple_of_median, 4),
        }


@dataclass(frozen=True, slots=True)
class BookSnapshot:
    """Derived quantities for one book state."""

    ts: Nanos
    spread: float
    mid: float
    microprice: float
    bid_liquidity: float
    ask_liquidity: float
    book_imbalance: float
    depth_imbalance: float

    @property
    def microprice_deviation(self) -> float:
        """How far the size-weighted mid sits from the arithmetic mid."""
        return self.microprice - self.mid


class OrderBookEngine:
    """Incremental microstructure statistics for one instrument.

    Args:
        instrument: determines the feature namespace and the tick scale.
        levels: depth levels included in liquidity and imbalance sums.
        wall_multiple: size relative to the median level above which a level is a wall.
        large_trade_multiple: trade size relative to the running median above which a
            print is "large".
        window_seconds: lookback for rate statistics (trade velocity, arrival and
            cancellation rates).
        history: number of observations retained for the running medians.
    """

    __slots__ = (
        "_arrivals",
        "_cancellations",
        "_cumulative_delta",
        "_instrument",
        "_large_trade_multiple",
        "_last_book",
        "_last_levels",
        "_levels",
        "_namespace",
        "_session_delta",
        "_size_history",
        "_snapshot",
        "_trade_sizes",
        "_trades",
        "_wall_multiple",
        "_window_ns",
    )

    def __init__(
        self,
        instrument: Instrument,
        levels: int = 5,
        wall_multiple: float = 3.0,
        large_trade_multiple: float = 5.0,
        window_seconds: float = 10.0,
        history: int = 500,
    ) -> None:
        if levels < 1:
            raise ValueError(f"levels must be at least 1, got {levels}")
        if wall_multiple <= 1:
            raise ValueError(f"wall_multiple must exceed 1, got {wall_multiple}")
        if window_seconds <= 0:
            raise ValueError(f"window_seconds must be positive, got {window_seconds}")

        self._instrument = instrument
        self._namespace = DepthNamespace.for_instrument(instrument)
        self._levels = levels
        self._wall_multiple = wall_multiple
        self._large_trade_multiple = large_trade_multiple
        self._window_ns = int(window_seconds * NS_PER_SEC)

        self._snapshot: BookSnapshot | None = None
        self._last_book: OrderBookEvent | None = None
        self._last_levels: dict[tuple[bool, float], float] = {}
        self._size_history: deque[float] = deque(maxlen=history)
        self._trade_sizes: deque[float] = deque(maxlen=history)
        self._trades: deque[tuple[Nanos, float, int]] = deque()
        self._arrivals: deque[Nanos] = deque()
        self._cancellations: deque[Nanos] = deque()
        self._cumulative_delta = 0.0
        self._session_delta = 0.0

    # -- identity -----------------------------------------------------------------------

    @property
    def namespace(self) -> str:
        """``exch`` or ``cfd``. Travels with every feature this engine emits."""
        return self._namespace

    @property
    def is_exchange_depth(self) -> bool:
        return self._namespace == DepthNamespace.EXCHANGE

    @property
    def snapshot(self) -> BookSnapshot | None:
        return self._snapshot

    @property
    def cumulative_delta(self) -> float:
        return self._cumulative_delta

    # -- ingestion ----------------------------------------------------------------------

    def on_book(self, event: OrderBookEvent) -> BookSnapshot | None:
        """Fold in a depth snapshot and recompute the derived quantities."""
        if not event.bids or not event.asks:
            return None

        best_bid, bid_size = event.bids[0]
        best_ask, ask_size = event.asks[0]
        if best_bid <= 0 or best_ask <= 0:
            return None

        mid = (best_bid + best_ask) / 2.0
        top_total = bid_size + ask_size
        microprice = (
            (best_bid * ask_size + best_ask * bid_size) / top_total if top_total > 0 else mid
        )

        bid_liquidity = event.liquidity(side_bids=True, levels=self._levels)
        ask_liquidity = event.liquidity(side_bids=False, levels=self._levels)

        self._track_level_changes(event)
        for _, size in list(event.bids[: self._levels]) + list(event.asks[: self._levels]):
            if size > 0:
                self._size_history.append(size)

        self._snapshot = BookSnapshot(
            ts=event.ts,
            spread=best_ask - best_bid,
            mid=mid,
            microprice=microprice,
            # Top-of-book imbalance: where the pressure is right now.
            book_imbalance=self._ratio(bid_size, ask_size),
            # Depth imbalance over `levels`: where it is across the visible book.
            depth_imbalance=self._ratio(bid_liquidity, ask_liquidity),
            bid_liquidity=bid_liquidity,
            ask_liquidity=ask_liquidity,
        )
        self._last_book = event
        return self._snapshot

    def on_trade(self, event: TradeEvent) -> None:
        """Fold in a trade print.

        Prints with an unknown aggressor contribute to volume and velocity but **not** to
        delta: an untagged print carries no information about aggression, and assigning it
        a side would manufacture order flow that was never observed.
        """
        if event.size <= 0:
            return
        signed = event.signed_size
        self._cumulative_delta += signed
        self._session_delta += signed
        self._trade_sizes.append(event.size)
        self._trades.append(
            (event.ts, event.size, 1 if signed > 0 else (-1 if signed < 0 else 0))
        )
        self._expire(event.ts)

    def _track_level_changes(self, event: OrderBookEvent) -> None:
        """Infer order arrivals and cancellations from level-size changes.

        This is an *estimate*: a snapshot feed shows net change, not individual messages,
        so a cancel and an add at one level within a snapshot interval are invisible. The
        rates below are therefore lower bounds and are named as rates rather than counts.
        """
        current: dict[tuple[bool, float], float] = {}
        for price, size in event.bids[: self._levels]:
            current[(True, price)] = size
        for price, size in event.asks[: self._levels]:
            current[(False, price)] = size

        for key, size in current.items():
            previous = self._last_levels.get(key, 0.0)
            if size > previous:
                self._arrivals.append(event.ts)
            elif size < previous:
                self._cancellations.append(event.ts)
        for key, previous in self._last_levels.items():
            if key not in current and previous > 0:
                self._cancellations.append(event.ts)

        self._last_levels = current
        self._expire(event.ts)

    def _expire(self, now: Nanos) -> None:
        cutoff = now - self._window_ns
        while self._trades and self._trades[0][0] < cutoff:
            self._trades.popleft()
        while self._arrivals and self._arrivals[0] < cutoff:
            self._arrivals.popleft()
        while self._cancellations and self._cancellations[0] < cutoff:
            self._cancellations.popleft()

    @staticmethod
    def _ratio(bid: float, ask: float) -> float:
        """Signed imbalance in [-1, 1]. Zero when both sides are empty."""
        total = bid + ask
        if total <= 0:
            return 0.0
        return (bid - ask) / total

    # -- derived statistics --------------------------------------------------------------

    @property
    def trade_velocity(self) -> float:
        """Trades per second over the window."""
        return len(self._trades) / (self._window_ns / NS_PER_SEC)

    @property
    def order_arrival_rate(self) -> float:
        """Estimated level additions per second. A lower bound; see :meth:`_track_level_changes`."""
        return len(self._arrivals) / (self._window_ns / NS_PER_SEC)

    @property
    def cancellation_rate(self) -> float:
        """Estimated level reductions per second. A lower bound."""
        return len(self._cancellations) / (self._window_ns / NS_PER_SEC)

    @property
    def window_delta(self) -> float:
        return math.fsum(size * side for _, size, side in self._trades)

    @property
    def buy_volume(self) -> float:
        return math.fsum(size for _, size, side in self._trades if side > 0)

    @property
    def sell_volume(self) -> float:
        return math.fsum(size for _, size, side in self._trades if side < 0)

    @property
    def trade_imbalance(self) -> float | None:
        """Signed imbalance of *tagged* volume, or ``None`` when nothing was tagged."""
        tagged = self.buy_volume + self.sell_volume
        if tagged <= 0:
            return None
        return (self.buy_volume - self.sell_volume) / tagged

    def liquidity_walls(self) -> tuple[LiquidityWall, ...]:
        """Levels holding conspicuously more than the median level."""
        if self._last_book is None or len(self._size_history) < self._levels:
            return ()
        median = sorted(self._size_history)[len(self._size_history) // 2]
        if median <= 0:
            return ()

        walls: list[LiquidityWall] = []
        for is_bid, book in ((True, self._last_book.bids), (False, self._last_book.asks)):
            for price, size in book[: self._levels]:
                multiple = size / median
                if multiple >= self._wall_multiple:
                    walls.append(LiquidityWall(price, size, is_bid, multiple))
        return tuple(walls)

    def is_large_trade(self, size: float) -> bool:
        """Whether ``size`` is large relative to the running median print."""
        if len(self._trade_sizes) < 20:
            return False
        median = sorted(self._trade_sizes)[len(self._trade_sizes) // 2]
        return median > 0 and size >= median * self._large_trade_multiple

    def absorption(self) -> float | None:
        """Volume traded per tick of price movement, over the window.

        High absorption means size is being taken without the price moving — someone is
        filling a large order passively. ``None`` when the book has not moved enough to
        measure, which is different from "no absorption".
        """
        if self._snapshot is None or not self._trades:
            return None
        volume = math.fsum(size for _, size, _ in self._trades)
        if volume <= 0:
            return None
        prices = [self._snapshot.mid]
        if self._last_book is not None and self._last_book.bids and self._last_book.asks:
            prices.append((self._last_book.bids[0][0] + self._last_book.asks[0][0]) / 2.0)
        movement_ticks = abs(max(prices) - min(prices)) / self._instrument.tick_size
        if movement_ticks < 1.0:
            movement_ticks = 1.0  # floor at one tick: dividing by zero movement is undefined
        return volume / movement_ticks

    def reset_session(self) -> None:
        self._session_delta = 0.0
        self._trades.clear()
        self._arrivals.clear()
        self._cancellations.clear()

    # -- feature emission ---------------------------------------------------------------

    def features(self, namespace: str | None = None) -> dict[str, float]:
        """Emit the derived quantities, namespaced by provenance.

        Args:
            namespace: assert the expected namespace. Supplying one that does not match
                the instrument raises, which is what prevents a strategy configured for
                exchange microstructure from silently consuming a broker's CFD quoting.

        Raises:
            ValueError: when ``namespace`` disagrees with the instrument's asset class.
        """
        if namespace is not None and namespace != self._namespace:
            raise ValueError(
                f"{self._instrument.instrument_id} provides {self._namespace!r} depth, but "
                f"{namespace!r} was requested. Broker CFD quoting is not centralised "
                "market liquidity and the two must not be mixed (DATA_SPEC.md §6)."
            )
        if self._snapshot is None:
            return {}

        prefix = self._namespace
        snapshot = self._snapshot
        tick = self._instrument.tick_size
        values: dict[str, float] = {
            f"{prefix}.spread": snapshot.spread,
            f"{prefix}.spread_ticks": snapshot.spread / tick,
            f"{prefix}.mid": snapshot.mid,
            f"{prefix}.microprice": snapshot.microprice,
            f"{prefix}.microprice_deviation_ticks": snapshot.microprice_deviation / tick,
            f"{prefix}.bid_liquidity": snapshot.bid_liquidity,
            f"{prefix}.ask_liquidity": snapshot.ask_liquidity,
            f"{prefix}.book_imbalance": snapshot.book_imbalance,
            f"{prefix}.depth_imbalance": snapshot.depth_imbalance,
            f"{prefix}.cumulative_delta": self._cumulative_delta,
            f"{prefix}.window_delta": self.window_delta,
            f"{prefix}.buy_volume": self.buy_volume,
            f"{prefix}.sell_volume": self.sell_volume,
            f"{prefix}.trade_velocity": self.trade_velocity,
            f"{prefix}.order_arrival_rate": self.order_arrival_rate,
            f"{prefix}.cancellation_rate": self.cancellation_rate,
            f"{prefix}.liquidity_wall_count": float(len(self.liquidity_walls())),
        }
        imbalance = self.trade_imbalance
        if imbalance is not None:
            values[f"{prefix}.trade_imbalance"] = imbalance
        absorption = self.absorption()
        if absorption is not None:
            values[f"{prefix}.absorption"] = absorption
        return values
