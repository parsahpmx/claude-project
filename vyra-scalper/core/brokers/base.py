"""The broker adapter contract.

Every venue — real or simulated — implements this interface, and every adapter must pass
the shared contract test suite (``tests/execution/test_adapter_contract.py``).  A strategy
never sees any of it (``EXECUTION_SPEC.md`` §9).

Rules every adapter honours:

1. Translate symbols through the :class:`~core.instruments.symbols.SymbolMapper`.  An
   internal id must never reach a venue, and a venue symbol must never enter the engine.
2. Normalise venue errors to :class:`BrokerErrorCode`.  Vendor exceptions do not escape
   the adapter.
3. Report capabilities honestly.  Claiming an unsupported order type is a contract
   violation the shared tests catch.
4. Never retry internally.  Retry policy lives in the execution engine, in one place.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum

from core.events import OrderType, Side, TimeInForce
from core.util.clock import Nanos

__all__ = [
    "AccountSnapshot",
    "BrokerAdapter",
    "BrokerCapabilities",
    "BrokerError",
    "BrokerErrorCode",
    "BrokerHealth",
    "BrokerPosition",
    "OrderAck",
    "OrderAmendment",
    "OrderRequest",
]


class BrokerErrorCode(StrEnum):
    """Normalised venue errors.

    Split into transient and terminal because the retry policy depends on the difference:
    retrying ``INSUFFICIENT_MARGIN`` cannot succeed, and not retrying ``THROTTLED``
    abandons an order the venue would have accepted a moment later.
    """

    NOT_CONNECTED = "NOT_CONNECTED"
    THROTTLED = "THROTTLED"
    BUSY = "BUSY"
    TIMEOUT = "TIMEOUT"
    INSUFFICIENT_MARGIN = "INSUFFICIENT_MARGIN"
    INVALID_CONTRACT = "INVALID_CONTRACT"
    INVALID_ORDER = "INVALID_ORDER"
    MARKET_CLOSED = "MARKET_CLOSED"
    UNSUPPORTED_ORDER_TYPE = "UNSUPPORTED_ORDER_TYPE"
    DUPLICATE_ORDER = "DUPLICATE_ORDER"
    UNKNOWN_ORDER = "UNKNOWN_ORDER"
    RATE_LIMIT = "RATE_LIMIT"
    VENUE_REJECT = "VENUE_REJECT"
    UNKNOWN = "UNKNOWN"

    @property
    def is_transient(self) -> bool:
        """Whether a retry could plausibly succeed."""
        return self in _TRANSIENT_ERRORS


_TRANSIENT_ERRORS = frozenset(
    {
        BrokerErrorCode.THROTTLED,
        BrokerErrorCode.BUSY,
        BrokerErrorCode.TIMEOUT,
        BrokerErrorCode.RATE_LIMIT,
    }
)


class BrokerError(RuntimeError):
    """A normalised venue error.  Adapters raise this, never a vendor exception."""

    def __init__(self, code: BrokerErrorCode, message: str, *, venue_detail: str = "") -> None:
        super().__init__(f"{code.value}: {message}")
        self.code = code
        self.message = message
        self.venue_detail = venue_detail

    @property
    def is_transient(self) -> bool:
        return self.code.is_transient


@dataclass(frozen=True, slots=True)
class BrokerCapabilities:
    """What a venue actually supports.

    The execution engine checks this **before** submitting and either downgrades along a
    declared path or rejects, rather than sending something the venue will refuse.
    """

    order_types: frozenset[OrderType] = field(
        default_factory=lambda: frozenset({OrderType.MARKET, OrderType.LIMIT})
    )
    time_in_force: frozenset[TimeInForce] = field(
        default_factory=lambda: frozenset({TimeInForce.DAY})
    )
    native_cancel_replace: bool = False
    fractional_qty: bool = False
    supports_orderbook: bool = False
    max_orders_per_second: float | None = None

    def supports(self, order_type: OrderType, tif: TimeInForce) -> bool:
        return order_type in self.order_types and tif in self.time_in_force


@dataclass(frozen=True, slots=True)
class BrokerHealth:
    """Connectivity and latency snapshot, polled by the execution monitor."""

    connected: bool
    ts: Nanos
    latency_ms: float | None = None
    message: str = ""
    last_heartbeat_ns: Nanos = 0

    @property
    def is_healthy(self) -> bool:
        return self.connected


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    """Account state as the venue reports it.

    The venue is the source of truth; our own book is a belief that reconciliation
    verifies (``EXECUTION_SPEC.md`` §7).
    """

    account_id: str
    equity: float
    cash: float
    margin_used: float = 0.0
    margin_available: float = 0.0
    currency: str = "USD"
    ts: Nanos = 0


@dataclass(frozen=True, slots=True)
class BrokerPosition:
    """A position as the venue reports it."""

    instrument_id: str
    quantity: float
    avg_price: float
    unrealized_pnl: float = 0.0
    realized_pnl: float = 0.0

    @property
    def is_flat(self) -> bool:
        return self.quantity == 0.0


@dataclass(frozen=True, slots=True)
class OrderRequest:
    """An order as submitted to a venue.

    ``client_order_id`` is the idempotency key.  Resubmitting the same one after an
    ambiguous failure must not create a second order (``EXECUTION_SPEC.md`` §4).
    """

    client_order_id: str
    instrument_id: str
    side: Side
    quantity: float
    order_type: OrderType
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: float | None = None
    stop_price: float | None = None
    strategy_id: str = ""
    ts_created: Nanos = 0

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError(f"OrderRequest quantity must be positive, got {self.quantity}")
        if self.order_type is OrderType.LIMIT and self.limit_price is None:
            raise ValueError("a LIMIT order requires limit_price")
        if self.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and self.stop_price is None:
            raise ValueError(f"a {self.order_type.value} order requires stop_price")
        if self.order_type is OrderType.STOP_LIMIT and self.limit_price is None:
            raise ValueError("a STOP_LIMIT order requires limit_price")


@dataclass(frozen=True, slots=True)
class OrderAmendment:
    """A cancel/replace request.  ``None`` means "leave unchanged"."""

    quantity: float | None = None
    limit_price: float | None = None
    stop_price: float | None = None


@dataclass(frozen=True, slots=True)
class OrderAck:
    """A venue's acknowledgement of a submission."""

    client_order_id: str
    broker_order_id: str
    accepted: bool
    ts: Nanos
    reason: str = ""
    error_code: BrokerErrorCode | None = None


