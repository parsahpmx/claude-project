"""Market-data freshness gating.

Trading on a stale book is trading against information the market has already moved past.
The gate is session-aware: a quote is not "stale" because the venue is closed, only
because the feed has gone quiet while the venue is open (``DATA_SPEC.md`` §4).
"""

from __future__ import annotations

from dataclasses import dataclass

from core.events import Event, QuoteEvent, StalenessState
from core.instruments.sessions import SessionCalendar
from core.util.clock import NS_PER_MS, Nanos

__all__ = ["StalenessGate", "StalenessThresholds"]


@dataclass(frozen=True, slots=True)
class StalenessThresholds:
    """Per-asset-class freshness thresholds in milliseconds.

    Defaults are the futures profile; equities and CFD are looser because their quote
    cadence is lower.
    """

    warn_ms: float = 500.0
    stale_ms: float = 2_000.0
    dead_ms: float = 10_000.0

    def __post_init__(self) -> None:
        if not 0 < self.warn_ms <= self.stale_ms <= self.dead_ms:
            raise ValueError(
                "thresholds must satisfy 0 < warn <= stale <= dead, got "
                f"{self.warn_ms}/{self.stale_ms}/{self.dead_ms}"
            )

    def classify(self, age_ns: int) -> StalenessState:
        age_ms = age_ns / NS_PER_MS
        if age_ms > self.dead_ms:
            return StalenessState.DEAD
        if age_ms > self.stale_ms:
            return StalenessState.STALE
        if age_ms > self.warn_ms:
            return StalenessState.WARN
        return StalenessState.FRESH


class StalenessGate:
    """Tracks the age of the last accepted quote per instrument.

    ``STALE`` blocks new entries for that instrument; ``DEAD`` is a kill-switch trigger.
    The gate itself never trips the switch — it reports, and the risk engine decides.
    Keeping the decision in one place is what makes the kill-switch triggers auditable.
    """

    __slots__ = ("_calendars", "_last_quote_ns", "_thresholds", "_default")

    def __init__(
        self,
        thresholds: dict[str, StalenessThresholds] | None = None,
        default: StalenessThresholds | None = None,
        calendars: dict[str, SessionCalendar] | None = None,
    ) -> None:
        self._thresholds = thresholds or {}
        self._default = default or StalenessThresholds()
        self._calendars = calendars or {}
        self._last_quote_ns: dict[str, Nanos] = {}

    def observe(self, event: Event) -> None:
        """Record a quote as the instrument's freshness reference.

        Only quotes count.  A trade print without a refreshed quote does not mean the book
        is current — it may be a late report of an earlier execution.
        """
        if isinstance(event, QuoteEvent):
            previous = self._last_quote_ns.get(event.instrument_id, 0)
            # Guard against an out-of-order quote making the feed look fresher than it is.
            if event.ts >= previous:
                self._last_quote_ns[event.instrument_id] = event.ts

    def age_ns(self, instrument_id: str, now: Nanos) -> int | None:
        """Nanoseconds since the last quote, or ``None`` if none has been seen."""
        last = self._last_quote_ns.get(instrument_id)
        if last is None:
            return None
        return max(0, now - last)

    def state(self, instrument_id: str, now: Nanos) -> StalenessState:
        """Freshness state, accounting for session hours.

        Returns ``FRESH`` outside session hours: a quiet feed on a closed venue is
        correct behaviour, and reporting it as ``DEAD`` would trip the kill switch every
        evening.  Trading outside sessions is blocked by the session check, not here.
        """
        calendar = self._calendars.get(instrument_id)
        if calendar is not None and not calendar.is_open(now):
            return StalenessState.FRESH

        age = self.age_ns(instrument_id, now)
        if age is None:
            # No quote yet during an open session is itself a lack of data, not freshness.
            return StalenessState.STALE
        return self._thresholds.get(instrument_id, self._default).classify(age)

    def is_tradeable(self, instrument_id: str, now: Nanos) -> bool:
        return self.state(instrument_id, now) in (StalenessState.FRESH, StalenessState.WARN)

    def snapshot(self, now: Nanos) -> dict[str, dict[str, object]]:
        """Per-instrument freshness, for the health endpoint and system events."""
        return {
            iid: {
                "age_ms": (self.age_ns(iid, now) or 0) / NS_PER_MS,
                "state": self.state(iid, now).value,
            }
            for iid in sorted(self._last_quote_ns)
        }
