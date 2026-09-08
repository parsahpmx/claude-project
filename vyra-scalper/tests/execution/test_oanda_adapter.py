"""The OANDA adapter, against a local server that speaks the documented v20 wire format.

**This is not a testnet run.** No OANDA practice credentials exist in this environment, so
what is verified here is the adapter's handling of the v20 protocol as documented — real
HTTP, real JSON, real status codes, real error bodies, against a server written from the
specification. That catches a whole class of integration bugs a mock cannot (wrong verb,
wrong path, wrong body shape, unhandled status) and cannot catch the class only the venue
knows about (undocumented fields, behavioural quirks, rate-limit reality).

The adapter says the same thing in its own docstring, and stays disabled by default.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from core.brokers.base import BrokerError, BrokerErrorCode, OrderAmendment, OrderRequest
from core.events import OrderType, Side, TimeInForce
from core.instruments.symbols import SymbolMapper

pytest.importorskip("httpx", reason="httpx is required for the OANDA adapter")

from brokers.oanda.adapter import BROKER_ID, OandaAdapter, OandaConfig, build

ACCOUNT = "001-002-3456789-001"
TOKEN = "SENTINEL-OANDA-TOKEN-do-not-log"


class StubVenue:
    """A server implementing the v20 endpoints the adapter uses.

    Records every request so a test can assert on what actually went over the wire, which
    is the point: an adapter that produces the wrong body still "works" against a mock that
    ignores the body.
    """

    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict[str, Any] | None]] = []
        self.responses: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
        self.positions: list[dict[str, Any]] = []
        self.orders: list[dict[str, Any]] = []
        self._server: HTTPServer | None = None
        self.port = 0

    def respond(self, method: str, path: str, status: int, body: dict[str, Any]) -> None:
        self.responses[(method, path)] = (status, body)

    def _lookup(self, method: str, path: str) -> tuple[int, dict[str, Any]]:
        if (method, path) in self.responses:
            return self.responses[(method, path)]
        if path.endswith("/summary"):
            return 200, {
                "account": {
                    "id": ACCOUNT, "NAV": "10500.25", "balance": "10000.00",
                    "marginUsed": "250.00", "marginAvailable": "10250.25",
                    "currency": "USD",
                }
            }
        if path.endswith("/openPositions"):
            return 200, {"positions": self.positions}
        if path.endswith("/pendingOrders"):
            return 200, {"orders": self.orders}
        if path.endswith("/orders") and method == "POST":
            return 201, {"orderCreateTransaction": {"id": "6789"}}
        if "/cancel" in path:
            return 200, {"orderCancelTransaction": {"id": "6790"}}
        if "/close" in path:
            return 200, {"longOrderCreateTransaction": {"id": "6791"}}
        return 404, {"errorCode": "NO_SUCH_ROUTE", "errorMessage": path}

    def __enter__(self) -> StubVenue:
        venue = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # keep the test output readable
                pass

            def _handle(self, method: str) -> None:
                length = int(self.headers.get("Content-Length", 0) or 0)
                payload = json.loads(self.rfile.read(length)) if length else None
                venue.requests.append((method, self.path, payload))
                status, body = venue._lookup(method, self.path)
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self) -> None:
                self._handle("GET")

            def do_POST(self) -> None:
                self._handle("POST")

            def do_PUT(self) -> None:
                self._handle("PUT")

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc: object) -> None:
        if self._server is not None:
            self._server.shutdown()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def sent(self, method: str, fragment: str) -> dict[str, Any] | None:
        for verb, path, payload in self.requests:
            if verb == method and fragment in path:
                return payload
        raise AssertionError(f"no {method} request matching {fragment!r} in {self.requests}")


@pytest.fixture
def symbols() -> SymbolMapper:
    mapper = SymbolMapper()
    mapper.register(BROKER_ID, {"FX:EURUSD": "EUR_USD", "CFD:XAUUSD": "XAU_USD"})
    return mapper


def adapter_for(venue: StubVenue, symbols: SymbolMapper) -> OandaAdapter:
    return OandaAdapter(
        OandaConfig(api_url=venue.url, account_id=ACCOUNT, token=TOKEN), symbols
    )


def order(client_order_id: str = "c1", **kwargs: Any) -> OrderRequest:
    params: dict[str, Any] = {
        "client_order_id": client_order_id,
        "instrument_id": "FX:EURUSD",
        "side": Side.BUY,
        "quantity": 1000.0,
        "order_type": OrderType.MARKET,
        "time_in_force": TimeInForce.FOK,
        "strategy_id": "test",
    }
    params.update(kwargs)
    return OrderRequest(**params)


# --------------------------------------------------------------------------------------
# It is off, and it takes two deliberate acts to turn on
# --------------------------------------------------------------------------------------


def test_the_adapter_is_disabled_in_the_shipped_configuration(config_bundle) -> None:
    section = config_bundle["brokers"].section("brokers").section("oanda")
    assert section.bool_("enabled", False) is False
    with pytest.raises(RuntimeError, match="disabled"):
        build(section, SymbolMapper())


def test_enabling_it_without_credentials_still_refuses(
    config_bundle, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two independent conditions. A config typo alone cannot reach a venue."""
    monkeypatch.delenv("OANDA_API_TOKEN", raising=False)
    monkeypatch.delenv("OANDA_ACCOUNT_ID", raising=False)

    class Enabled:
        def bool_(self, name: str, default: bool = False) -> bool:
            return True

    with pytest.raises(RuntimeError, match="OANDA_API_TOKEN"):
        build(Enabled(), SymbolMapper())  # type: ignore[arg-type]


