"""Live market-data gateway under fault injection.

This component exists for the things a historical file never does: arriving out of order,
stopping without warning, resuming with a gap, and reconnecting into a different book. The
transport is faked so every one of those can be provoked deterministically.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from core.events import Event, QuoteEvent, TradeEvent
from core.instruments.registry import InstrumentRegistry
from core.market_data.gateway import (
    ConnectionState,
    FeedTransport,
    GatewayConfig,
    MarketDataGateway,
)
from core.market_data.normalization import Normalizer
from core.util.clock import NS_PER_MS, NS_PER_SEC

T0 = 1_700_000_000_000_000_000


class FakeClock:
    """A clock the test advances explicitly, so no test ever sleeps."""

    def __init__(self, start: int = T0) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def advance(self, ns: int) -> None:
        self.now += ns


class FakeTransport(FeedTransport):
    """A feed that can be told to fail, drop, or deliver out of order."""

    def __init__(self) -> None:
        self.queued: list[Event] = []
        self.connected = False
        self.connect_calls = 0
        self.fail_connect = False
        self.fail_poll = False
        self.drop_connection = False

    @property
    def name(self) -> str:
        return "fake"

    def connect(self, instruments: list[str]) -> None:
        self.connect_calls += 1
        if self.fail_connect:
            raise ConnectionError("venue unreachable")
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected and not self.drop_connection

    def poll(self) -> Iterator[Event]:
        if self.fail_poll:
            raise OSError("socket read failed")
        queued, self.queued = self.queued, []
        yield from queued


def quote(seq: int, ts: int, bid: float = 5100.00, ask: float = 5100.25) -> QuoteEvent:
    return QuoteEvent("CME:MES", "CME", ts, ts, ts, seq, "FAKE",
                      bid=bid, ask=ask, bid_size=10, ask_size=10)


def trade(seq: int, ts: int, price: float = 5100.25) -> TradeEvent:
    return TradeEvent("CME:MES", "CME", ts, ts, ts, seq, "FAKE", price=price, size=1.0)


@pytest.fixture
def harness(registry: InstrumentRegistry):
    transport = FakeTransport()
    clock = FakeClock()
    gateway = MarketDataGateway(
        transport=transport,
        instruments=["CME:MES"],
        normalizer=Normalizer({i: registry.get(i) for i in registry.ids()}),
        config=GatewayConfig(reorder_window_ns=5 * NS_PER_MS, max_reorder_buffer=100),
        clock=clock,
    )
    return gateway, transport, clock


def drain(gateway: MarketDataGateway, clock: FakeClock) -> list[Event]:
    """Poll, then advance past the reorder window and poll again."""
    gateway.poll()
    clock.advance(10 * NS_PER_MS)
    return gateway.poll()


class TestNormalOperation:
    def test_connects_and_delivers(self, harness) -> None:
        gateway, transport, clock = harness
        assert gateway.connect()
        assert gateway.state is ConnectionState.CONNECTED
        transport.queued = [quote(1, T0), trade(2, T0 + 1)]
        delivered = drain(gateway, clock)
        assert len(delivered) == 2
        assert gateway.stats.delivered == 2

    def test_events_are_delivered_in_timestamp_order(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(3, T0 + 300), quote(1, T0 + 100), quote(2, T0 + 200)]
        delivered = drain(gateway, clock)
        assert [e.ts_exchange for e in delivered] == [T0 + 100, T0 + 200, T0 + 300]

    def test_the_reorder_window_holds_events_briefly(self, harness) -> None:
        """Ordering is bought with exactly this much latency, not assumed for free."""
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0)]
        assert gateway.poll() == []          # held
        clock.advance(10 * NS_PER_MS)
        assert len(gateway.poll()) == 1      # released

    def test_the_processed_stamp_reflects_the_hold(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0)]
        delivered = drain(gateway, clock)
        assert delivered[0].ts_processed >= delivered[0].ts_exchange


class TestSequenceGaps:
    def test_a_venue_sequence_gap_is_recorded(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0), quote(5, T0 + 100)]
        drain(gateway, clock)
        assert gateway.stats.sequence_gaps == 1
        gap = gateway.gaps[0]
        assert gap.expected == 2
        assert gap.received == 5
        assert gap.missing == 3

    def test_the_gap_is_never_filled(self, harness) -> None:
        """The missing messages are gone; inventing them is the silent repair forbidden."""
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0), quote(5, T0 + 100)]
        delivered = drain(gateway, clock)
        assert len(delivered) == 2  # two real events, not five

    def test_contiguous_sequences_record_no_gap(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(i, T0 + i) for i in range(1, 6)]
        drain(gateway, clock)
        assert gateway.stats.sequence_gaps == 0


class TestDisconnectAndResync:
    def test_a_dropped_connection_enters_resync(self, harness) -> None:
        gateway, transport, _clock = harness
        gateway.connect()
        transport.drop_connection = True
        gateway.poll()
        assert gateway.state in (ConnectionState.RESYNCING, ConnectionState.CONNECTED)
        assert gateway.stats.reconnects == 1

    def test_deltas_are_suppressed_until_a_snapshot_arrives(self, harness) -> None:
        """The book on the other side of a disconnect is not the book we left."""
        gateway, transport, clock = harness
        gateway.connect()
        transport.drop_connection = True
        gateway.poll()
        transport.drop_connection = False
        transport.connected = True

        transport.queued = [trade(10, T0 + 500)]   # a delta, not a snapshot
        drain(gateway, clock)
        assert gateway.stats.suppressed_while_resyncing >= 1

    def test_a_two_sided_quote_completes_the_resync(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.drop_connection = True
        gateway.poll()
        transport.drop_connection = False
        transport.connected = True

        transport.queued = [quote(20, T0 + 600)]
        drain(gateway, clock)
        assert gateway.state is ConnectionState.CONNECTED

    def test_buffered_events_are_cleared_on_disconnect(self, harness) -> None:
        gateway, transport, _clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0)]
        gateway.poll()                       # buffered, not yet delivered
        transport.drop_connection = True
        gateway.poll()
        assert gateway.diagnostics()["buffered"] == 0


class TestReconnection:
    def test_a_failed_connect_does_not_raise(self, harness) -> None:
        """An unreachable venue is operational, not a programming error."""
        gateway, transport, _ = harness
        transport.fail_connect = True
        assert gateway.connect() is False
        assert gateway.state is ConnectionState.DISCONNECTED

    def test_reconnection_backs_off(self, harness) -> None:
        gateway, transport, clock = harness
        transport.fail_connect = True
        gateway.connect()
        assert gateway.maybe_reconnect() is False       # backoff not elapsed
        clock.advance(NS_PER_SEC)
        assert gateway.maybe_reconnect() is True        # attempted

    def test_it_gives_up_after_the_configured_attempts(self, registry) -> None:
        """Reconnecting forever while the engine believes data is coming is worse."""
        transport = FakeTransport()
        transport.fail_connect = True
        clock = FakeClock()
        gateway = MarketDataGateway(
            transport, ["CME:MES"],
            Normalizer({i: registry.get(i) for i in registry.ids()}),
            GatewayConfig(max_reconnect_attempts=3, reconnect_backoff_ms=(0.0,)),
            clock,
        )
        for _ in range(3):
            gateway.connect()
        assert gateway.state is ConnectionState.FAILED
        assert gateway.poll() == []
        assert gateway.maybe_reconnect() is False

    def test_a_successful_connect_resets_the_attempt_counter(self, harness) -> None:
        gateway, transport, clock = harness
        transport.fail_connect = True
        gateway.connect()
        transport.fail_connect = False
        clock.advance(NS_PER_SEC)
        assert gateway.connect()
        assert gateway.diagnostics()["reconnect_attempts"] == 0


class TestPollFailure:
    def test_a_poll_error_does_not_propagate(self, harness) -> None:
        gateway, transport, _ = harness
        gateway.connect()
        transport.fail_poll = True
        assert gateway.poll() == []   # must not raise into the event loop

    def test_a_poll_error_enters_resync(self, harness) -> None:
        gateway, transport, _ = harness
        gateway.connect()
        transport.fail_poll = True
        gateway.poll()
        assert gateway.state is ConnectionState.RESYNCING


class TestMonotonicity:
    def test_an_event_later_than_its_window_is_dropped_not_delivered_late(
        self, harness
    ) -> None:
        """Out-of-order delivery would break every downstream ordering assumption."""
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0 + 1_000_000)]
        drain(gateway, clock)
        transport.queued = [quote(2, T0)]   # older than what was already delivered
        delivered = drain(gateway, clock)
        assert delivered == []
        assert gateway.stats.reordered == 1

    def test_delivered_timestamps_never_go_backwards(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        all_delivered: list[Event] = []
        for batch in range(5):
            transport.queued = [
                quote(batch * 10 + i, T0 + batch * 1_000_000 + i * 1_000)
                for i in (3, 1, 2)
            ]
            all_delivered.extend(drain(gateway, clock))
        stamps = [e.ts for e in all_delivered]
        assert stamps == sorted(stamps)


class TestBoundedResources:
    def test_the_reorder_buffer_cannot_grow_without_limit(self, registry) -> None:
        """A feed that stops advancing must not consume memory without bound."""
        transport = FakeTransport()
        clock = FakeClock()
        gateway = MarketDataGateway(
            transport, ["CME:MES"],
            Normalizer({i: registry.get(i) for i in registry.ids()}),
            GatewayConfig(reorder_window_ns=NS_PER_SEC, max_reorder_buffer=50),
            clock,
        )
        gateway.connect()
        transport.queued = [quote(i, T0 + i) for i in range(1, 200)]
        gateway.poll()
        assert gateway.diagnostics()["buffered"] <= 50
        assert gateway.stats.dropped > 0


class TestHealth:
    def test_a_silent_feed_is_unhealthy(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0)]
        drain(gateway, clock)
        assert gateway.is_healthy
        clock.advance(60 * NS_PER_SEC)
        assert not gateway.is_healthy

    def test_a_disconnected_gateway_is_unhealthy(self, harness) -> None:
        gateway, _, _ = harness
        assert not gateway.is_healthy

    def test_diagnostics_expose_every_counter(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [quote(1, T0)]
        drain(gateway, clock)
        diagnostics = gateway.diagnostics()
        for key in ("state", "healthy", "transport", "buffered", "stats", "gaps"):
            assert key in diagnostics
        assert diagnostics["stats"]["delivery_rate"] > 0


class TestValidationIntegration:
    def test_malformed_events_are_dropped_before_delivery(self, harness) -> None:
        gateway, transport, clock = harness
        gateway.connect()
        transport.queued = [
            quote(1, T0),
            QuoteEvent("CME:MES", "CME", T0, T0, T0, 2, "FAKE",
                       bid=5100.0, ask=5100.25, bid_size=-1.0, ask_size=10),
        ]
        delivered = drain(gateway, clock)
        assert len(delivered) == 1
        assert gateway.stats.dropped == 1
