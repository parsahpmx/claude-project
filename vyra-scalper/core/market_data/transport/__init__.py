"""Concrete feed transports.

The gateway owns everything that can be got wrong in a general way — ordering, gaps,
staleness, reconnection — so a transport is only the genuinely venue-specific part: open a
connection, turn bytes into events, say whether it is still up.
"""

from core.market_data.transport.websocket import (
    WebSocketFeedConfig,
    WebSocketTransport,
)

__all__ = ["WebSocketFeedConfig", "WebSocketTransport"]