def test_credentials_never_appear_in_a_repr(symbols: SymbolMapper) -> None:
    config = OandaConfig(api_url="https://api-fxpractice.oanda.com", account_id=ACCOUNT, token=TOKEN)
    rendered = repr(config) + repr(OandaAdapter(config, symbols))
    assert TOKEN not in rendered
    assert ACCOUNT not in rendered, "the account id identifies a real account"


# --------------------------------------------------------------------------------------
# The wire format
# --------------------------------------------------------------------------------------


def test_connect_validates_credentials_before_the_first_order(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        assert venue.requests[0][0] == "GET"
        assert venue.requests[0][1].endswith("/summary")


def test_bad_credentials_surface_as_not_connected(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        venue.respond(
            "GET", f"/v3/accounts/{ACCOUNT}/summary", 401,
            {"errorMessage": "Insufficient authorization"},
        )
        adapter = adapter_for(venue, symbols)
        with pytest.raises(BrokerError) as caught:
            adapter.connect()
        assert caught.value.code is BrokerErrorCode.NOT_CONNECTED


def test_a_buy_is_sent_as_positive_units_with_the_client_id(symbols: SymbolMapper) -> None:
    """The body is asserted, not just the call.

    An adapter that sends the right verb to the right path with a wrong body passes against
    a mock and fails against the venue.
    """
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        ack = adapter.submit_order(order("abc-123"))

        assert ack.accepted
        assert ack.broker_order_id == "6789"
        body = venue.sent("POST", "/orders")
        assert body is not None
        sent = body["order"]
        assert sent["instrument"] == "EUR_USD", "the internal id must never reach the venue"
        assert sent["units"] == "1000"
        assert sent["timeInForce"] == "FOK"
        assert sent["clientExtensions"]["id"] == "abc-123"


def test_a_sell_is_sent_as_negative_units(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        adapter.submit_order(order(side=Side.SELL))
        body = venue.sent("POST", "/orders")
        assert body is not None
        assert body["order"]["units"] == "-1000"


def test_a_venue_rejection_is_an_unaccepted_ack_not_an_exception(
    symbols: SymbolMapper,
) -> None:
    """A rejection is an outcome, not a failure: the engine records it and moves on."""
    with StubVenue() as venue:
        venue.respond(
            "POST", f"/v3/accounts/{ACCOUNT}/orders", 201,
            {"orderRejectTransaction": {"id": "77", "rejectReason": "INSUFFICIENT_MARGIN"}},
        )
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        ack = adapter.submit_order(order())

        assert not ack.accepted
        assert ack.error_code is BrokerErrorCode.INSUFFICIENT_MARGIN
        assert not ack.error_code.is_transient, "retrying this can never succeed"


@pytest.mark.parametrize(
    ("vendor_code", "status", "expected", "transient"),
    [
        ("RATE_LIMIT_EXCEEDED", 429, BrokerErrorCode.RATE_LIMIT, True),
        ("MARKET_HALTED", 400, BrokerErrorCode.MARKET_CLOSED, False),
        ("INVALID_INSTRUMENT", 400, BrokerErrorCode.INVALID_CONTRACT, False),
        ("ORDER_DOESNT_EXIST", 404, BrokerErrorCode.UNKNOWN_ORDER, False),
        ("", 503, BrokerErrorCode.BUSY, True),
    ],
)
def test_vendor_errors_are_normalised_for_the_retry_policy(
    symbols: SymbolMapper,
    vendor_code: str,
    status: int,
    expected: BrokerErrorCode,
    transient: bool,
) -> None:
    """The retry policy reads the normalised code; a vendor string cannot be classified."""
    with StubVenue() as venue:
        venue.respond(
            "POST", f"/v3/accounts/{ACCOUNT}/orders", status,
            {"errorCode": vendor_code, "errorMessage": "nope"},
        )
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        with pytest.raises(BrokerError) as caught:
            adapter.submit_order(order())
        assert caught.value.code is expected
        assert caught.value.is_transient is transient


def test_an_unmapped_instrument_never_reaches_the_wire(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        before = len(venue.requests)
        with pytest.raises(BrokerError) as caught:
            adapter.submit_order(order(instrument_id="CME:MES"))
        assert caught.value.code is BrokerErrorCode.INVALID_CONTRACT
        assert len(venue.requests) == before, "a request was sent for an unmapped symbol"


def test_an_undeclared_order_type_is_refused_before_sending(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        before = len(venue.requests)
        with pytest.raises(BrokerError) as caught:
            adapter.submit_order(
                order(order_type=OrderType.STOP_LIMIT, stop_price=1.1, limit_price=1.1)
            )
        assert caught.value.code is BrokerErrorCode.UNSUPPORTED_ORDER_TYPE
        assert len(venue.requests) == before


# --------------------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------------------


def test_long_and_short_legs_are_netted(symbols: SymbolMapper) -> None:
    """v20 reports the legs separately; the engine's book is net."""
    with StubVenue() as venue:
        venue.positions = [
            {
                "instrument": "EUR_USD",
                "long": {"units": "3000", "averagePrice": "1.0850"},
                "short": {"units": "-1000", "averagePrice": "1.0900"},
                "unrealizedPL": "12.5",
                "pl": "3.0",
            }
        ]
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        positions = adapter.get_positions()

        assert set(positions) == {"FX:EURUSD"}
        assert positions["FX:EURUSD"].quantity == 2000.0
        assert positions["FX:EURUSD"].unrealized_pnl == 12.5


def test_an_unmapped_venue_symbol_is_skipped_not_guessed(symbols: SymbolMapper) -> None:
    """A position filed under a wrong id is worse than one the reconciler flags."""
    with StubVenue() as venue:
        venue.positions = [
            {"instrument": "USD_JPY", "long": {"units": "1000"}, "short": {"units": "0"}},
            {"instrument": "EUR_USD", "long": {"units": "500"}, "short": {"units": "0"}},
        ]
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        assert set(adapter.get_positions()) == {"FX:EURUSD"}


def test_working_orders_are_keyed_by_our_id_not_the_venues(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        venue.orders = [
            {
                "id": "555", "instrument": "EUR_USD", "units": "-2000",
                "type": "LIMIT", "price": "1.1000",
                "clientExtensions": {"id": "our-key"},
            },
            {"id": "556", "instrument": "EUR_USD", "units": "100", "type": "MARKET"},
        ]
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        orders = adapter.get_orders()

        assert set(orders) == {"our-key"}, "an order we did not create has no client key"
        assert orders["our-key"].side is Side.SELL
        assert orders["our-key"].quantity == 2000.0
        assert orders["our-key"].limit_price == 1.1


# --------------------------------------------------------------------------------------
# Replace and flatten
# --------------------------------------------------------------------------------------


def test_replace_is_a_cancel_then_a_create_and_says_so(symbols: SymbolMapper) -> None:
    """v20 has no atomic replace, and the capability flag must not claim one."""
    with StubVenue() as venue:
        venue.orders = [
            {
                "id": "555", "instrument": "EUR_USD", "units": "1000",
                "type": "LIMIT", "price": "1.1000",
                "clientExtensions": {"id": "c1"},
            }
        ]
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        assert adapter.capabilities.native_cancel_replace is False

        adapter.replace_order("c1", OrderAmendment(quantity=2000.0))

        verbs = [(m, p) for m, p, _ in venue.requests]
        assert any("cancel" in p for _, p in verbs)
        body = venue.sent("POST", "/orders")
        assert body is not None
        assert body["order"]["units"] == "2000"


def test_replacing_an_unknown_order_raises(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        with pytest.raises(BrokerError) as caught:
            adapter.replace_order("nope", OrderAmendment(quantity=1.0))
        assert caught.value.code is BrokerErrorCode.UNKNOWN_ORDER


def test_flatten_all_continues_past_one_failure(symbols: SymbolMapper) -> None:
    """A partial flatten beats none, and the failure is reported rather than swallowed."""
    with StubVenue() as venue:
        venue.positions = [
            {"instrument": "EUR_USD", "long": {"units": "1000"}, "short": {"units": "0"}},
            {"instrument": "XAU_USD", "long": {"units": "5"}, "short": {"units": "0"}},
        ]
        venue.respond(
            "PUT", f"/v3/accounts/{ACCOUNT}/positions/EUR_USD/close", 400,
            {"errorCode": "CLOSEOUT_POSITION_REJECT", "errorMessage": "no"},
        )
        adapter = adapter_for(venue, symbols)
        adapter.connect()
        adapter.flatten_all()

        closed = [p for _, p, _ in venue.requests if "/close" in p]
        assert any("XAU_USD" in p for p in closed), "the second position was never attempted"


def test_flatten_all_while_disconnected_is_a_no_op(symbols: SymbolMapper) -> None:
    """The state an operator most wants to call it in must not raise."""
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        adapter.flatten_all()
        assert venue.requests == []


def test_operations_before_connect_are_refused(symbols: SymbolMapper) -> None:
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        with pytest.raises(BrokerError) as caught:
            adapter.get_account()
        assert caught.value.code is BrokerErrorCode.NOT_CONNECTED


def test_depth_is_refused_rather_than_silently_empty(symbols: SymbolMapper) -> None:
    """Dealer quoting is not centralised liquidity, and the adapter says so."""
    with StubVenue() as venue:
        adapter = adapter_for(venue, symbols)
        with pytest.raises(BrokerError):
            adapter.subscribe_orderbook(["FX:EURUSD"])
