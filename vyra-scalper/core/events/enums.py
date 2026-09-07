"""Enumerations shared across the engine.

These are the vocabulary of the system.  They are string-valued so that serialised
events, database rows and log lines are readable without a lookup table, and stable so
that historical records remain interpretable after a code change.
"""

from __future__ import annotations

from enum import Enum

from core.util.clock import (
    NS_PER_DAY,
    NS_PER_HOUR,
    NS_PER_MIN,
    NS_PER_SEC,
)

__all__ = [
    "Aggressor",
    "AssetClass",
    "DataFlag",
    "EventType",
    "ExecutionMode",
    "FillModel",
    "OrderState",
    "OrderType",
    "Regime",
    "SessionState",
    "Side",
    "StalenessState",
    "TimeInForce",
    "Timeframe",
]


class EventType(str, Enum):
    """Discriminator carried by every event."""

    QUOTE = "QUOTE"
    TRADE = "TRADE"
    ORDERBOOK = "ORDERBOOK"
    BAR = "BAR"
    NEWS = "NEWS"
    SESSION = "SESSION"
    ORDER = "ORDER"
    FILL = "FILL"
    POSITION = "POSITION"
    RISK = "RISK"


class AssetClass(str, Enum):
    """Instrument family.  Drives sizing, session and depth-availability rules."""

    FUTURE = "FUTURE"
    EQUITY = "EQUITY"
    CFD = "CFD"
    FX = "FX"
    INDEX_CFD = "INDEX_CFD"
    METAL_CFD = "METAL_CFD"


class Side(str, Enum):
    """Order/trade direction."""

    BUY = "BUY"
    SELL = "SELL"

    @property
    def sign(self) -> int:
        """``+1`` for BUY, ``-1`` for SELL — the multiplier for signed position maths."""
        return 1 if self is Side.BUY else -1

    def opposite(self) -> Side:
        return Side.SELL if self is Side.BUY else Side.BUY


class Aggressor(str, Enum):
    """Which side initiated a trade print.

    ``UNKNOWN`` is a real and common value: many feeds do not tag aggressor, and
    inferring it from the last quote is an estimate.  Order-flow features must treat
    ``UNKNOWN`` as missing data rather than defaulting it to one side.
    """

    BUY = "BUY"
    SELL = "SELL"
    UNKNOWN = "UNKNOWN"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"


class TimeInForce(str, Enum):
    DAY = "DAY"
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"


class OrderState(str, Enum):
    """Order lifecycle states (``EXECUTION_SPEC.md`` §1)."""

    PENDING_NEW = "PENDING_NEW"
    SUBMITTED = "SUBMITTED"
    WORKING = "WORKING"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    REJECTED_LOCAL = "REJECTED_LOCAL"
    REJECTED_BROKER = "REJECTED_BROKER"
    UNKNOWN = "UNKNOWN"

    @property
    def is_terminal(self) -> bool:
        """True when no further transition is possible.

        ``UNKNOWN`` is deliberately *not* terminal: it is resolved by reconciliation.
        """
        return self in _TERMINAL_ORDER_STATES

    @property
    def is_working(self) -> bool:
        """True when the order may still receive a fill at the venue."""
        return self in (OrderState.SUBMITTED, OrderState.WORKING, OrderState.PARTIALLY_FILLED)


_TERMINAL_ORDER_STATES = frozenset(
    {
        OrderState.FILLED,
        OrderState.CANCELLED,
        OrderState.EXPIRED,
        OrderState.REJECTED_LOCAL,
        OrderState.REJECTED_BROKER,
    }
)


class SessionState(str, Enum):
    """Where a venue is in its trading day."""

    PRE = "PRE"
    OPEN = "OPEN"
    CLOSE = "CLOSE"
    POST = "POST"
    CLOSED = "CLOSED"
    HALTED = "HALTED"


class StalenessState(str, Enum):
    """Market-data freshness (``DATA_SPEC.md`` §4)."""

    FRESH = "FRESH"
    WARN = "WARN"
    STALE = "STALE"
    DEAD = "DEAD"


