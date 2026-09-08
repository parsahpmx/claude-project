"""Trading sessions, holidays and the exchange calendar.

Session logic is the one place where exchange-local time is authoritative.  Everything
else in the engine is UTC nanoseconds (``ARCHITECTURE.md`` §5.1).  DST is resolved by
:mod:`zoneinfo` rather than by fixed offsets, because a fixed offset is wrong for several
weeks a year and produces bars that straddle the open.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from core.events.enums import SessionState
from core.util.clock import Nanos, from_datetime, to_datetime

__all__ = ["SessionCalendar", "SessionSegment", "SessionSpecError", "TradingSession"]


class SessionSpecError(ValueError):
    """Raised when a session definition is malformed."""


def _parse_hhmm(text: str) -> time:
    try:
        hh, mm = text.split(":")
        return time(int(hh), int(mm))
    except (ValueError, AttributeError) as exc:
        raise SessionSpecError(f"expected HH:MM time, got {text!r}") from exc


@dataclass(frozen=True, slots=True)
class SessionSegment:
    """One continuous open period, expressed in exchange-local wall-clock time.

    Attributes:
        start: local start time.
        end: local end time.
        crosses_midnight: ``True`` when the segment runs past local midnight into the next
            calendar day, as CME's 17:00–16:00 outright session does.  It is derived, not
            configured, so it cannot disagree with the times.
        name: label such as ``RTH`` or ``GLOBEX``; carried into session events so
            performance can be attributed per session.
    """

    start: time
    end: time
    name: str = "MAIN"

    @property
    def crosses_midnight(self) -> bool:
        return self.end <= self.start

    @classmethod
    def from_config(cls, spec: dict[str, str]) -> SessionSegment:
        try:
            return cls(
                start=_parse_hhmm(spec["start"]),
                end=_parse_hhmm(spec["end"]),
                name=spec.get("name", "MAIN"),
            )
        except KeyError as exc:
            raise SessionSpecError(f"session segment missing key {exc.args[0]!r}") from exc


@dataclass(frozen=True, slots=True)
class TradingSession:
    """A named trading schedule for one or more instruments.

    Attributes:
        weekdays: ISO weekday numbers (Mon=1 … Sun=7) of active **trading dates**, not of
            the local dates on which a window happens to start.  For CME's 17:00–16:00
            outright session this is Mon–Fri: the window that opens Sunday evening belongs
            to Monday's trading date, and the one that would open Friday evening belongs
            to Saturday and therefore does not exist.
        holidays: closed **trading dates**.  Declaring 25 December closes the window that
            opened at 17:00 on the 24th, which is the window CME actually cancels.
        early_closes: trading dates mapped to an early local close time.
        settlement_time: local time treated as the daily bar boundary; defaults to the
            end of the last segment.
    """

    session_id: str
    timezone: str
    segments: tuple[SessionSegment, ...]
    weekdays: frozenset[int] = frozenset({1, 2, 3, 4, 5})
    holidays: frozenset[date] = frozenset()
    early_closes: dict[date, time] = field(default_factory=dict)
    settlement_time: time | None = None

    def __post_init__(self) -> None:
        if not self.segments:
            raise SessionSpecError(f"session {self.session_id!r} has no segments")
        if not self.weekdays:
            raise SessionSpecError(f"session {self.session_id!r} has no active weekdays")
        try:
            ZoneInfo(self.timezone)
        except Exception as exc:  # zoneinfo raises ZoneInfoNotFoundError, a subclass of KeyError
            raise SessionSpecError(
                f"session {self.session_id!r}: unknown timezone {self.timezone!r}"
            ) from exc

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @classmethod
    def continuous(cls, session_id: str = "24x7", timezone: str = "UTC") -> TradingSession:
        """A session that is always open — used for crypto-style or unrestricted feeds."""
        return cls(
            session_id=session_id,
            timezone=timezone,
            segments=(SessionSegment(time(0, 0), time(0, 0), "CONTINUOUS"),),
            weekdays=frozenset({1, 2, 3, 4, 5, 6, 7}),
        )

    @property
    def is_continuous(self) -> bool:
        return len(self.segments) == 1 and self.segments[0].name == "CONTINUOUS"


@dataclass(frozen=True, slots=True)
class _Window:
    """A concrete open window in absolute UTC nanoseconds."""

    start_ns: Nanos
    end_ns: Nanos
    name: str
    session_date: date


class SessionCalendar:
    """Answers session questions for one :class:`TradingSession`.

    Windows are materialised per local date and cached, so the hot path does a bisect over
    a small list rather than re-deriving timezone arithmetic on every tick.
    """

    __slots__ = ("_cache", "_last_window", "_session")

    def __init__(self, session: TradingSession) -> None:
        self._session = session
        self._cache: dict[date, tuple[_Window, ...]] = {}
        # The engine walks time forward, so consecutive queries almost always land in the
        # window resolved for the previous one.  Caching it turns the common case into two
        # integer comparisons instead of timezone arithmetic, which profiling showed to be
        # the third-largest cost in the event loop.
        self._last_window: _Window | None = None

    @property
    def session(self) -> TradingSession:
        return self._session

    def _windows_for(self, local_day: date) -> tuple[_Window, ...]:
        """Open windows *starting* on ``local_day`` (a window may end on the next day).

        Each candidate window is attributed to a trading date first; weekday, holiday and
        early-close rules are then applied to that trading date rather than to the local
        start date.
        """
        cached = self._cache.get(local_day)
        if cached is not None:
            return cached

        session = self._session
        tz = session.tz
        windows: list[_Window] = []
        for segment in session.segments:
            crosses = segment.crosses_midnight and not session.is_continuous
            session_date = local_day + timedelta(days=1) if crosses else local_day

            if session_date.isoweekday() not in session.weekdays:
                continue
            if session_date in session.holidays:
                continue

            if session.is_continuous:
                start_dt = datetime.combine(local_day, time(0, 0), tzinfo=tz)
                end_dt = start_dt + timedelta(days=1)
            else:
                start_dt = datetime.combine(local_day, segment.start, tzinfo=tz)
                end_day = local_day + timedelta(days=1) if crosses else local_day
                end_dt = datetime.combine(end_day, segment.end, tzinfo=tz)
                early = session.early_closes.get(session_date)
                if early is not None:
                    truncated = datetime.combine(end_day, early, tzinfo=tz)
                    if truncated < end_dt:
                        end_dt = truncated

            if end_dt <= start_dt:
                raise SessionSpecError(
                    f"session {session.session_id!r} segment {segment.name!r} on "
                    f"{local_day} resolves to a non-positive window "
                    f"({start_dt.isoformat()} -> {end_dt.isoformat()}); check the segment "
                    "times and any early close for this date"
                )
            windows.append(
                _Window(from_datetime(start_dt), from_datetime(end_dt), segment.name, session_date)
            )

        result = tuple(sorted(windows, key=lambda w: w.start_ns))
        self._cache[local_day] = result
        return result

    def _candidate_windows(self, ts: Nanos) -> list[_Window]:
        """Windows that could contain ``ts``, including one starting the previous day."""
        local = to_datetime(ts, self._session.timezone).date()
        out: list[_Window] = []
        for offset in (-1, 0):
            out.extend(self._windows_for(local + timedelta(days=offset)))
        return out

    def is_open(self, ts: Nanos) -> bool:
        """True when the venue is in an open window at ``ts``."""
        return self.current_window(ts) is not None

    def current_window(self, ts: Nanos) -> _Window | None:
        cached = self._last_window
        if cached is not None and cached.start_ns <= ts < cached.end_ns:
            return cached
        for window in self._candidate_windows(ts):
            if window.start_ns <= ts < window.end_ns:
                self._last_window = window
                return window
        return None

    def session_state(self, ts: Nanos) -> SessionState:
        """Coarse state at ``ts``.

        ``PRE`` is reported when the venue is closed but an open window begins later on
        the same local day; ``CLOSED`` otherwise.
        """
        if self.is_open(ts):
            return SessionState.OPEN
        local_day = to_datetime(ts, self._session.timezone).date()
        for window in self._windows_for(local_day):
            if ts < window.start_ns:
                return SessionState.PRE
        return SessionState.CLOSED

    def session_bounds(self, ts: Nanos) -> tuple[Nanos, Nanos] | None:
        """``(start, end)`` of the window containing ``ts``, or ``None`` if closed."""
        window = self.current_window(ts)
        return (window.start_ns, window.end_ns) if window else None

    def session_open_ns(self, ts: Nanos) -> Nanos | None:
        """Start of the window containing ``ts`` — the anchor for session VWAP and bars."""
        window = self.current_window(ts)
        return window.start_ns if window else None

    def session_date(self, ts: Nanos) -> date:
        """The *trading* date at ``ts``.

        For a session that opens the previous evening (CME 17:00 Chicago), an instant at
        20:00 on Monday belongs to Tuesday's trading date.  Attributing it to Monday is
        how overnight PnL lands in the wrong daily bucket — and, worse, how a daily-loss
        limit resets in the middle of a live position.

        When the venue is closed, the local calendar date is returned so that callers
        always get a usable bucket.
        """
        window = self.current_window(ts)
        if window is None:
            return to_datetime(ts, self._session.timezone).date()
        return window.session_date

    def next_open(self, ts: Nanos, max_days: int = 10) -> Nanos | None:
        """Start of the next open window at or after ``ts``, searching ``max_days`` ahead.

        Returns ``None`` rather than looping forever if the calendar is entirely closed
        over the horizon — a misconfigured holiday list should surface as a visible
        ``None``, not a hang.
        """
        local = to_datetime(ts, self._session.timezone).date()
        for offset in range(-1, max_days + 1):
            for window in self._windows_for(local + timedelta(days=offset)):
                if window.start_ns >= ts:
                    return window.start_ns
        return None

    def is_holiday(self, day: date) -> bool:
        return day in self._session.holidays

    def minutes_into_session(self, ts: Nanos) -> float | None:
        """Minutes elapsed since the current window opened, or ``None`` when closed."""
        window = self.current_window(ts)
        if window is None:
            return None
        return (ts - window.start_ns) / 60_000_000_000
