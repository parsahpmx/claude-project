"""The ingestion pipeline: raw source in, normalised dataset out.

One job, done in one place: read from a source, validate every event, record what was
rejected and why, detect gaps, write Parquet partitions, and stamp a manifest with a
content hash.

The rule this enforces is the one from ``DATA_SPEC.md`` §1 — **never silently repair
data**. Nothing here interpolates a missing tick or forward-fills a quote. Rejected rows
are counted, gaps are recorded, and both appear in the manifest so a backtest can report
the quality of what it actually ran on.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from core.events import Event
from core.instruments.instrument import Instrument
from core.instruments.sessions import SessionCalendar
from core.market_data.normalization import Normalizer
from core.util.clock import NS_PER_MIN, Nanos, to_iso
from core.util.logging import get_logger
from data.storage.manifest import DataGap, DatasetManifest, hash_directory
from data.storage.parquet_store import ParquetStore

__all__ = ["IngestionConfig", "IngestionPipeline", "IngestionResult"]

_log = get_logger("data.normalization.pipeline")


class _Source(Protocol):
    """The part of :class:`~data.collectors.base.DataSource` ingestion needs."""

    @property
    def source_id(self) -> str: ...

    def events(self, start_ns: Nanos, end_ns: Nanos) -> Iterator[Event]: ...

    def content_fingerprint(self) -> str: ...


@dataclass(frozen=True, slots=True)
class IngestionConfig:
    """How raw data is turned into a dataset.

    Attributes:
        gap_threshold_minutes: a quiet period longer than this, while the venue is open,
            is recorded as an unexplained gap. Periods while the venue is closed are
            recorded with a reason instead, so a weekend cannot hide a feed outage.
        batch_size: events buffered before a write. Bounds memory on a multi-year ingest.
        strict_ordering: drop out-of-order events rather than flagging them. Appropriate
            for a research dataset that must be strictly monotonic.
    """

    gap_threshold_minutes: float = 5.0
    batch_size: int = 500_000
    strict_ordering: bool = False


@dataclass(slots=True)
class IngestionResult:
    """What one ingestion produced."""

    manifest: DatasetManifest
    accepted: int = 0
    dropped: int = 0
    directory: Path = field(default_factory=Path)

    @property
    def drop_rate(self) -> float:
        total = self.accepted + self.dropped
        return self.dropped / total if total else 0.0

    def summary(self) -> str:
        return (
            f"{self.manifest.dataset_id}: {self.accepted:,} accepted, "
            f"{self.dropped:,} dropped ({self.drop_rate:.2%}), "
            f"{len(self.manifest.gaps)} gaps "
            f"({len(self.manifest.unexplained_gaps)} unexplained)"
        )


class IngestionPipeline:
    """Normalises a raw source into a Parquet dataset with a manifest."""

    __slots__ = ("_calendar", "_config", "_instrument", "_normalizer", "_store")

    def __init__(
        self,
        instrument: Instrument,
        output_root: str | Path,
        calendar: SessionCalendar | None = None,
        config: IngestionConfig | None = None,
    ) -> None:
        self._instrument = instrument
        self._calendar = calendar
        self._config = config or IngestionConfig()
        self._store = ParquetStore(output_root, instrument.timezone)
        self._normalizer = Normalizer(
            {instrument.instrument_id: instrument},
            strict_ordering=self._config.strict_ordering,
        )

    @property
    def store(self) -> ParquetStore:
        return self._store

    def ingest(
        self,
        source: _Source,
        start_ns: Nanos,
        end_ns: Nanos,
        dataset_id: str | None = None,
    ) -> IngestionResult:
        """Read, validate, partition and stamp.

        Raises:
            ValueError: if the range is empty, or if the source produced nothing. An empty
                dataset that looks successful is worse than a failure: a backtest over it
                reports zero trades and no error.
        """
        if end_ns <= start_ns:
            raise ValueError(f"empty range: {to_iso(start_ns)} to {to_iso(end_ns)}")

        instrument_id = self._instrument.instrument_id
        resolved_id = dataset_id or (
            f"{instrument_id.replace(':', '_')}_{to_iso(start_ns)[:10]}_{to_iso(end_ns)[:10]}"
        )
        _log.info(
            "ingestion_started",
            dataset_id=resolved_id,
            instrument=instrument_id,
            source=source.source_id,
            window=f"{to_iso(start_ns)}..{to_iso(end_ns)}",
        )

        accepted: list[Event] = []
        accepted_count = 0
        dropped_count = 0
        gaps: list[DataGap] = []
        last_ts: Nanos = 0
        first_ts: Nanos = 0
        threshold_ns = int(self._config.gap_threshold_minutes * NS_PER_MIN)

        for raw in source.events(start_ns, end_ns):
            result = self._normalizer.normalize(raw)
            if not result.is_accepted or result.event is None:
                dropped_count += 1
                continue
            event = result.event

            if last_ts and event.ts - last_ts > threshold_ns:
                gaps.append(self._classify_gap(last_ts, event.ts))
            last_ts = max(last_ts, event.ts)
            if first_ts == 0:
                first_ts = event.ts

            accepted.append(event)
            accepted_count += 1
            if len(accepted) >= self._config.batch_size:
                self._store.write_events(self._instrument, accepted)
                accepted = []

        if accepted:
            self._store.write_events(self._instrument, accepted)

        if accepted_count == 0:
            raise ValueError(
                f"{source.source_id} produced no usable events between {to_iso(start_ns)} "
                f"and {to_iso(end_ns)} ({dropped_count} rejected). An empty dataset that "
                "looks successful is worse than a failure."
            )

        manifest = DatasetManifest(
            dataset_id=resolved_id,
            source=source.source_id,
            instruments=[instrument_id],
            start_ts=first_ts,
            end_ts=last_ts,
            row_count=accepted_count,
            gaps=gaps,
            validation_counters=self._normalizer.all_counters(),
            columns=["quotes", "trades"],
        )
        manifest.content_sha256 = hash_directory(self._store.root)
        self._annotate(manifest, source)
        manifest.write(self._store.root)

        result_summary = IngestionResult(
            manifest=manifest,
            accepted=accepted_count,
            dropped=dropped_count,
            directory=self._store.root,
        )
        _log.info(
            "ingestion_complete",
            dataset_id=resolved_id,
            accepted=accepted_count,
            dropped=dropped_count,
            drop_rate=round(result_summary.drop_rate, 6),
            gaps=len(gaps),
            unexplained_gaps=len(manifest.unexplained_gaps),
        )
        return result_summary

    def _classify_gap(self, start: Nanos, end: Nanos) -> DataGap:
        """Attribute a quiet period to a closed venue, or record it as unexplained.

        A weekend must not be able to hide a feed outage, so the two are distinguished by
        the calendar rather than by their duration.
        """
        if self._calendar is None:
            return DataGap(start, end, "UNKNOWN")
        if not self._calendar.is_open(start + (end - start) // 2):
            return DataGap(start, end, "SESSION_CLOSED")
        return DataGap(start, end, "UNKNOWN")

    def _annotate(self, manifest: DatasetManifest, source: _Source) -> None:
        """Attach the warnings a reader of this dataset needs before trusting it."""
        if "SYNTH" in source.source_id.upper():
            manifest.add_note(
                "SYNTHETIC: generated data. It exercises the pipeline and supports no "
                "claim about expectancy."
            )
        if manifest.drop_rate > 0.01:
            manifest.add_note(
                f"HIGH_DROP_RATE: {manifest.drop_rate:.2%} of rows were rejected during "
                "normalisation. Check the source before drawing conclusions from it."
            )
        if manifest.unexplained_gaps:
            longest = max(g.duration_ns for g in manifest.unexplained_gaps)
            manifest.add_note(
                f"UNEXPLAINED_GAPS: {len(manifest.unexplained_gaps)} periods with no data "
                f"while the venue was open, the longest {longest / NS_PER_MIN:.1f} minutes."
            )
