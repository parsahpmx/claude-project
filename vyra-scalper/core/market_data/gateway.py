"""Live market-data gateway.

Sits between a venue feed and the engine, and is responsible for the things a historical
file never does to you: arriving out of order, stopping without warning, resuming with a
sequence gap, and reconnecting into a different snapshot.

The gateway is transport-agnostic. A concrete feed implements :class:`FeedTransport`
(connect, disconnect, poll) and the gateway supplies everything above it: sequencing,
reordering within a bounded window, gap detection, staleness, reconnect with backoff, and
the latency stamps the rest of the engine reads. That split is what makes this component
testable — the transport is the only part that needs a venue, and it is the only part that
is not covered here.

Two rules carried over from ``DATA_SPEC.md``:

* a detected gap is **recorded and reported**, never interpolated;
* a reconnect invalidates the book until a fresh snapshot arrives, because the state on
  the other side of a disconnect is not the state we left.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

from core.events import Event, QuoteEvent
from core.market_data.normalization import Normalizer
from core.util.clock import NS_PER_MS, NS_PER_SEC, Nanos, now_ns
from core.util.logging import get_logger

__all__ = [
    "ConnectionState",
    "FeedTransport",
    "GatewayConfig",
    "GatewayStats",
    "MarketDataGateway",
    "SequenceGap",
]

_log = get_logger("market_data.gateway")


class ConnectionState(StrEnum):
    """Where the feed connection is."""

    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    RESYNCING = "RESYNCING"
    FAILED = "FAILED"

    @property
    def can_deliver(self) -> bool:
        """Whether events from this state may reach the engine.

        ``RESYNCING`` deliberately cannot: after a disconnect the book is unknown until a
        snapshot arrives, and delivering deltas against an unknown book produces a
        plausible, wrong price.
        """
        return self is ConnectionState.CONNECTED


@runtime_checkable
class FeedTransport(Protocol):
    """The venue-specific half of a live feed.

    Deliberately tiny. Everything that can be got wrong in a general way — ordering,
    gaps, staleness, reconnection — belongs to the gateway, so a new venue integration is
    only the part that is genuinely venue-specific.
    """

    @property
    def name(self) -> str: ...

    def connect(self, instruments: list[str]) -> None:
        """Open the feed. Raises on failure; the gateway handles retry and backoff."""

    def disconnect(self) -> None: ...

    def poll(self) -> Iterator[Event]:
        """Yield whatever has arrived since the last call. May yield nothing."""

    def is_connected(self) -> bool: ...


@dataclass(frozen=True, slots=True)
class SequenceGap:
    """A break in a venue's sequence numbering. Recorded, never filled."""

    instrument_id: str
    expected: int
    received: int
    ts: Nanos

    @property
    def missing(self) -> int:
        return self.received - self.expected

    def to_dict(self) -> dict[str, Any]:
        return {
            "instrument_id": self.instrument_id,
            "expected": self.expected,
            "received": self.received,
            "missing": self.missing,
            "ts": self.ts,
        }


@dataclass(frozen=True, slots=True)
class GatewayConfig:
    """Gateway policy.

    Attributes:
        reorder_window_ns: how long an event is held before delivery, so a slightly late
            event can be slotted into place. Buys ordering at the cost of exactly this
            much latency, which is why it is small and configured rather than assumed.
        max_reorder_buffer: hard cap on held events, so a silent feed cannot grow the
            buffer without bound.
        reconnect_backoff_ms: successive delays between reconnection attempts.
        max_reconnect_attempts: after this many consecutive failures the gateway reports
            ``FAILED`` and stops trying, rather than reconnecting forever while the engine
            believes data is coming.
        require_snapshot_after_reconnect: hold delivery until a fresh two-sided quote
            arrives after a reconnect.
    """

    reorder_window_ns: int = 5 * NS_PER_MS
    max_reorder_buffer: int = 10_000
    reconnect_backoff_ms: tuple[float, ...] = (100.0, 500.0, 2_000.0, 5_000.0)
    max_reconnect_attempts: int = 10
    require_snapshot_after_reconnect: bool = True
    heartbeat_timeout_ns: int = 30 * NS_PER_SEC

    def backoff_ns(self, attempt: int) -> int:
        """Delay before attempt ``attempt`` (0-based), clamped to the last configured step."""
        if not self.reconnect_backoff_ms:
            return 0
        index = min(attempt, len(self.reconnect_backoff_ms) - 1)
        return int(self.reconnect_backoff_ms[index] * NS_PER_MS)


