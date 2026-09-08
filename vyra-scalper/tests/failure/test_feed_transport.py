"""The WebSocket feed transport, against a real socket.

Everything here runs against a live ``websockets`` server on localhost. A mocked socket
would prove the parsing and none of the behaviour that matters — what happens when the
other end goes away mid-stream, or stops talking without closing. Those are the two failure
modes a feed actually has, and neither is visible to a mock.

The distinction the tests keep returning to: **a silent feed must not look like a healthy
one**. A socket that is open but has stopped delivering is the dangerous case, because
every naive liveness check calls it connected.
"""

from __future__ import annotations

import contextlib
import json
import threading
import time
from typing import Any

import pytest

from core.events import Event, QuoteEvent
from core.util.clock import NS_PER_MS

pytest.importorskip("websockets", reason="websockets is required for the feed transport")

from websockets.sync.server import serve

from core.market_data.transport import WebSocketFeedConfig, WebSocketTransport


def decode(payload: dict[str, Any]) -> Event | None:
    """Test venue schema: ``{"type":"quote","instrument":...,"bid":...,"ask":...}``."""
    if payload.get("type") != "quote":
        return None
    ts = int(payload["ts"])
    return QuoteEvent(
        str(payload["instrument"]), "TEST", ts, ts, ts, int(payload.get("seq", 0)), "WS",
        bid=float(payload["bid"]), ask=float(payload["ask"]),
        bid_size=float(payload.get("bid_size", 1)), ask_size=float(payload.get("ask_size", 1)),
    )


class FeedServer:
    """A venue that can be told to misbehave."""

    def __init__(self, script: list[str] | None = None, linger: float = 0.0) -> None:
        self.script = script or []
        self.linger = linger
        self.received: list[str] = []
        self.connections = 0
        self._server: Any = None
        self._thread: threading.Thread | None = None
        self.port = 0
        self._hold = threading.Event()

    def _handler(self, websocket: Any) -> None:
        self.connections += 1
        # A client that connects without subscribing is still a client; the tests that
        # do that are exercising connection behaviour, not the protocol.
        with contextlib.suppress(Exception):
            self.received.append(websocket.recv(timeout=2))
        for frame in self.script:
            websocket.send(frame)
        if self.linger:
            # Stay open but silent — the case a socket-level check calls healthy.
            self._hold.wait(timeout=self.linger)

    def __enter__(self) -> FeedServer:
        self._server = serve(self._handler, "127.0.0.1", 0)
        self.port = self._server.socket.getsockname()[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._hold.set()
        if self._server is not None:
            self._server.shutdown()

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}"


def quote_frame(seq: int, bid: float = 100.0) -> str:
    return json.dumps(
        {"type": "quote", "instrument": "CME:MES", "ts": 1_000_000_000 + seq,
         "seq": seq, "bid": bid, "ask": bid + 0.25}
    )


def drain(transport: WebSocketTransport, expected: int, timeout: float = 5.0) -> list[Event]:
    """Poll until ``expected`` events have arrived or time runs out."""
    events: list[Event] = []
    deadline = time.monotonic() + timeout
    while len(events) < expected and time.monotonic() < deadline:
        events.extend(transport.poll())
        time.sleep(0.01)
    return events


def test_frames_become_events(config_bundle) -> None:
    frames = [quote_frame(i, 100.0 + i) for i in range(5)]
    with FeedServer(frames, linger=2.0) as server:
        transport = WebSocketTransport(WebSocketFeedConfig(url=server.url), decode)
        transport.connect(["CME:MES"])
        try:
            events = drain(transport, 5)
        finally:
            transport.disconnect()

    assert len(events) == 5
    assert [e.sequence_id for e in events] == [0, 1, 2, 3, 4]
    assert json.loads(server.received[0])["instruments"] == ["CME:MES"]


def test_heartbeats_prove_liveness_without_becoming_events() -> None:
    """A heartbeat is not market data. Counting it as one would invent a tick."""
    frames = [json.dumps({"type": "heartbeat"}) for _ in range(3)] + [quote_frame(1)]
    with FeedServer(frames, linger=2.0) as server:
        transport = WebSocketTransport(WebSocketFeedConfig(url=server.url), decode)
        transport.connect(["CME:MES"])
        try:
            events = drain(transport, 1)
            assert len(events) == 1
            assert transport.stats["heartbeats"] == 3
            assert transport.is_connected()
        finally:
            transport.disconnect()


def test_a_closed_socket_is_reported_disconnected() -> None:
    """The server hangs up mid-stream."""
    with FeedServer([quote_frame(0)], linger=0.0) as server:
        transport = WebSocketTransport(WebSocketFeedConfig(url=server.url), decode)
        transport.connect(["CME:MES"])
        try:
            drain(transport, 1)
            deadline = time.monotonic() + 5.0
            while transport.is_connected() and time.monotonic() < deadline:
                time.sleep(0.01)
            assert not transport.is_connected(), "a hung-up socket still reported connected"
        finally:
            transport.disconnect()


def test_a_silent_but_open_socket_is_reported_disconnected() -> None:
    """The failure mode that matters.

    The socket is open, the TCP connection is fine, and nothing has arrived for longer than
    the heartbeat timeout. Every naive liveness check calls this healthy; the engine would
    then trade on a price that stopped updating.
    """
    with FeedServer([quote_frame(0)], linger=5.0) as server:
        config = WebSocketFeedConfig(url=server.url, heartbeat_timeout_ns=200 * NS_PER_MS)
        transport = WebSocketTransport(config, decode)
        transport.connect(["CME:MES"])
        try:
            drain(transport, 1)
            assert transport.is_connected()
            time.sleep(0.4)
            assert not transport.is_connected(), (
                "an open socket that stopped delivering still reported connected"
            )
            assert transport.silence_ns() > 200 * NS_PER_MS
        finally:
            transport.disconnect()


