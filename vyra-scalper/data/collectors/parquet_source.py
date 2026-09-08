"""Reads the normalised Parquet layer as an event stream.

The dataset's manifest is the source of truth for provenance: this source refuses to open
a directory without one, and its fingerprint is the manifest's content hash, so a backtest
over changed data gets a different hash and cannot be confused with an earlier result.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from core.events import Event
from core.instruments.instrument import Instrument
from core.util.clock import Nanos, to_iso
from core.util.logging import get_logger
from data.collectors.base import DataSourceError
from data.storage.manifest import DatasetManifest
from data.storage.parquet_store import ParquetStore

__all__ = ["ParquetSource"]

_log = get_logger("data.collectors.parquet")


class ParquetSource:
    """A :class:`~data.collectors.base.DataSource` over a normalised dataset.

    Args:
        instrument: the instrument to read. Must be one the dataset covers.
        root: the dataset directory, containing ``_manifest.json``.
        verify_content: re-hash the files and compare against the manifest before reading.
            Off by default because hashing a multi-gigabyte archive on every run is
            expensive; on for a promotion run, where the cost is worth the certainty.
    """

    __slots__ = ("_instrument", "_manifest", "_root", "_store", "_verified")

    def __init__(
        self,
        instrument: Instrument,
        root: str | Path,
        verify_content: bool = False,
    ) -> None:
        self._root = Path(root)
        self._instrument = instrument
        try:
            self._manifest = DatasetManifest.read(self._root)
        except FileNotFoundError as exc:
            raise DataSourceError(str(exc)) from exc

        if instrument.instrument_id not in self._manifest.instruments:
            raise DataSourceError(
                f"dataset {self._manifest.dataset_id!r} covers "
                f"{self._manifest.instruments}, not {instrument.instrument_id!r}"
            )

        self._store = ParquetStore(self._root, instrument.timezone)
        self._verified = True
        if verify_content and not self._manifest.verify(self._root):
            raise DataSourceError(
                f"dataset {self._manifest.dataset_id!r} no longer matches the content hash "
                "in its manifest. Results referencing it are not reproducible; re-ingest "
                "it before use."
            )

    @property
    def source_id(self) -> str:
        return f"PARQUET:{self._manifest.dataset_id}"

    @property
    def instruments(self) -> tuple[str, ...]:
        return (self._instrument.instrument_id,)

    @property
    def manifest(self) -> DatasetManifest:
        """The dataset's provenance. Carried into the run manifest by the runner."""
        return self._manifest

    def content_fingerprint(self) -> str:
        return self._manifest.content_sha256

    def events(self, start_ns: Nanos, end_ns: Nanos) -> Iterator[Event]:
        """Yield events in ``[start_ns, end_ns)``.

        Raises:
            DataSourceError: if the range is empty or lies wholly outside the dataset. A
                backtest over a window the data does not cover would report zero trades
                and no error, which reads as "the strategy did nothing" rather than "the
                data was not there".
        """
        if end_ns <= start_ns:
            raise DataSourceError(
                f"empty range: {to_iso(start_ns)} to {to_iso(end_ns)}"
            )
        if end_ns <= self._manifest.start_ts or start_ns >= self._manifest.end_ts:
            raise DataSourceError(
                f"requested {to_iso(start_ns)}..{to_iso(end_ns)} but dataset "
                f"{self._manifest.dataset_id!r} covers "
                f"{to_iso(self._manifest.start_ts)}..{to_iso(self._manifest.end_ts)}"
            )
        if start_ns < self._manifest.start_ts or end_ns > self._manifest.end_ts:
            _log.warning(
                "requested_range_exceeds_dataset",
                dataset_id=self._manifest.dataset_id,
                requested=f"{to_iso(start_ns)}..{to_iso(end_ns)}",
                available=f"{to_iso(self._manifest.start_ts)}..{to_iso(self._manifest.end_ts)}",
                detail="only the overlapping portion will be read",
            )

        yield from self._store.read_events(
            self._instrument, start_ns, end_ns, self.source_id
        )