@dataclass(slots=True)
class GatewayStats:
    """What the gateway saw. Reported alongside performance, like every other counter."""

    received: int = 0
    delivered: int = 0
    dropped: int = 0
    reordered: int = 0
    sequence_gaps: int = 0
    reconnects: int = 0
    suppressed_while_resyncing: int = 0

    def to_dict(self) -> dict[str, int | float]:
        return {
            "received": self.received,
            "delivered": self.delivered,
            "dropped": self.dropped,
            "reordered": self.reordered,
            "sequence_gaps": self.sequence_gaps,
            "reconnects": self.reconnects,
            "suppressed_while_resyncing": self.suppressed_while_resyncing,
            "delivery_rate": self.delivered / self.received if self.received else 0.0,
        }


class MarketDataGateway:
    """Turns a venue feed into an ordered, validated, gap-aware event stream.

    Args:
        transport: the venue-specific feed.
        instruments: what to subscribe to.
        normalizer: validation and flagging.
        config: gateway policy.
        clock: injectable time source, so tests drive time rather than sleeping.
    """

    __slots__ = (
        "_buffer",
        "_clock",
        "_config",
        "_gaps",
        "_instruments",
        "_last_delivered_ts",
        "_last_event_ns",
        "_last_venue_sequence",
        "_next_attempt_ns",
        "_normalizer",
        "_reconnect_attempts",
        "_resync_pending",
        "_sequence",
        "_state",
        "_stats",
        "_transport",
    )

    def __init__(
        self,
        transport: FeedTransport,
        instruments: list[str],
        normalizer: Normalizer,
        config: GatewayConfig | None = None,
        clock: Any = None,
    ) -> None:
        self._transport = transport
        self._instruments = list(instruments)
        self._normalizer = normalizer
        self._config = config or GatewayConfig()
        self._clock = clock or now_ns
        self._state = ConnectionState.DISCONNECTED
        self._buffer: list[tuple[Nanos, int, Event]] = []
        self._sequence = 0
        self._last_venue_sequence: dict[str, int] = {}
        self._last_delivered_ts: Nanos = 0
        self._last_event_ns: Nanos = 0
        self._gaps: list[SequenceGap] = []
        self._stats = GatewayStats()
        self._reconnect_attempts = 0
        self._next_attempt_ns: Nanos = 0
        self._resync_pending: set[str] = set()

    # -- state --------------------------------------------------------------------------

    @property
    def state(self) -> ConnectionState:
        return self._state

    @property
    def stats(self) -> GatewayStats:
        return self._stats

    @property
    def gaps(self) -> tuple[SequenceGap, ...]:
        return tuple(self._gaps)

    @property
    def is_healthy(self) -> bool:
        """Connected, delivering, and not silent past the heartbeat timeout."""
        if self._state is not ConnectionState.CONNECTED:
            return False
        if self._last_event_ns == 0:
            return True  # connected but nothing has arrived yet
        return self._clock() - self._last_event_ns <= self._config.heartbeat_timeout_ns

    def diagnostics(self) -> dict[str, Any]:
        return {
            "state": self._state.value,
            "healthy": self.is_healthy,
            "transport": self._transport.name,
            "instruments": list(self._instruments),
            "buffered": len(self._buffer),
            "reconnect_attempts": self._reconnect_attempts,
            "awaiting_snapshot": sorted(self._resync_pending),
            "stats": self._stats.to_dict(),
            "gaps": [g.to_dict() for g in self._gaps[-20:]],
        }

    # -- connection ---------------------------------------------------------------------

    def connect(self) -> bool:
        """Attempt to connect. Returns success; never raises on a transport failure.

        A feed that cannot be reached is an operational condition, not a programming
        error, and it must not take the process down.
        """
        self._state = ConnectionState.CONNECTING
        try:
            self._transport.connect(self._instruments)
        except Exception as exc:
            self._reconnect_attempts += 1
            self._next_attempt_ns = self._clock() + self._config.backoff_ns(
                self._reconnect_attempts - 1
            )
            self._state = (
                ConnectionState.FAILED
                if self._reconnect_attempts >= self._config.max_reconnect_attempts
                else ConnectionState.DISCONNECTED
            )
            _log.error(
                "feed_connect_failed",
                transport=self._transport.name,
                attempt=self._reconnect_attempts,
                state=self._state.value,
                error=str(exc),
            )
            return False

        self._reconnect_attempts = 0
        self._last_event_ns = 0
        # A transport-level connection is not a usable book. When a snapshot is required
        # the gateway stays in RESYNCING until one arrives for every instrument; going
        # straight to CONNECTED here would discard the requirement _on_connection_lost
        # had just established and deliver deltas against an unknown book.
        if self._resync_pending:
            self._state = ConnectionState.RESYNCING
            _log.info(
                "feed_connected_awaiting_snapshot",
                transport=self._transport.name,
                awaiting=len(self._resync_pending),
            )
            return True

        self._state = ConnectionState.CONNECTED
        _log.info(
            "feed_connected",
            transport=self._transport.name,
            instruments=len(self._instruments),
        )
        return True

    def disconnect(self) -> None:
        try:
            self._transport.disconnect()
        except Exception:
            _log.exception("feed_disconnect_failed", transport=self._transport.name)
        self._state = ConnectionState.DISCONNECTED
        self._buffer.clear()

    def _on_connection_lost(self, reason: str) -> None:
        """Enter resync. The book on the other side of a disconnect is not the book we left."""
        if self._state is ConnectionState.RESYNCING:
            return
        self._state = ConnectionState.RESYNCING
        self._stats.reconnects += 1
        self._buffer.clear()
        self._last_venue_sequence.clear()
        if self._config.require_snapshot_after_reconnect:
            self._resync_pending = set(self._instruments)
        _log.warning(
            "feed_connection_lost",
            transport=self._transport.name,
            reason=reason,
            awaiting_snapshot=len(self._resync_pending),
        )

    def maybe_reconnect(self) -> bool:
        """Reconnect if a backoff has elapsed.

        Returns whether an attempt was **made**, not whether it succeeded — a caller
        driving a retry loop needs to know that the backoff was consumed, and a failed
        attempt still consumes it. Success is read from :attr:`state`.
        """
        if self._state in (ConnectionState.CONNECTED, ConnectionState.FAILED):
            return False
        if self._clock() < self._next_attempt_ns:
            return False
        self.connect()
        return True

    # -- the main loop ------------------------------------------------------------------

    def poll(self) -> list[Event]:
        """Collect from the transport and return events ready for the engine.

        Events are held for ``reorder_window_ns`` before delivery, so a slightly late
        event can be placed in order. That delay is the price of ordering and is applied
        to the ``ts_processed`` stamp, so downstream latency measurement reflects it.
        """
        if self._state is ConnectionState.FAILED:
            return []

        if not self._transport.is_connected():
            self._on_connection_lost("transport reported disconnected")
            self.maybe_reconnect()
            return self._drain(force=True)

        try:
            for event in self._transport.poll():
                self._ingest(event)
        except Exception as exc:
            _log.exception("feed_poll_failed", transport=self._transport.name, error=str(exc))
            self._on_connection_lost(f"poll failed: {exc}")
            return self._drain(force=True)

        return self._drain()

    def _ingest(self, event: Event) -> None:
        """Validate, sequence-check and buffer one raw event."""
        self._stats.received += 1
        self._last_event_ns = self._clock()

        result = self._normalizer.normalize(event)
        if not result.is_accepted or result.event is None:
            self._stats.dropped += 1
            return
        event = result.event

        self._check_venue_sequence(event)

        if self._state is ConnectionState.RESYNCING:
            if self._is_snapshot(event):
                self._resync_pending.discard(event.instrument_id)
                if not self._resync_pending:
                    self._state = ConnectionState.CONNECTED
                    _log.info("feed_resynced", transport=self._transport.name)
            else:
                # Deltas against an unknown book produce a plausible, wrong price.
                self._stats.suppressed_while_resyncing += 1
                return

        self._sequence += 1
        # Buffered under the VENUE timestamp, not a processing stamp. Stamping at ingest
        # would give every event collected in one poll the same key, and the buffer would
        # sort by arrival order -- exactly the ordering it exists to correct.
        # ts_processed is applied at delivery, where it is also true.
        self._buffer.append((event.ts, self._sequence, event))
        if len(self._buffer) > self._config.max_reorder_buffer:
            # A bounded buffer: a feed that stops advancing must not consume memory
            # without limit. Oldest first, since those are the ones already due.
            self._buffer.sort()
            overflow = len(self._buffer) - self._config.max_reorder_buffer
            _log.warning("reorder_buffer_overflow", dropped=overflow)
            self._stats.dropped += overflow
            del self._buffer[:overflow]

    def _is_snapshot(self, event: Event) -> bool:
        """Whether this event re-establishes a usable book for its instrument."""
        return isinstance(event, QuoteEvent) and event.is_two_sided

    def _check_venue_sequence(self, event: Event) -> None:
        """Record a break in the venue's own numbering.

        Recorded, never filled: the missing messages are gone, and inventing them would be
        the silent repair this platform forbids.
        """
        last = self._last_venue_sequence.get(event.instrument_id)
        if last is not None and event.sequence_id > last + 1:
            gap = SequenceGap(event.instrument_id, last + 1, event.sequence_id, event.ts)
            self._gaps.append(gap)
            self._stats.sequence_gaps += 1
            _log.warning(
                "sequence_gap",
                instrument=event.instrument_id,
                expected=gap.expected,
                received=gap.received,
                missing=gap.missing,
            )
        if last is None or event.sequence_id > last:
            self._last_venue_sequence[event.instrument_id] = event.sequence_id

    def _drain(self, force: bool = False) -> list[Event]:
        """Release buffered events whose reorder window has elapsed."""
        if not self._buffer:
            return []
        self._buffer.sort()
        cutoff = self._clock() - self._config.reorder_window_ns

        ready: list[Event] = []
        remaining: list[tuple[Nanos, int, Event]] = []
        for ts, seq, event in self._buffer:
            if force or ts <= cutoff:
                ready.append(event)
            else:
                remaining.append((ts, seq, event))
        self._buffer = remaining

        delivered_at = self._clock()
        delivered: list[Event] = []
        for event in ready:
            if event.ts < self._last_delivered_ts:
                # Too late to place in order. Delivering it would break the monotonicity
                # every downstream component relies on, so it is dropped and counted.
                self._stats.reordered += 1
                self._stats.dropped += 1
                _log.debug(
                    "event_arrived_after_its_window",
                    instrument=event.instrument_id,
                    ts=event.ts,
                    last_delivered=self._last_delivered_ts,
                )
                continue
            self._last_delivered_ts = event.ts
            delivered.append(event.with_processed(delivered_at))

        self._stats.delivered += len(delivered)
        return delivered