class DataFlag(str, Enum):
    """Non-fatal data-quality annotations attached to an event.

    A flagged event is still delivered — hiding it would be a silent modification — but
    downstream gates may refuse to trade on it.
    """

    CROSSED_BOOK = "CROSSED_BOOK"
    OFF_TICK = "OFF_TICK"
    CLOCK_SKEW = "CLOCK_SKEW"
    OUT_OF_ORDER = "OUT_OF_ORDER"
    PRICE_SPIKE = "PRICE_SPIKE"
    WIDE_SPREAD = "WIDE_SPREAD"
    ZERO_SIZE = "ZERO_SIZE"
    SYNTHETIC = "SYNTHETIC"


class Regime(str, Enum):
    """Market regime classification (§7 of the platform specification)."""

    TRENDING_UP = "TRENDING_UP"
    TRENDING_DOWN = "TRENDING_DOWN"
    RANGE = "RANGE"
    LOW_VOLATILITY = "LOW_VOLATILITY"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    BREAKOUT = "BREAKOUT"
    REVERSAL = "REVERSAL"
    NEWS = "NEWS"
    ILLIQUID = "ILLIQUID"
    UNKNOWN = "UNKNOWN"


class ExecutionMode(str, Enum):
    """How the platform is running (``ARCHITECTURE.md`` §2)."""

    BACKTEST = "BACKTEST"
    PAPER = "PAPER"
    SHADOW = "SHADOW"
    LIVE = "LIVE"

    @property
    def sends_real_orders(self) -> bool:
        return self is ExecutionMode.LIVE


class FillModel(str, Enum):
    """Backtest fill optimism (``BACKTEST_SPEC.md`` §5)."""

    OPTIMISTIC = "OPTIMISTIC"
    REALISTIC = "REALISTIC"
    CONSERVATIVE = "CONSERVATIVE"

    @property
    def allowed_for_promotion(self) -> bool:
        """Only realistic and conservative results may support a promotion decision."""
        return self in (FillModel.REALISTIC, FillModel.CONSERVATIVE)


class Timeframe(str, Enum):
    """Bar timeframes.  ``ns`` gives the nominal duration in nanoseconds."""

    S1 = "1s"
    S5 = "5s"
    S15 = "15s"
    S30 = "30s"
    M1 = "1m"
    M3 = "3m"
    M5 = "5m"
    M15 = "15m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"

    @property
    def ns(self) -> int:
        """Nominal duration in nanoseconds.

        ``D1`` is the nominal 24 hours; the actual daily bar boundary comes from the
        session calendar, not from this constant (``DATA_SPEC.md`` §5).
        """
        return _TIMEFRAME_NS[self]

    @property
    def is_intraday(self) -> bool:
        return self is not Timeframe.D1

    @classmethod
    def parse(cls, text: str) -> Timeframe:
        """Parse a config string such as ``"5m"`` into a member.

        Raises:
            ValueError: naming the accepted values, so a typo in ``strategies.yaml``
                produces an actionable error rather than a KeyError deep in the engine.
        """
        try:
            return cls(text)
        except ValueError:
            valid = ", ".join(tf.value for tf in cls)
            raise ValueError(f"unknown timeframe {text!r}; expected one of: {valid}") from None


_TIMEFRAME_NS: dict[Timeframe, int] = {
    Timeframe.S1: NS_PER_SEC,
    Timeframe.S5: 5 * NS_PER_SEC,
    Timeframe.S15: 15 * NS_PER_SEC,
    Timeframe.S30: 30 * NS_PER_SEC,
    Timeframe.M1: NS_PER_MIN,
    Timeframe.M3: 3 * NS_PER_MIN,
    Timeframe.M5: 5 * NS_PER_MIN,
    Timeframe.M15: 15 * NS_PER_MIN,
    Timeframe.H1: NS_PER_HOUR,
    Timeframe.H4: 4 * NS_PER_HOUR,
    Timeframe.D1: NS_PER_DAY,
}
