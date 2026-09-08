"""CSV tick and bar sources.

Column names are declared in configuration, never guessed.  A guessed column mapping is a
silent data corruption: reading the ``ask`` column as ``bid`` produces a plausible-looking
backtest with inverted spreads.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path

from core.events import Aggressor, BarEvent, QuoteEvent, Timeframe, TradeEvent
from core.instruments.instrument import Instrument
from core.util.clock import Nanos, from_iso
from core.util.ids import content_hash
from data.collectors.base import DataSourceError

__all__ = ["CsvBarSource", "CsvColumnMap", "CsvTickSource"]


@dataclass(frozen=True, slots=True)
class CsvColumnMap:
    """Maps CSV headers onto the canonical schema.

    ``timestamp_format`` is either ``iso``, ``epoch_ns``, ``epoch_us``, ``epoch_ms`` or
    ``epoch_s``.  Naming it explicitly avoids the usual failure where a file of epoch
    milliseconds is read as seconds and the backtest silently runs in 1970.
    """

    timestamp: str = "timestamp"
    timestamp_format: str = "iso"
    bid: str = "bid"
    ask: str = "ask"
    bid_size: str = "bid_size"
    ask_size: str = "ask_size"
    price: str = "price"
    size: str = "size"
    aggressor: str = "aggressor"
    open: str = "open"
    high: str = "high"
    low: str = "low"
    close: str = "close"
    volume: str = "volume"
    ts_exchange: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def parse_ts(self, raw: str) -> Nanos:
        fmt = self.timestamp_format
        if fmt == "iso":
            return from_iso(raw)
        try:
            value = int(float(raw))
        except ValueError as exc:
            raise DataSourceError(f"cannot parse timestamp {raw!r} as {fmt}") from exc
        scale = {"epoch_ns": 1, "epoch_us": 1_000, "epoch_ms": 1_000_000, "epoch_s": 1_000_000_000}
        if fmt not in scale:
            raise DataSourceError(
                f"unknown timestamp_format {fmt!r}; expected iso or one of {sorted(scale)}"
            )
        return value * scale[fmt]


def _file_fingerprint(paths: list[Path]) -> str:
    """SHA-256 over the contents of every file, so a data change changes the manifest."""
    digest = sha256()
    for path in sorted(paths):
        digest.update(path.name.encode())
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    return "sha256:" + digest.hexdigest()


class _CsvBase:
    __slots__ = ("_columns", "_instrument", "_paths")

    def __init__(self, instrument: Instrument, paths: list[str | Path], columns: CsvColumnMap):
        resolved = [Path(p) for p in paths]
        missing = [str(p) for p in resolved if not p.is_file()]
        if missing:
            raise DataSourceError(f"CSV files not found: {', '.join(missing)}")
        if not resolved:
            raise DataSourceError("no CSV files supplied")
        self._instrument = instrument
        self._paths = resolved
        self._columns = columns

    @property
    def instruments(self) -> tuple[str, ...]:
        return (self._instrument.instrument_id,)

    def content_fingerprint(self) -> str:
        return content_hash(
            {
                "source": type(self).__name__,
                "instrument": self._instrument.instrument_id,
                "files": _file_fingerprint(self._paths),
            }
        )

    def _require(self, row: dict[str, str], column: str, path: Path) -> str:
        value = row.get(column)
        if value is None or value == "":
            raise DataSourceError(
                f"{path.name}: required column {column!r} is missing or empty; "
                f"available columns: {', '.join(sorted(row))}"
            )
        return value


class CsvTickSource(_CsvBase):
    """Reads quote and trade rows from CSV.

    A row is a quote when it carries bid/ask columns and a trade when it carries
    price/size.  Rows carrying both produce a quote followed by a trade, in that order,
    because the quote is the state the trade executed against.
    """

    __slots__ = ("_source_id",)

    def __init__(
        self,
        instrument: Instrument,
        paths: list[str | Path],
        columns: CsvColumnMap | None = None,
        source_id: str | None = None,
    ) -> None:
        super().__init__(instrument, paths, columns or CsvColumnMap())
        self._source_id = source_id or f"CSV:{instrument.instrument_id}"

    @property
    def source_id(self) -> str:
        return self._source_id

    def events(self, start_ns: Nanos, end_ns: Nanos) -> Iterator[QuoteEvent | TradeEvent]:
        if end_ns <= start_ns:
            raise ValueError(f"end_ns ({end_ns}) must be after start_ns ({start_ns})")
        cols = self._columns
        sequence = 0
        inst = self._instrument

        for path in sorted(self._paths):
            with path.open(newline="") as handle:
                for line_no, row in enumerate(csv.DictReader(handle), start=2):
                    ts = cols.parse_ts(self._require(row, cols.timestamp, path))
                    if ts < start_ns:
                        continue
                    if ts >= end_ns:
                        break
                    ts_exchange = (
                        cols.parse_ts(row[cols.ts_exchange])
                        if cols.ts_exchange and row.get(cols.ts_exchange)
                        else ts
                    )
                    try:
                        if row.get(cols.bid) not in (None, ""):
                            sequence += 1
                            yield QuoteEvent(
                                instrument_id=inst.instrument_id,
                                exchange=inst.exchange,
                                ts_exchange=ts_exchange,
                                ts_receive=ts,
                                ts_processed=ts,
                                sequence_id=sequence,
                                source=self._source_id,
                                bid=float(row[cols.bid]),
                                ask=float(self._require(row, cols.ask, path)),
                                bid_size=float(row.get(cols.bid_size) or 0.0),
                                ask_size=float(row.get(cols.ask_size) or 0.0),
                            )
                        if row.get(cols.price) not in (None, ""):
                            raw_aggressor = (row.get(cols.aggressor) or "UNKNOWN").upper()
                            sequence += 1
                            yield TradeEvent(
                                instrument_id=inst.instrument_id,
                                exchange=inst.exchange,
                                ts_exchange=ts_exchange,
                                ts_receive=ts,
                                ts_processed=ts,
                                sequence_id=sequence,
                                source=self._source_id,
                                price=float(row[cols.price]),
                                size=float(row.get(cols.size) or 0.0),
                                aggressor=(
                                    Aggressor(raw_aggressor)
                                    if raw_aggressor in Aggressor.__members__
                                    else Aggressor.UNKNOWN
                                ),
                            )
                    except ValueError as exc:
                        raise DataSourceError(f"{path.name}:{line_no}: {exc}") from exc


class CsvBarSource(_CsvBase):
    """Reads pre-aggregated OHLCV bars from CSV.

    Bars read from a file are marked ``is_closed=True``: a stored bar is by definition
    complete.  ``ts_close`` is derived from the timeframe, and the row timestamp is taken
    as the bar's **open**, which is the near-universal convention — stating it here means
    a file using close-stamps is a configuration error rather than a one-bar look-ahead.
    """

    __slots__ = ("_source_id", "_timeframe")

    def __init__(
        self,
        instrument: Instrument,
        paths: list[str | Path],
        timeframe: Timeframe,
        columns: CsvColumnMap | None = None,
        source_id: str | None = None,
    ) -> None:
        super().__init__(instrument, paths, columns or CsvColumnMap())
        self._timeframe = timeframe
        self._source_id = source_id or f"CSV_BARS:{instrument.instrument_id}:{timeframe.value}"

    @property
    def source_id(self) -> str:
        return self._source_id

    def events(self, start_ns: Nanos, end_ns: Nanos) -> Iterator[BarEvent]:
        if end_ns <= start_ns:
            raise ValueError(f"end_ns ({end_ns}) must be after start_ns ({start_ns})")
        cols = self._columns
        inst = self._instrument
        sequence = 0

        for path in sorted(self._paths):
            with path.open(newline="") as handle:
                for line_no, row in enumerate(csv.DictReader(handle), start=2):
                    ts_open = cols.parse_ts(self._require(row, cols.timestamp, path))
                    if ts_open < start_ns:
                        continue
                    if ts_open >= end_ns:
                        break
                    ts_close = ts_open + self._timeframe.ns
                    sequence += 1
                    try:
                        yield BarEvent(
                            instrument_id=inst.instrument_id,
                            exchange=inst.exchange,
                            ts_exchange=ts_open,
                            ts_receive=ts_close,
                            ts_processed=ts_close,
                            sequence_id=sequence,
                            source=self._source_id,
                            timeframe=self._timeframe,
                            ts_open=ts_open,
                            ts_close=ts_close,
                            open=float(self._require(row, cols.open, path)),
                            high=float(self._require(row, cols.high, path)),
                            low=float(self._require(row, cols.low, path)),
                            close=float(self._require(row, cols.close, path)),
                            volume=float(row.get(cols.volume) or 0.0),
                            is_closed=True,
                        )
                    except ValueError as exc:
                        raise DataSourceError(f"{path.name}:{line_no}: {exc}") from exc
