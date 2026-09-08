"""Event algebra for the VYRA engine.

Every message crossing a component boundary is one of these frozen dataclasses.  Import
from this package rather than from the submodules so that a future re-organisation of the
files does not ripple through the codebase.
"""

from core.events.base import NO_EXCHANGE_TIMESTAMP, Event
from core.events.enums import (
    Aggressor,
    AssetClass,
    DataFlag,
    EventType,
    ExecutionMode,
    FillModel,
    OrderState,
    OrderType,
    Regime,
    SessionState,
    Side,
    StalenessState,
    Timeframe,
    TimeInForce,
)
from core.events.market import (
    BarEvent,
    NewsEvent,
    OrderBookEvent,
    QuoteEvent,
    SessionEvent,
    TradeEvent,
)
from core.events.trading import FillEvent, OrderEvent, PositionEvent, RiskEvent

__all__ = [
    "NO_EXCHANGE_TIMESTAMP",
    "Aggressor",
    "AssetClass",
    "BarEvent",
    "DataFlag",
    "Event",
    "EventType",
    "ExecutionMode",
    "FillEvent",
    "FillModel",
    "NewsEvent",
    "OrderBookEvent",
    "OrderEvent",
    "OrderState",
    "OrderType",
    "PositionEvent",
    "QuoteEvent",
    "Regime",
    "RiskEvent",
    "SessionEvent",
    "SessionState",
    "Side",
    "StalenessState",
    "TimeInForce",
    "Timeframe",
    "TradeEvent",
]
