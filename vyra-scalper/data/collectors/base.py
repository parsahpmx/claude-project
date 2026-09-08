"""Historical data source interface.

A source yields events in non-decreasing ``ts_processed`` order for one or more
instruments.  The backtest driver merges multiple sources through a priority queue, so a
source is not required to know about any other source's timeline.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol, runtime_checkable

from core.events import Event
from core.util.clock import Nanos

__all__ = ["DataSource", "DataSourceError"]


class DataSourceError(RuntimeError):
    """Raised when a source cannot produce the requested data.

    Always a hard failure.  Returning a short or empty series for a requested range would
    produce a backtest over silently different data than the manifest claims.
    """


@runtime_checkable
class DataSource(Protocol):
    """Produces market events for a time range."""

    @property
    def source_id(self) -> str:
        """Provenance string stamped onto every event, e.g. ``SYNTH:v1``."""
        ...

    @property
    def instruments(self) -> tuple[str, ...]:
        ...

    def events(self, start_ns: Nanos, end_ns: Nanos) -> Iterator[Event]:
        """Yield events with ``start_ns <= ts < end_ns``, in non-decreasing time order."""
        ...

    def content_fingerprint(self) -> str:
        """A hash identifying exactly what this source will produce.

        Referenced by the run manifest.  If the data changes, the fingerprint changes, and
        an old result is not silently re-attributed to new data (``BACKTEST_SPEC.md`` §7).
        """
        ...
