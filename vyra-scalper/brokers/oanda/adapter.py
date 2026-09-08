"""OANDA v20 REST adapter.

**This adapter has never spoken to OANDA.** No practice-account credentials exist in the
environment it was written in, so what is verified is its handling of the *documented v20
wire format*, against a local server that speaks it
(``tests/execution/test_oanda_adapter.py``). That is materially more than a mock — real
sockets, real JSON, real HTTP status codes, real error bodies — and materially less than a
testnet run. Treat every claim below as "correct against the specification", not "observed
against the venue", and run it against fxpractice before it is trusted with anything.

It is disabled by default and stays disabled: :func:`build` refuses to construct one unless
the configuration explicitly enables it *and* credentials are present. Enabling it is not
sufficient to trade — the kill-switch guard and the promotion gate are both upstream — but
this is the layer where a config typo could otherwise reach a venue.

Design notes worth carrying to the other venues:

* **The client order id is the idempotency key**, mapped onto v20's ``clientExtensions.id``
  and addressed as ``@<id>``. Resubmitting after an ambiguous failure must find the
  original rather than create a second order (``EXECUTION_SPEC.md`` §4).
* **Vendor errors are normalised and never escape.** The execution engine's retry policy
  depends on the transient/terminal split, and a raw vendor string cannot be classified.
* **No retry lives here.** One call, one outcome. Retry policy is in the execution engine,
  in one place, so it can be reasoned about once.
"""

from __future__ import annotations

import os
from typing import Any

from core.brokers.base import (
    AccountSnapshot,
    BrokerAdapter,
    BrokerCapabilities,
    BrokerError,
    BrokerErrorCode,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderAmendment,
    OrderRequest,
)
from core.config.loader import ConfigSection
from core.events import OrderType, Side, TimeInForce
from core.instruments.symbols import SymbolMapper, SymbolNotMapped
from core.util.clock import NS_PER_MS, now_ns
from core.util.logging import get_logger

__all__ = ["OandaAdapter", "OandaConfig", "build"]

_log = get_logger("brokers.oanda")

BROKER_ID = "OANDA"

# v20 rejects with a `errorCode`/`errorMessage` pair; these are the ones whose retry
# treatment differs. Anything unlisted is terminal, which is the safe default: retrying a
# terminal error wastes an attempt, while not retrying a transient one loses an order that
# would have been accepted, and the second is recoverable by the operator.
_ERROR_CODES: dict[str, BrokerErrorCode] = {
    "INSUFFICIENT_MARGIN": BrokerErrorCode.INSUFFICIENT_MARGIN,
    "INSUFFICIENT_LIQUIDITY": BrokerErrorCode.VENUE_REJECT,
    "MARKET_HALTED": BrokerErrorCode.MARKET_CLOSED,
    "INSTRUMENT_NOT_TRADEABLE": BrokerErrorCode.MARKET_CLOSED,
    "RATE_LIMIT_EXCEEDED": BrokerErrorCode.RATE_LIMIT,
    "INVALID_INSTRUMENT": BrokerErrorCode.INVALID_CONTRACT,
    "ORDER_DOESNT_EXIST": BrokerErrorCode.UNKNOWN_ORDER,
    "CLIENT_ORDER_ID_ALREADY_EXISTS": BrokerErrorCode.DUPLICATE_ORDER,
}

_STATUS_CODES: dict[int, BrokerErrorCode] = {
    401: BrokerErrorCode.NOT_CONNECTED,
    403: BrokerErrorCode.NOT_CONNECTED,
    404: BrokerErrorCode.UNKNOWN_ORDER,
    429: BrokerErrorCode.RATE_LIMIT,
    500: BrokerErrorCode.BUSY,
    502: BrokerErrorCode.BUSY,
    503: BrokerErrorCode.BUSY,
    504: BrokerErrorCode.TIMEOUT,
}

