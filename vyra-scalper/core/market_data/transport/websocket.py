"""A WebSocket feed transport.

The gateway's :class:`~core.market_data.gateway.FeedTransport` is synchronous and polled,
because the engine's event loop is. A socket is not: frames arrive when the venue sends
them. This class owns that mismatch and nothing else — a reader thread drains the socket
into a bounded queue, and ``poll()`` takes whatever has landed.

Three decisions worth stating:

**The queue is bounded and drops the oldest.** A consumer that falls behind a fast feed has
to lose something; losing the *newest* tick would leave the engine acting on a stale price
while a fresher one sat in the buffer. Drops are counted, and the count is reported — a
silent drop is a data-integrity failure, not a performance detail.

**Heartbeat loss is a disconnect, not a slow patch.** A venue that has stopped sending is
indistinguishable from a socket that is up but dead, and the difference matters only to the
socket. After ``heartbeat_timeout_ns`` with nothing received, ``is_connected()`` reports
False and the gateway's existing reconnect path takes over.

**Malformed frames are counted and dropped, never guessed at.** A frame that does not parse
is evidence of a protocol mismatch; inventing a plausible event from it would turn a
visible integration bug into an invisible data-quality one.
"""

from __future__ import annotations

import contextlib
import json
import queue
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from core.events import Event
from core.util.clock import NS_PER_MS, NS_PER_SEC, Nanos, now_ns
from core.util.logging import get_logger

__all__ = ["WebSocketFeedConfig", "WebSocketTransport"]

_log = get_logger("market_data.transport.websocket")

# Frames the venue sends to prove it is alive. They carry no market data, so they are
# counted as liveness and never turned into events.
_HEARTBEAT_TYPES = frozenset({"heartbeat", "ping", "pong"})


@dataclass(frozen=True, slots=True)
class WebSocketFeedConfig:
    """Transport policy.

    Attributes:
        url: the feed endpoint. Credentials never appear here — they go in ``headers``,
            which is redacted from every log line and diagnostic this class produces.
        subscribe_template: a JSON message sent on connect, with ``{instruments}``
            substituted. Venues differ enough that this is configuration, not code.
        heartbeat_timeout_ns: silence after which the feed is treated as down.
        max_queue: bound on undelivered frames. Oldest are dropped first.
        open_timeout_s: how long ``connect`` waits for the socket and the first
            subscription acknowledgement before failing. The gateway handles backoff.
    """

    url: str
    subscribe_template: str = '{{"action":"subscribe","instruments":{instruments}}}'
    heartbeat_timeout_ns: Nanos = 30 * NS_PER_SEC
    max_queue: int = 100_000
    open_timeout_s: float = 5.0
    headers: dict[str, str] = field(default_factory=dict, repr=False)
    """Auth headers. Excluded from ``repr`` so a transport cannot be logged into a token."""


@dataclass(slots=True)
class _TransportStats:
    frames: int = 0
    events: int = 0
    heartbeats: int = 0
    malformed: int = 0
    dropped_full_queue: int = 0
    reconnects: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "frames": self.frames,
            "events": self.events,
            "heartbeats": self.heartbeats,
            "malformed": self.malformed,
            "dropped_full_queue": self.dropped_full_queue,
            "reconnects": self.reconnects,
        }


