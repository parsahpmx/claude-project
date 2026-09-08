"""Parquet storage for the normalised layer.

Partitioned ``instrument/date`` (``DATA_SPEC.md`` §8). Parquet because a tick archive is
columnar and mostly read one column at a time; partitioned by date because a backtest asks
for a range, not for everything.

``pyarrow`` is an optional dependency: the engine core runs without it, and only this
module and the research tooling need it. The import error names the extra to install
rather than surfacing as a bare ``ModuleNotFoundError`` from deep inside a read.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

from core.events import Aggressor, Event, QuoteEvent, TradeEvent
from core.instruments.instrument import Instrument
from core.util.clock import Nanos, local_date
from core.util.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - typing only
    import pyarrow as pa

__all__ = [
    "PARQUET_EXTRA",
    "QUOTE_COLUMNS",
    "TRADE_COLUMNS",
    "ParquetStore",
    "require_pyarrow",
]

_log = get_logger("data.storage.parquet")

PARQUET_EXTRA = 'pip install -e ".[data]"'

# The normalised schema. Column order is fixed so a file written by one version reads
# identically in another; adding a column requires a schema_version bump in the manifest.
QUOTE_COLUMNS: tuple[str, ...] = (
    "ts_exchange", "ts_receive", "ts_processed", "sequence_id",
    "bid", "ask", "bid_size", "ask_size", "flags",
)
TRADE_COLUMNS: tuple[str, ...] = (
    "ts_exchange", "ts_receive", "ts_processed", "sequence_id",
    "price", "size", "aggressor", "flags",
)


def require_pyarrow() -> Any:
    """Import pyarrow, or raise with the command that installs it."""
    try:
        import pyarrow
    except ImportError as exc:  # pragma: no cover - environment-dependent
        raise ImportError(
            "Parquet storage requires pyarrow, which is an optional dependency so the "
            f"engine core stays free of it. Install with: {PARQUET_EXTRA}"
        ) from exc
    return pyarrow


class ParquetStore:
    """Reads and writes normalised events, partitioned ``instrument/date``.

    Args:
        root: the dataset directory. Its ``_manifest.json`` is written by the ingestion
            script, not here — this class moves bytes, provenance is recorded once.
        timezone: the timezone whose calendar dates partition the data. Defaults to UTC;
            pass the instrument's exchange timezone so a partition matches a trading day
            rather than straddling two.
    """

    __slots__ = ("_root", "_timezone")

    def __init__(self, root: str | Path, timezone: str = "UTC") -> None:
        self._root = Path(root)
        self._timezone = timezone

    @property
    def root(self) -> Path:
        return self._root

    def partition_path(self, instrument_id: str, day: date, kind: str) -> Path:
        """Where one instrument-day of one event kind lives.

        The instrument id contains a colon (``CME:MES``), which is not a legal path
        character on every filesystem, so it is replaced with an underscore. The mapping is
        one-way by design: the canonical id is recorded in the manifest, and the directory
        name is a label, not an identifier.
        """
        safe = instrument_id.replace(":", "_").replace("/", "_")
        return self._root / safe / day.isoformat() / f"{kind}.parquet"

    # -- writing ------------------------------------------------------------------------

    def write_events(
        self, instrument: Instrument, events: Sequence[Event]
    ) -> dict[str, int]:
        """Write quotes and trades, partitioned by trading date.

        Returns per-kind row counts. Events are grouped by date before writing, so one
        call can span days without producing a file per event.
        """
        pa = require_pyarrow()
        import pyarrow.parquet as pq

        quotes: dict[date, list[QuoteEvent]] = {}
        trades: dict[date, list[TradeEvent]] = {}
        for event in events:
            day = local_date(event.ts, self._timezone)
            if isinstance(event, QuoteEvent):
                quotes.setdefault(day, []).append(event)
            elif isinstance(event, TradeEvent):
                trades.setdefault(day, []).append(event)

        counts = {"quotes": 0, "trades": 0}
        for day, quote_batch in sorted(quotes.items()):
            path = self.partition_path(instrument.instrument_id, day, "quotes")
            path.parent.mkdir(parents=True, exist_ok=True)
            pq.write_table(self._quote_table(pa, quote_batch), path, compression="zstd")
            counts["quotes"] += len(quote_batch)
        for day, trade_batch in sorted(trades.items()):
            path = self.partition_path(instrument.instrument_id, day, "trades")
            path.parent.mkdir(parents=True, exist_ok=True)
            pq.write_table(self._trade_table(pa, trade_batch), path, compression="zstd")
            counts["trades"] += len(trade_batch)

        _log.info(
            "parquet_written",
            instrument=instrument.instrument_id,
            quotes=counts["quotes"],
            trades=counts["trades"],
            days=len(set(quotes) | set(trades)),
        )
        return counts

    @staticmethod
    def _quote_table(pa: Any, events: Sequence[QuoteEvent]) -> pa.Table:
        return pa.table(
            {
                "ts_exchange": pa.array([e.ts_exchange for e in events], pa.int64()),
                "ts_receive": pa.array([e.ts_receive for e in events], pa.int64()),
                "ts_processed": pa.array([e.ts_processed for e in events], pa.int64()),
                "sequence_id": pa.array([e.sequence_id for e in events], pa.int64()),
                "bid": pa.array([e.bid for e in events], pa.float64()),
                "ask": pa.array([e.ask for e in events], pa.float64()),
                "bid_size": pa.array([e.bid_size for e in events], pa.float64()),
                "ask_size": pa.array([e.ask_size for e in events], pa.float64()),
                "flags": pa.array(
                    [",".join(f.value for f in e.flags) for e in events], pa.string()
                ),
            }
        )

    @staticmethod
    def _trade_table(pa: Any, events: Sequence[TradeEvent]) -> pa.Table:
        return pa.table(
            {
                "ts_exchange": pa.array([e.ts_exchange for e in events], pa.int64()),
                "ts_receive": pa.array([e.ts_receive for e in events], pa.int64()),
                "ts_processed": pa.array([e.ts_processed for e in events], pa.int64()),
                "sequence_id": pa.array([e.sequence_id for e in events], pa.int64()),
                "price": pa.array([e.price for e in events], pa.float64()),
                "size": pa.array([e.size for e in events], pa.float64()),
                "aggressor": pa.array([e.aggressor.value for e in events], pa.string()),
                "flags": pa.array(
                    [",".join(f.value for f in e.flags) for e in events], pa.string()
                ),
            }
        )

    # -- reading ------------------------------------------------------------------------

    def available_dates(self, instrument_id: str) -> list[date]:
        """Dates with data on disk, in order."""
        safe = instrument_id.replace(":", "_").replace("/", "_")
        directory = self._root / safe
        if not directory.is_dir():
            return []
        days: list[date] = []
        for child in directory.iterdir():
            if not child.is_dir():
                continue
            try:
                days.append(date.fromisoformat(child.name))
            except ValueError:
                _log.warning(
                    "unexpected_partition_name", instrument=instrument_id, name=child.name
                )
        return sorted(days)

    def read_events(
        self, instrument: Instrument, start_ns: Nanos, end_ns: Nanos, source: str
    ) -> Iterator[Event]:
        """Yield quotes and trades in ``[start_ns, end_ns)``, in timestamp order.

        Only the partitions covering the range are opened, and each is merged in memory —
        one trading day of ticks is large but bounded, whereas sorting the whole dataset
        is not.
        """
        require_pyarrow()
        import pyarrow.parquet as pq

        start_day = local_date(start_ns, self._timezone)
        end_day = local_date(max(start_ns, end_ns - 1), self._timezone)

        for day in self.available_dates(instrument.instrument_id):
            if day < start_day or day > end_day:
                continue
            batch: list[Event] = []
            for kind in ("quotes", "trades"):
                path = self.partition_path(instrument.instrument_id, day, kind)
                if not path.is_file():
                    continue
                table = pq.read_table(path)
                batch.extend(
                    self._to_events(table.to_pylist(), instrument, kind, source)
                )
            # Sorted on (ts, sequence_id) so ordering is total and a replay is identical.
            batch.sort(key=lambda e: (e.ts, e.sequence_id))
            for event in batch:
                if start_ns <= event.ts < end_ns:
                    yield event

    @staticmethod
    def _to_events(
        rows: list[dict[str, Any]], instrument: Instrument, kind: str, source: str
    ) -> Iterator[Event]:
        for row in rows:
            if kind == "quotes":
                yield QuoteEvent(
                    instrument_id=instrument.instrument_id,
                    exchange=instrument.exchange,
                    ts_exchange=int(row["ts_exchange"]),
                    ts_receive=int(row["ts_receive"]),
                    ts_processed=int(row["ts_processed"]),
                    sequence_id=int(row["sequence_id"]),
                    source=source,
                    bid=float(row["bid"]),
                    ask=float(row["ask"]),
                    bid_size=float(row["bid_size"]),
                    ask_size=float(row["ask_size"]),
                )
            else:
                raw = str(row.get("aggressor") or Aggressor.UNKNOWN.value)
                yield TradeEvent(
                    instrument_id=instrument.instrument_id,
                    exchange=instrument.exchange,
                    ts_exchange=int(row["ts_exchange"]),
                    ts_receive=int(row["ts_receive"]),
                    ts_processed=int(row["ts_processed"]),
                    sequence_id=int(row["sequence_id"]),
                    source=source,
                    price=float(row["price"]),
                    size=float(row["size"]),
                    aggressor=(
                        Aggressor(raw) if raw in Aggressor.__members__ else Aggressor.UNKNOWN
                    ),
                )

    def row_count(self, instrument_id: str) -> int:
        """Total rows on disk for an instrument, without loading them."""
        require_pyarrow()
        import pyarrow.parquet as pq

        total = 0
        for day in self.available_dates(instrument_id):
            for kind in ("quotes", "trades"):
                path = self.partition_path(instrument_id, day, kind)
                if path.is_file():
                    total += pq.ParquetFile(path).metadata.num_rows
        return total