_TIF: dict[TimeInForce, str] = {
    TimeInForce.GTC: "GTC",
    TimeInForce.IOC: "IOC",
    TimeInForce.FOK: "FOK",
    TimeInForce.DAY: "GTD",
}


class OandaConfig:
    """Endpoint and credentials.

    Credentials are read from the environment, never from the config file and never from a
    literal. ``__repr__`` is overridden so an adapter cannot be logged into a token — the
    same reason the feed transport keeps its headers out of ``repr``.
    """

    __slots__ = ("account_id", "api_url", "timeout_s", "token")

    def __init__(
        self, api_url: str, account_id: str, token: str, timeout_s: float = 10.0
    ) -> None:
        if not api_url:
            raise ValueError("OANDA api_url is required")
        if not account_id:
            raise ValueError("OANDA account_id is required")
        if not token:
            raise ValueError("OANDA API token is required")
        self.api_url = api_url.rstrip("/")
        self.account_id = account_id
        self.token = token
        self.timeout_s = timeout_s

    def __repr__(self) -> str:
        # Neither the token nor the account id: the account id identifies a real account,
        # and the credential filter treats it as one.
        return f"OandaConfig(api_url={self.api_url!r})"


class OandaAdapter(BrokerAdapter):
    """OANDA v20 over REST.

    Args:
        config: endpoint and credentials.
        symbols: canonical id ↔ OANDA instrument name. An internal id must never reach the
            venue and an OANDA name must never enter the engine.
        client: an injected HTTP client, used by the tests to point at a local server
            speaking the documented wire format. Production passes nothing.
    """

    __slots__ = ("_client", "_config", "_connected", "_last_latency_ms", "_symbols")

    def __init__(
        self, config: OandaConfig, symbols: SymbolMapper, client: Any = None
    ) -> None:
        self._config = config
        self._symbols = symbols
        self._client = client
        self._connected = False
        self._last_latency_ms: float | None = None

    @property
    def broker_id(self) -> str:
        return BROKER_ID

    @property
    def capabilities(self) -> BrokerCapabilities:
        """What v20 actually supports.

        ``native_cancel_replace`` is False: v20 replaces by cancelling and creating, which
        is not atomic. Claiming otherwise would let the execution engine assume an
        invariant the venue does not provide.
        """
        return BrokerCapabilities(
            order_types=frozenset({OrderType.MARKET, OrderType.LIMIT, OrderType.STOP}),
            time_in_force=frozenset(
                {TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK, TimeInForce.DAY}
            ),
            native_cancel_replace=False,
            fractional_qty=True,
            supports_orderbook=False,
        )

    # -- transport ----------------------------------------------------------------------

    def _http(self) -> Any:
        if self._client is None:
            try:
                import httpx
            except ImportError as exc:  # pragma: no cover - dependency is declared
                raise BrokerError(
                    BrokerErrorCode.NOT_CONNECTED,
                    "httpx is required for the OANDA adapter; pip install httpx",
                ) from exc
            self._client = httpx.Client(
                base_url=self._config.api_url,
                headers={
                    "Authorization": f"Bearer {self._config.token}",
                    "Content-Type": "application/json",
                    "Accept-Datetime-Format": "UNIX",
                },
                timeout=self._config.timeout_s,
            )
        return self._client

    def _call(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """One request, one outcome. No retry: that policy lives in the execution engine."""
        started = now_ns()
        try:
            response = self._http().request(method, path, json=payload)
        except Exception as exc:
            # A transport failure is ambiguous by nature — the order may or may not exist
            # at the venue. TIMEOUT is transient, and the engine resolves the ambiguity by
            # querying state rather than by assuming either way.
            raise BrokerError(
                BrokerErrorCode.TIMEOUT, f"OANDA request failed: {exc}"
            ) from exc
        self._last_latency_ms = (now_ns() - started) / NS_PER_MS

        try:
            body = response.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        if response.status_code >= 400:
            raise self._error(response.status_code, body)
        return body

    def _error(self, status: int, body: dict[str, Any]) -> BrokerError:
        vendor = str(body.get("errorCode", "") or body.get("rejectReason", ""))
        code = _ERROR_CODES.get(vendor) or _STATUS_CODES.get(status, BrokerErrorCode.UNKNOWN)
        message = str(body.get("errorMessage", "")) or f"HTTP {status}"
        # The vendor string is carried as detail, never as the code: the retry policy reads
        # the code, and a vendor string cannot be classified by anything downstream.
        return BrokerError(code, f"OANDA rejected the request: {message}", venue_detail=vendor)

    def _account_path(self, suffix: str = "") -> str:
        return f"/v3/accounts/{self._config.account_id}{suffix}"

    # -- lifecycle ----------------------------------------------------------------------

    def connect(self) -> None:
        """Validate credentials by reading the account summary.

        Connecting without checking would defer an authentication failure to the first
        order, which is the worst moment to discover one.
        """
        self._call("GET", self._account_path("/summary"))
        self._connected = True
        # The account id is not logged: it identifies a real account, and the credential
        # filter treats it as a credential everywhere else.
        _log.info("broker_connected", broker=BROKER_ID, endpoint=self._config.api_url)

    def disconnect(self) -> None:
        self._connected = False
        client, self._client = self._client, None
        if client is not None and hasattr(client, "close"):
            client.close()

    def health_check(self) -> BrokerHealth:
        if not self._connected:
            return BrokerHealth(connected=False, ts=now_ns(), message="not connected")
        try:
            self._call("GET", self._account_path("/summary"))
        except BrokerError as exc:
            return BrokerHealth(connected=False, ts=now_ns(), message=exc.args[0])
        return BrokerHealth(
            connected=True, ts=now_ns(), latency_ms=self._last_latency_ms
        )

    def _require_connected(self) -> None:
        if not self._connected:
            raise BrokerError(BrokerErrorCode.NOT_CONNECTED, "OANDA adapter is not connected")

    # -- reads --------------------------------------------------------------------------

    def get_account(self) -> AccountSnapshot:
        self._require_connected()
        account = self._call("GET", self._account_path("/summary")).get("account", {})
        return AccountSnapshot(
            account_id=str(account.get("id", "")),
            equity=float(account.get("NAV", 0.0)),
            cash=float(account.get("balance", 0.0)),
            margin_used=float(account.get("marginUsed", 0.0)),
            margin_available=float(account.get("marginAvailable", 0.0)),
            currency=str(account.get("currency", "USD")),
            ts=now_ns(),
        )

    def get_positions(self) -> dict[str, BrokerPosition]:
        """Net positions, keyed by canonical id.

        v20 reports long and short legs separately; they are netted here because the
        engine's book is net. An instrument the symbol table does not know is skipped with
        a warning rather than guessed at — a position under a wrong id is worse than one
        the reconciler reports as unexpected.
        """
        self._require_connected()
        body = self._call("GET", self._account_path("/openPositions"))
        positions: dict[str, BrokerPosition] = {}
        for entry in body.get("positions", []):
            name = str(entry.get("instrument", ""))
            try:
                instrument_id = self._symbols.to_canonical(BROKER_ID, name)
            except SymbolNotMapped:
                _log.warning("unmapped_venue_symbol", broker=BROKER_ID, symbol=name)
                continue
            long_leg = entry.get("long", {}) or {}
            short_leg = entry.get("short", {}) or {}
            quantity = float(long_leg.get("units", 0.0)) + float(short_leg.get("units", 0.0))
            leg = long_leg if quantity >= 0 else short_leg
            positions[instrument_id] = BrokerPosition(
                instrument_id=instrument_id,
                quantity=quantity,
                avg_price=float(leg.get("averagePrice", 0.0) or 0.0),
                unrealized_pnl=float(entry.get("unrealizedPL", 0.0) or 0.0),
                realized_pnl=float(entry.get("pl", 0.0) or 0.0),
            )
        return positions

    def get_orders(self) -> dict[str, OrderRequest]:
        """Working orders keyed by *client* order id.

        Keyed by our id rather than the venue's because that is the key reconciliation and
        the post-failure state query both use. An order the venue holds without a client id
        is one we did not create, and it is skipped rather than invented a key for.
        """
        self._require_connected()
        body = self._call("GET", self._account_path("/pendingOrders"))
        orders: dict[str, OrderRequest] = {}
        for entry in body.get("orders", []):
            client_id = str((entry.get("clientExtensions", {}) or {}).get("id", ""))
            if not client_id:
                continue
            name = str(entry.get("instrument", ""))
            try:
                instrument_id = self._symbols.to_canonical(BROKER_ID, name)
            except SymbolNotMapped:
                _log.warning("unmapped_venue_symbol", broker=BROKER_ID, symbol=name)
                continue
            units = float(entry.get("units", 0.0))
            order_type = str(entry.get("type", "MARKET")).upper()
            orders[client_id] = OrderRequest(
                client_order_id=client_id,
                instrument_id=instrument_id,
                side=Side.BUY if units >= 0 else Side.SELL,
                quantity=abs(units),
                order_type=OrderType(order_type) if order_type in OrderType.__members__ else OrderType.MARKET,
                time_in_force=TimeInForce.GTC,
                limit_price=_optional_float(entry.get("price")) if order_type == "LIMIT" else None,
                stop_price=_optional_float(entry.get("price")) if order_type == "STOP" else None,
            )
        return orders

    # -- writes -------------------------------------------------------------------------

    def submit_order(self, request: OrderRequest) -> OrderAck:
        self._require_connected()
        if not self.capabilities.supports(request.order_type, request.time_in_force):
            raise BrokerError(
                BrokerErrorCode.UNSUPPORTED_ORDER_TYPE,
                f"OANDA does not support {request.order_type.value} "
                f"{request.time_in_force.value}",
            )
        symbol = self._to_symbol(request.instrument_id)
        units = request.quantity if request.side is Side.BUY else -request.quantity
        order: dict[str, Any] = {
            "type": request.order_type.value,
            "instrument": symbol,
            "units": f"{units:g}",
            "timeInForce": _TIF[request.time_in_force],
            "clientExtensions": {"id": request.client_order_id, "tag": request.strategy_id},
        }
        if request.order_type is OrderType.LIMIT and request.limit_price is not None:
            order["price"] = f"{request.limit_price:g}"
        if request.order_type is OrderType.STOP and request.stop_price is not None:
            order["price"] = f"{request.stop_price:g}"
        if request.reduce_only:
            # v20 has no reduce-only flag on an order; the engine's own guard is what
            # enforces the rule, and stating that here keeps the omission deliberate
            # rather than looking like a forgotten field.
            order["clientExtensions"]["comment"] = "reduce_only"

        body = self._call("POST", self._account_path("/orders"), {"order": order})
        transaction = (
            body.get("orderCreateTransaction")
            or body.get("orderFillTransaction")
            or {}
        )
        reject = body.get("orderRejectTransaction") or {}
        if reject:
            reason = str(reject.get("rejectReason", "REJECTED"))
            return OrderAck(
                client_order_id=request.client_order_id,
                broker_order_id=str(reject.get("id", "")),
                accepted=False,
                ts=now_ns(),
                reason=reason,
                error_code=_ERROR_CODES.get(reason, BrokerErrorCode.VENUE_REJECT),
            )
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id=str(transaction.get("id", "")),
            accepted=True,
            ts=now_ns(),
        )

    def cancel_order(self, client_order_id: str) -> None:
        self._require_connected()
        self._call("PUT", self._account_path(f"/orders/@{client_order_id}/cancel"))

    def replace_order(self, client_order_id: str, changes: OrderAmendment) -> OrderAck:
        """Cancel then create, because v20 has no atomic replace.

        The gap between the two is real and is why ``native_cancel_replace`` is False: the
        execution engine has to know the order is briefly absent from the book.
        """
        self._require_connected()
        existing = self.get_orders().get(client_order_id)
        if existing is None:
            raise BrokerError(
                BrokerErrorCode.UNKNOWN_ORDER,
                f"OANDA has no working order with client id {client_order_id!r}",
            )
        self.cancel_order(client_order_id)
        replacement = OrderRequest(
            client_order_id=f"{client_order_id}-r",
            instrument_id=existing.instrument_id,
            side=existing.side,
            quantity=changes.quantity if changes.quantity is not None else existing.quantity,
            order_type=existing.order_type,
            time_in_force=existing.time_in_force,
            limit_price=(
                changes.limit_price if changes.limit_price is not None else existing.limit_price
            ),
            stop_price=(
                changes.stop_price if changes.stop_price is not None else existing.stop_price
            ),
            strategy_id=existing.strategy_id,
            ts_created=now_ns(),
        )
        return self.submit_order(replacement)

    def flatten_position(self, instrument_id: str) -> None:
        self._require_connected()
        symbol = self._to_symbol(instrument_id)
        self._call(
            "PUT",
            self._account_path(f"/positions/{symbol}/close"),
            {"longUnits": "ALL", "shortUnits": "ALL"},
        )

    def flatten_all(self) -> None:
        """Close everything. Safe to call repeatedly and while disconnected.

        Disconnected is not an error here: the contract says flatten must be callable in
        the state where an operator most wants to call it.
        """
        if not self._connected:
            return
        for instrument_id in list(self.get_positions()):
            try:
                self.flatten_position(instrument_id)
            except BrokerError as exc:
                # One instrument failing must not abandon the rest; a partial flatten is
                # better than none, and the failure is reported rather than swallowed.
                _log.error(
                    "flatten_failed",
                    broker=BROKER_ID,
                    instrument=instrument_id,
                    detail=exc.args[0],
                )

    def _to_symbol(self, instrument_id: str) -> str:
        try:
            return self._symbols.to_broker(BROKER_ID, instrument_id)
        except SymbolNotMapped as exc:
            raise BrokerError(
                BrokerErrorCode.INVALID_CONTRACT,
                f"{instrument_id} has no OANDA symbol mapping",
            ) from exc

    def subscribe_orderbook(self, instrument_ids: list[str]) -> None:
        raise BrokerError(
            BrokerErrorCode.INVALID_ORDER,
            "OANDA provides dealer quoting, not centralised order book depth",
        )


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build(section: ConfigSection, symbols: SymbolMapper) -> OandaAdapter:
    """Construct the adapter, or refuse.

    Two independent conditions, both required. ``enabled: true`` in configuration is a
    deliberate act; credentials in the environment are a second one. Neither alone is
    enough, so a config typo cannot reach a venue and a leftover environment variable
    cannot either.

    Raises:
        RuntimeError: when the adapter is disabled or the credentials are absent. Refusing
            loudly beats returning a half-built adapter that fails at the first order.
    """
    if not section.bool_("enabled", False):
        raise RuntimeError(
            "the OANDA adapter is disabled. It has never been run against OANDA — only "
            "against a local server implementing the documented v20 wire format — so "
            "enabling it is a deliberate act that belongs with the promotion process, "
            "not a configuration default."
        )
    token = os.environ.get("OANDA_API_TOKEN", "").strip()
    account_id = os.environ.get("OANDA_ACCOUNT_ID", "").strip()
    if not token or not account_id:
        raise RuntimeError(
            "OANDA_API_TOKEN and OANDA_ACCOUNT_ID must be set in the environment. They are "
            "deliberately not read from configuration: a credential in a config file is a "
            "credential in version control eventually."
        )
    connection = section.section("connection", required=False)
    config = OandaConfig(
        api_url=connection.str_("api_url", "https://api-fxpractice.oanda.com"),
        account_id=account_id,
        token=token,
        timeout_s=connection.float_("timeout_s", 10.0),
    )
    return OandaAdapter(config, symbols)