class WebSocketTransport:
    """Reads a JSON-framed WebSocket feed into the gateway.

    Args:
        config: endpoint and policy.
        decoder: turns one decoded JSON frame into an :class:`Event`, or ``None`` when the
            frame carries no market data. Venue-specific by nature, so it is injected
            rather than guessed: this class handles sockets, not schemas.
    """

    __slots__ = (
        "_config",
        "_decoder",
        "_error",
        "_last_message_ns",
        "_queue",
        "_reader",
        "_socket",
        "_stats",
        "_stop",
        "_subscribed",
    )

    def __init__(
        self,
        config: WebSocketFeedConfig,
        decoder: Callable[[dict[str, Any]], Event | None],
    ) -> None:
        self._config = config
        self._decoder = decoder
        self._queue: queue.Queue[Event] = queue.Queue(maxsize=config.max_queue)
        self._stats = _TransportStats()
        self._socket: Any = None
        self._reader: threading.Thread | None = None
        self._stop = threading.Event()
        self._last_message_ns: Nanos = 0
        self._subscribed: list[str] = []
        self._error: str = ""

    @property
    def name(self) -> str:
        # The host, never the full URL: a query string is where a venue puts a token.
        host = self._config.url.split("://", 1)[-1].split("/", 1)[0].split("?", 1)[0]
        return f"ws:{host}"

    @property
    def stats(self) -> dict[str, int]:
        return self._stats.to_dict()

    @property
    def last_message_ns(self) -> Nanos:
        """When a frame — data or heartbeat — last arrived. 0 before the first."""
        return self._last_message_ns

    def silence_ns(self, now: Nanos | None = None) -> Nanos:
        """How long the feed has been quiet. ``0`` before the first frame."""
        if self._last_message_ns == 0:
            return 0
        return (now if now is not None else now_ns()) - self._last_message_ns

    def diagnostics(self) -> dict[str, Any]:
        """Everything an operator needs, and no credential.

        ``headers`` is never included: it is where the venue token lives, and a diagnostic
        endpoint that returned it would be a credential leak through the back door.
        """
        return {
            "transport": self.name,
            "connected": self.is_connected(),
            "subscribed": list(self._subscribed),
            "silence_ms": self.silence_ns() / NS_PER_MS,
            "heartbeat_timeout_ms": self._config.heartbeat_timeout_ns / NS_PER_MS,
            "queued": self._queue.qsize(),
            "last_error": self._error,
            "stats": self.stats,
        }

    # -- connection ---------------------------------------------------------------------

    def connect(self, instruments: list[str]) -> None:
        """Open the socket and subscribe. Raises on failure; the gateway retries."""
        try:
            from websockets.sync.client import connect as ws_connect
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise RuntimeError(
                "the websockets package is required for WebSocketTransport; "
                "install it with: pip install 'websockets>=12'"
            ) from exc

        self.disconnect()
        self._stop.clear()
        self._error = ""
        self._subscribed = list(instruments)
        try:
            # Entered explicitly rather than with a `with` block: the socket outlives this
            # method by design, and the transport closes it in disconnect(). websockets 17
            # deprecates using the returned object without entering it at all, so this is
            # the supported non-legacy form of "open it and hold it".
            self._socket = ws_connect(
                self._config.url,
                additional_headers=self._config.headers or None,
                open_timeout=self._config.open_timeout_s,
            ).__enter__()
            message = self._config.subscribe_template.format(
                instruments=json.dumps(instruments)
            )
            self._socket.send(message)
        except Exception as exc:
            self._error = str(exc)
            self._socket = None
            # The URL is logged, the headers are not.
            _log.warning("feed_connect_failed", transport=self.name, detail=str(exc))
            raise

        # Stamped on connect so a feed that never sends anything still ages out through
        # the heartbeat path instead of looking permanently fresh.
        self._last_message_ns = now_ns()
        self._reader = threading.Thread(
            target=self._read_loop, name=f"feed-{self.name}", daemon=True
        )
        self._reader.start()
        _log.info("feed_connected", transport=self.name, instruments=len(instruments))

    def disconnect(self) -> None:
        """Close the socket and stop the reader. Safe to call when already closed."""
        self._stop.set()
        socket, self._socket = self._socket, None
        if socket is not None:
            # Closing a socket that is already gone is not an error worth propagating out
            # of a shutdown path.
            with contextlib.suppress(Exception):
                socket.close()
        reader, self._reader = self._reader, None
        if reader is not None and reader.is_alive():
            reader.join(timeout=2.0)

    def is_connected(self) -> bool:
        """Whether the feed is both open and *talking*.

        A socket that is up but silent past the heartbeat timeout reports False. The engine
        cannot tell those two apart from the outside, and the one that matters — is the
        data current — is the same in both cases.
        """
        if self._socket is None:
            return False
        if self._last_message_ns == 0:
            return True
        return self.silence_ns() <= self._config.heartbeat_timeout_ns

    # -- reading ------------------------------------------------------------------------

    def _read_loop(self) -> None:
        socket = self._socket
        if socket is None:  # pragma: no cover - set immediately before the thread starts
            return
        try:
            for raw in socket:
                if self._stop.is_set():
                    return
                self._on_frame(raw)
        except Exception as exc:
            if not self._stop.is_set():
                self._error = str(exc)
                _log.warning("feed_read_failed", transport=self.name, detail=str(exc))
        finally:
            # The socket is gone; is_connected() must say so immediately rather than
            # waiting out the heartbeat timeout.
            self._socket = None

    def _on_frame(self, raw: str | bytes) -> None:
        self._stats.frames += 1
        self._last_message_ns = now_ns()
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            self._stats.malformed += 1
            return
        if not isinstance(payload, dict):
            self._stats.malformed += 1
            return
        if str(payload.get("type", "")).lower() in _HEARTBEAT_TYPES:
            self._stats.heartbeats += 1
            return
        try:
            event = self._decoder(payload)
        except Exception as exc:
            # A decoder that raises is a schema mismatch, which is a bug to fix, not a
            # frame to guess at. Counted and dropped.
            self._stats.malformed += 1
            _log.warning("feed_decode_failed", transport=self.name, detail=str(exc))
            return
        if event is None:
            return
        self._offer(event)

    def _offer(self, event: Event) -> None:
        """Enqueue, dropping the oldest when full.

        Dropping the newest would leave the engine trading on a stale price with a fresher
        one already in hand, which is the worse of the two failures.
        """
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            try:
                self._queue.get_nowait()
                self._stats.dropped_full_queue += 1
            except queue.Empty:  # pragma: no cover - drained between the two calls
                pass
            try:
                self._queue.put_nowait(event)
            except queue.Full:  # pragma: no cover - refilled between the two calls
                self._stats.dropped_full_queue += 1

    def poll(self) -> Iterator[Event]:
        """Yield whatever has arrived since the last call.

        Bounded by the queue length captured on entry, so a feed producing faster than the
        engine consumes cannot hold the loop inside one poll indefinitely.
        """
        for _ in range(self._queue.qsize()):
            try:
                event = self._queue.get_nowait()
            except queue.Empty:  # pragma: no cover - drained concurrently
                return
            self._stats.events += 1
            yield event