class BrokerAdapter(ABC):
    """Base class for venue adapters."""

    @property
    @abstractmethod
    def broker_id(self) -> str:
        """Identifier used for symbol-table lookup and logging."""

    @property
    @abstractmethod
    def capabilities(self) -> BrokerCapabilities:
        """What this venue supports.  Must be accurate; the contract tests verify it."""

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def health_check(self) -> BrokerHealth: ...

    @abstractmethod
    def get_account(self) -> AccountSnapshot: ...

    @abstractmethod
    def get_positions(self) -> dict[str, BrokerPosition]: ...

    @abstractmethod
    def get_orders(self) -> dict[str, OrderRequest]:
        """Working orders, keyed by ``client_order_id``.

        Used by reconciliation and by the post-failure state query that makes retries
        safe.  Must reflect the venue's view, not ours.
        """

    @abstractmethod
    def submit_order(self, request: OrderRequest) -> OrderAck: ...

    @abstractmethod
    def cancel_order(self, client_order_id: str) -> None: ...

    @abstractmethod
    def replace_order(self, client_order_id: str, changes: OrderAmendment) -> OrderAck: ...

    @abstractmethod
    def flatten_position(self, instrument_id: str) -> None: ...

    @abstractmethod
    def flatten_all(self) -> None:
        """Close every position.  Must be safe to call repeatedly and while disconnected."""

    # The subscription hooks below are extension points with a valid default of "do
    # nothing": the simulated and paper adapters are fed by the event stream and have no
    # feed to subscribe to.  They are deliberately not abstract, so an adapter is not
    # forced to write an empty override.
    def subscribe_quotes(self, instrument_ids: list[str]) -> None:  # noqa: B027
        """Subscribe to top-of-book.  Adapters without a feed may no-op."""

    def subscribe_trades(self, instrument_ids: list[str]) -> None:  # noqa: B027
        """Subscribe to trade prints.  Adapters without a feed may no-op."""

    def subscribe_orderbook(self, instrument_ids: list[str]) -> None:
        """Subscribe to depth.

        Raises:
            BrokerError: with ``UNSUPPORTED_ORDER_TYPE`` semantics when the venue has no
                genuine depth.  Silently subscribing to nothing would leave a
                depth-dependent strategy running on features that never update.
        """
        raise BrokerError(
            BrokerErrorCode.INVALID_ORDER,
            f"{self.broker_id} does not provide order book depth",
        )

    def subscribe_account_updates(self) -> None:  # noqa: B027
        """Subscribe to account and position updates.  May no-op."""
