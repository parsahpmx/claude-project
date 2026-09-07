"""UTC time handling.

Every timestamp inside the engine is an ``int`` count of **nanoseconds since the Unix
epoch, UTC**.  Integers are used rather than :class:`datetime` or ``float`` seconds
because:

* event ordering must be exact and total (float seconds lose ns resolution past 2^53);
* latency arithmetic is differencing, which must not accumulate representation error;
* serialisation is unambiguous across languages and storage engines.

Conversion to and from wall-clock types happens only at ingestion and presentation
boundaries, and exchange-local time is used exclusively for session/calendar logic.
"""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

Nanos = int
"""Nanoseconds since the Unix epoch, UTC."""

NS_PER_US = 1_000
NS_PER_MS = 1_000_000
NS_PER_SEC = 1_000_000_000
NS_PER_MIN = 60 * NS_PER_SEC
NS_PER_HOUR = 60 * NS_PER_MIN
NS_PER_DAY = 24 * NS_PER_HOUR

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def now_ns() -> Nanos:
    """Current wall-clock time in UTC nanoseconds.

    Uses :func:`time.time_ns`, which is epoch-based and therefore comparable with venue
    timestamps.  It is *not* monotonic; use :func:`monotonic_ns` for interval measurement
    that must survive a clock adjustment.
    """
    return time.time_ns()


def monotonic_ns() -> Nanos:
    """Monotonic nanosecond counter, for measuring durations only.

    Not comparable with :func:`now_ns` or with venue timestamps.
    """
    return time.monotonic_ns()


def to_datetime(ts: Nanos, tz: str | None = None) -> datetime:
    """Convert epoch nanoseconds to an aware :class:`datetime`.

    Args:
        ts: epoch nanoseconds, UTC.
        tz: optional IANA timezone name for the returned object.  ``None`` yields UTC.

    Note:
        :class:`datetime` has microsecond resolution, so this conversion is lossy below
        1 us.  It is intended for logging, session logic and reports — never for
        round-tripping event timestamps.
    """
    # Built from an exact timedelta rather than ``fromtimestamp(ts / 1e9)``: dividing a
    # nanosecond epoch by 1e9 loses resolution once the value exceeds 2**53 ns (~1970+104
    # days of nanoseconds), which is every timestamp we will ever see.
    dt = _EPOCH + timedelta(microseconds=ts // NS_PER_US)
    if tz is not None:
        dt = dt.astimezone(ZoneInfo(tz))
    return dt


def from_datetime(dt: datetime) -> Nanos:
    """Convert an aware :class:`datetime` to epoch nanoseconds.

    Raises:
        ValueError: if ``dt`` is naive.  A naive datetime has no defined instant, and
            guessing its zone is exactly the class of bug that produces off-by-one-hour
            session boundaries twice a year.
    """
    if dt.tzinfo is None:
        raise ValueError("naive datetime rejected: attach a timezone before conversion")
    # Integer arithmetic against the epoch.  ``timedelta`` normalises to
    # (days, seconds, microseconds) with the latter two non-negative, so this is exact and
    # correct for pre-1970 instants, where ``int(dt.timestamp())`` would truncate toward
    # zero and land a second in the future.
    delta = dt - _EPOCH
    return delta.days * NS_PER_DAY + delta.seconds * NS_PER_SEC + delta.microseconds * NS_PER_US


def from_iso(text: str) -> Nanos:
    """Parse an ISO-8601 timestamp into epoch nanoseconds.

    A trailing ``Z`` is accepted.  A string without offset information is rejected for
    the reason given in :func:`from_datetime`.
    """
    normalised = text.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalised)
    if dt.tzinfo is None:
        raise ValueError(f"timestamp {text!r} has no timezone offset")
    return from_datetime(dt)


def to_iso(ts: Nanos) -> str:
    """Render epoch nanoseconds as an ISO-8601 UTC string (microsecond precision)."""
    return to_datetime(ts).isoformat()


def local_date(ts: Nanos, tz: str) -> date:
    """The calendar date at ``ts`` in exchange-local time ``tz``.

    Session and holiday logic must use this rather than the UTC date: the CME trading day
    beginning 17:00 America/Chicago belongs to the *next* calendar date.
    """
    return to_datetime(ts, tz).date()


def day_start_ns(d: date, tz: str) -> Nanos:
    """Epoch nanoseconds of local midnight on ``d`` in timezone ``tz``.

    DST is resolved by :mod:`zoneinfo`; on a spring-forward date where local midnight does
    not exist this returns the instant Python's fold rules select, which is the same
    instant the exchange calendar uses.
    """
    dt = datetime(d.year, d.month, d.day, tzinfo=ZoneInfo(tz))
    return from_datetime(dt)


def add_days(ts: Nanos, days: int, tz: str) -> Nanos:
    """Add calendar days in local time ``tz``, preserving local wall-clock time.

    This differs from adding ``days * NS_PER_DAY`` across a DST boundary, where the
    elapsed physical time is 23 or 25 hours.
    """
    dt = to_datetime(ts, tz) + timedelta(days=days)
    return from_datetime(dt)


def align_down(ts: Nanos, interval_ns: int, origin_ns: Nanos = 0) -> Nanos:
    """Floor ``ts`` to a grid of ``interval_ns`` anchored at ``origin_ns``.

    Used for bar boundaries, where ``origin_ns`` is the session open rather than the UTC
    epoch — a 4-hour CME bar starts at the session open, not at 00:00 UTC.

    Raises:
        ValueError: if ``interval_ns`` is not positive.
    """
    if interval_ns <= 0:
        raise ValueError(f"interval_ns must be positive, got {interval_ns}")
    delta = ts - origin_ns
    # Python floor-divides toward negative infinity, which is the behaviour we want for
    # timestamps before the origin.
    return origin_ns + (delta // interval_ns) * interval_ns


def format_duration(ns: int) -> str:
    """Human-readable duration for logs and reports."""
    if ns < 1_000:
        return f"{ns}ns"
    if ns < NS_PER_MS:
        return f"{ns / NS_PER_US:.1f}us"
    if ns < NS_PER_SEC:
        return f"{ns / NS_PER_MS:.1f}ms"
    if ns < NS_PER_MIN:
        return f"{ns / NS_PER_SEC:.2f}s"
    if ns < NS_PER_HOUR:
        return f"{ns / NS_PER_MIN:.1f}m"
    return f"{ns / NS_PER_HOUR:.1f}h"