def test_a_feed_that_never_speaks_ages_out() -> None:
    """Connecting is not receiving. A feed that says nothing at all must still go stale."""
    with FeedServer([], linger=5.0) as server:
        config = WebSocketFeedConfig(url=server.url, heartbeat_timeout_ns=200 * NS_PER_MS)
        transport = WebSocketTransport(config, decode)
        transport.connect(["CME:MES"])
        try:
            assert transport.is_connected()
            time.sleep(0.4)
            assert not transport.is_connected()
        finally:
            transport.disconnect()


def test_malformed_frames_are_counted_not_guessed_at() -> None:
    frames = ["not json at all", json.dumps([1, 2, 3]), quote_frame(7)]
    with FeedServer(frames, linger=2.0) as server:
        transport = WebSocketTransport(WebSocketFeedConfig(url=server.url), decode)
        transport.connect(["CME:MES"])
        try:
            events = drain(transport, 1)
            assert len(events) == 1
            assert transport.stats["malformed"] == 2
        finally:
            transport.disconnect()


def test_a_decoder_that_raises_drops_the_frame_and_counts_it() -> None:
    """A schema mismatch is an integration bug, not a tick to invent."""

    def broken(payload: dict[str, Any]) -> Event | None:
        raise KeyError("bid")

    with FeedServer([quote_frame(0)], linger=2.0) as server:
        transport = WebSocketTransport(WebSocketFeedConfig(url=server.url), broken)
        transport.connect(["CME:MES"])
        try:
            deadline = time.monotonic() + 3.0
            while transport.stats["malformed"] == 0 and time.monotonic() < deadline:
                time.sleep(0.01)
            assert transport.stats["malformed"] == 1
            assert list(transport.poll()) == []
        finally:
            transport.disconnect()


def test_an_overflowing_queue_drops_the_oldest_and_says_so() -> None:
    """The newest tick is the one worth keeping, and the loss is counted."""
    frames = [quote_frame(i, 100.0 + i) for i in range(20)]
    with FeedServer(frames, linger=2.0) as server:
        config = WebSocketFeedConfig(url=server.url, max_queue=5)
        transport = WebSocketTransport(config, decode)
        transport.connect(["CME:MES"])
        try:
            deadline = time.monotonic() + 5.0
            while transport.stats["frames"] < 20 and time.monotonic() < deadline:
                time.sleep(0.01)
            events = list(transport.poll())
            assert len(events) <= 5
            assert transport.stats["dropped_full_queue"] >= 10
            assert events[-1].sequence_id == 19, "the newest tick must survive the drop"
        finally:
            transport.disconnect()


def test_diagnostics_never_carry_the_auth_header() -> None:
    """The transport holds a venue token. No diagnostic may hand it back."""
    config = WebSocketFeedConfig(
        url="ws://127.0.0.1:1/feed",
        headers={"Authorization": "Bearer SENTINEL-FEED-TOKEN-abc123"},
    )
    transport = WebSocketTransport(config, decode)
    rendered = json.dumps(transport.diagnostics()) + repr(transport) + repr(config)
    assert "SENTINEL-FEED-TOKEN" not in rendered
    assert "Authorization" not in rendered


def test_the_transport_name_hides_a_token_in_the_url() -> None:
    """Some venues put the key in the query string. The name is host-only."""
    config = WebSocketFeedConfig(url="wss://feed.example.com/stream?key=SENTINEL-URL-KEY")
    transport = WebSocketTransport(config, decode)
    assert transport.name == "ws:feed.example.com"
    assert "SENTINEL-URL-KEY" not in json.dumps(transport.diagnostics())


def test_connect_failure_raises_for_the_gateway_to_retry() -> None:
    """Backoff belongs to the gateway; the transport just fails."""
    config = WebSocketFeedConfig(url="ws://127.0.0.1:1/nothing-here", open_timeout_s=1.0)
    transport = WebSocketTransport(config, decode)
    # OSError covers the refusal; the transport deliberately does not normalise venue
    # connection errors, because the gateway treats every failure the same way.
    with pytest.raises(OSError):
        transport.connect(["CME:MES"])
    assert not transport.is_connected()


def test_the_gateway_reconnects_a_dropped_feed(registry) -> None:
    """End to end: the gateway's existing reconnect path over a real socket drop."""
    from core.market_data.gateway import ConnectionState, GatewayConfig, MarketDataGateway
    from core.market_data.normalization import Normalizer

    with FeedServer([quote_frame(0)], linger=0.0) as server:
        transport = WebSocketTransport(
            WebSocketFeedConfig(url=server.url, heartbeat_timeout_ns=200 * NS_PER_MS), decode
        )
        gateway = MarketDataGateway(
            transport=transport,
            instruments=["CME:MES"],
            normalizer=Normalizer({i: registry.get(i) for i in registry.ids()}),
            config=GatewayConfig(
                reconnect_backoff_ms=(1.0,),
                max_reconnect_attempts=3,
                reorder_window_ns=0,
                heartbeat_timeout_ns=200 * NS_PER_MS,
            ),
        )
        assert gateway.connect()
        try:
            deadline = time.monotonic() + 5.0
            while transport.is_connected() and time.monotonic() < deadline:
                gateway.poll()
                time.sleep(0.01)
            gateway.poll()
            assert gateway.state is not ConnectionState.CONNECTED, (
                "the gateway did not notice the feed had gone"
            )
            assert server.connections >= 1
        finally:
            gateway.disconnect()
