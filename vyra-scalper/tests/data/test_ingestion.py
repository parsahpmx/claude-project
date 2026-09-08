"""The ingestion pipeline and the normalised Parquet layer.

The properties under test are the ones that make a dataset trustworthy: provenance
survives, rejected rows are counted rather than hidden, gaps are attributed rather than
absorbed, and a change to the bytes is detectable.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.events import QuoteEvent, TradeEvent
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry
from core.util.clock import NS_PER_MIN, from_iso
from data.collectors.base import DataSourceError
from data.collectors.parquet_source import ParquetSource
from data.collectors.synthetic import SyntheticConfig, SyntheticTickSource
from data.normalization.pipeline import IngestionPipeline
from data.storage.manifest import DataGap, DatasetManifest, hash_directory
from data.storage.parquet_store import ParquetStore

pytest.importorskip("pyarrow", reason="Parquet storage needs the [data] extra")

START = from_iso("2024-03-05T14:00:00Z")
END = from_iso("2024-03-05T15:00:00Z")


@pytest.fixture
def dataset(tmp_path: Path, registry: InstrumentRegistry, mes: Instrument):
    """A small ingested dataset, built through the real pipeline."""
    pipeline = IngestionPipeline(mes, tmp_path / "ds", registry.calendar("CME:MES"))
    source = SyntheticTickSource(mes, SyntheticConfig(seed=11), registry.calendar("CME:MES"))
    result = pipeline.ingest(source, START, END, dataset_id="test_ds")
    return result, tmp_path / "ds"


class TestManifest:
    def test_a_manifest_is_written_with_provenance(self, dataset) -> None:
        _result, directory = dataset
        manifest = DatasetManifest.read(directory)
        assert manifest.dataset_id == "test_ds"
        assert manifest.instruments == ["CME:MES"]
        assert manifest.row_count > 0
        assert manifest.content_sha256.startswith("sha256:")

    def test_synthetic_data_is_watermarked_in_the_manifest(self, dataset) -> None:
        """No expectancy claim may be made from generated data, whatever the format."""
        result, _ = dataset
        assert any("SYNTHETIC" in note for note in result.manifest.notes)

    def test_the_content_hash_detects_a_change(self, dataset) -> None:
        _result, directory = dataset
        manifest = DatasetManifest.read(directory)
        assert manifest.verify(directory)

        target = next(directory.rglob("*.parquet"))
        target.write_bytes(target.read_bytes() + b"tampered")
        assert not manifest.verify(directory)

    def test_a_dataset_without_a_manifest_is_refused(self, tmp_path: Path) -> None:
        """A dataset with no provenance produces a backtest whose inputs are unidentifiable."""
        empty = tmp_path / "no_manifest"
        empty.mkdir()
        with pytest.raises(FileNotFoundError, match="no provenance"):
            DatasetManifest.read(empty)

    def test_an_inverted_range_is_refused(self) -> None:
        with pytest.raises(ValueError, match="precedes start_ts"):
            DatasetManifest("d", "s", ["X"], start_ts=100, end_ts=50)


class TestValidationCounters:
    def test_rejected_rows_are_counted_not_hidden(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        pipeline = IngestionPipeline(mes, tmp_path / "ds", registry.calendar("CME:MES"))
        source = SyntheticTickSource(mes, SyntheticConfig(seed=3), registry.calendar("CME:MES"))
        result = pipeline.ingest(source, START, END)
        counters = result.manifest.validation_counters["CME:MES"]
        assert counters["accepted"] > 0
        assert "drop_rate" in counters

    def test_a_high_drop_rate_is_flagged_in_the_manifest(self) -> None:
        manifest = DatasetManifest(
            "d", "CSV:vendor", ["X"], 1, 2,
            validation_counters={"X": {"accepted": 900, "dropped": 100}},
        )
        assert manifest.drop_rate == pytest.approx(0.1)


class TestGapAttribution:
    def test_a_closed_venue_is_recorded_with_a_reason(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        """A weekend must not be able to hide a feed outage."""
        pipeline = IngestionPipeline(mes, tmp_path / "ds", registry.calendar("CME:MES"))
        source = SyntheticTickSource(mes, SyntheticConfig(seed=5), registry.calendar("CME:MES"))
        result = pipeline.ingest(
            source,
            from_iso("2024-03-08T20:00:00Z"),   # Friday afternoon
            from_iso("2024-03-11T02:00:00Z"),   # through the weekend into Monday
        )
        assert result.manifest.gaps
        assert all(g.reason == "SESSION_CLOSED" for g in result.manifest.gaps)
        assert not result.manifest.unexplained_gaps

    def test_an_unexplained_gap_is_distinguished(self) -> None:
        explained = DataGap(1, 2, "SESSION_CLOSED")
        unexplained = DataGap(3, 4)
        assert explained.is_explained
        assert not unexplained.is_explained

    def test_a_gap_is_recorded_but_no_rows_are_invented(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        """The manifest records the absence; the data does not invent a value.

        A weekend ingest spans roughly 65 hours of wall clock but contains only the open
        sessions. If the pipeline filled the gap, the row count would reflect the whole
        span rather than the traded part of it.
        """
        pipeline = IngestionPipeline(mes, tmp_path / "ds", registry.calendar("CME:MES"))
        source = SyntheticTickSource(mes, SyntheticConfig(seed=5), registry.calendar("CME:MES"))
        friday = from_iso("2024-03-08T20:00:00Z")
        monday = from_iso("2024-03-11T02:00:00Z")
        result = pipeline.ingest(source, friday, monday)

        assert result.manifest.gaps, "the weekend was not recorded as a gap"
        gap = result.manifest.gaps[0]

        # Nothing was written inside the gap.
        store = ParquetStore(tmp_path / "ds", mes.timezone)
        inside = list(
            store.read_events(mes, gap.start_ts + NS_PER_MIN, gap.end_ts - NS_PER_MIN, "T")
        )
        assert inside == [], f"{len(inside)} rows were invented inside a recorded gap"


class TestProvenanceSurvivesStorage:
    def test_a_run_over_a_synthetic_dataset_is_still_watermarked(
        self, dataset, tmp_path: Path, mes: Instrument
    ) -> None:
        """The source id becomes PARQUET:<id>, but the data is still generated.

        Without this the substring check in RunManifest stops seeing "SYNTH" and the
        watermark is lost at the storage boundary — a report that supports no expectancy
        claim would stop saying so.
        """
        import shutil

        import yaml

        from core.backtest.runner import run_backtest

        result, directory = dataset
        assert any("SYNTHETIC" in note for note in result.manifest.notes)

        configs = tmp_path / "configs"
        shutil.copytree(Path(__file__).resolve().parents[2] / "configs", configs)
        backtest = yaml.safe_load((configs / "backtest.yaml").read_text())
        backtest["data"]["source"] = "PARQUET"
        backtest["data"]["parquet"] = {"root": str(directory), "verify_content": False}
        backtest["data"]["start"] = "2024-03-05T14:00:00Z"
        backtest["data"]["end"] = "2024-03-05T15:00:00Z"
        (configs / "backtest.yaml").write_text(yaml.safe_dump(backtest))

        run = run_backtest(
            configs, output_root=tmp_path / "runs", run_id="prov", write_outputs=False
        )
        assert any("SYNTHETIC" in w for w in run.warnings), (
            "the synthetic watermark was lost when the data went through Parquet"
        )
        assert run.manifest.dataset_fingerprint == result.manifest.content_sha256


class TestEmptyDataset:
    def test_a_source_producing_nothing_raises(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        """An empty dataset that looks successful reads as 'the strategy did nothing'."""
        pipeline = IngestionPipeline(mes, tmp_path / "ds", registry.calendar("CME:MES"))
        source = SyntheticTickSource(mes, SyntheticConfig(seed=1), registry.calendar("CME:MES"))
        with pytest.raises(ValueError, match="produced no usable events"):
            pipeline.ingest(
                source,
                from_iso("2024-03-09T10:00:00Z"),   # Saturday
                from_iso("2024-03-09T12:00:00Z"),
            )

    def test_an_inverted_range_is_refused(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        pipeline = IngestionPipeline(mes, tmp_path / "ds", registry.calendar("CME:MES"))
        source = SyntheticTickSource(mes, SyntheticConfig(seed=1), registry.calendar("CME:MES"))
        with pytest.raises(ValueError, match="empty range"):
            pipeline.ingest(source, END, START)


class TestParquetRoundTrip:
    def test_events_survive_the_round_trip(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        source = SyntheticTickSource(mes, SyntheticConfig(seed=7), registry.calendar("CME:MES"))
        original = list(source.events(START, END))
        store = ParquetStore(tmp_path / "raw", mes.timezone)
        store.write_events(mes, original)
        recovered = list(store.read_events(mes, START, END, "TEST"))

        assert len(recovered) == len(original)
        assert {(type(e).__name__, e.sequence_id) for e in recovered} == {
            (type(e).__name__, e.sequence_id) for e in original
        }

    def test_quote_values_are_preserved_exactly(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        source = SyntheticTickSource(mes, SyntheticConfig(seed=7), registry.calendar("CME:MES"))
        original = [e for e in source.events(START, END) if isinstance(e, QuoteEvent)]
        store = ParquetStore(tmp_path / "raw", mes.timezone)
        store.write_events(mes, original)
        recovered = [
            e for e in store.read_events(mes, START, END, "TEST") if isinstance(e, QuoteEvent)
        ]
        for before, after in zip(original[:50], recovered[:50], strict=False):
            assert (after.bid, after.ask, after.bid_size, after.ask_size) == (
                before.bid, before.ask, before.bid_size, before.ask_size
            )
            assert after.ts_exchange == before.ts_exchange

    def test_trade_aggressor_survives(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        """An aggressor lost in storage would silently zero out every delta feature."""
        source = SyntheticTickSource(mes, SyntheticConfig(seed=7), registry.calendar("CME:MES"))
        original = [e for e in source.events(START, END) if isinstance(e, TradeEvent)]
        store = ParquetStore(tmp_path / "raw", mes.timezone)
        store.write_events(mes, original)
        recovered = [
            e for e in store.read_events(mes, START, END, "TEST") if isinstance(e, TradeEvent)
        ]
        assert [e.aggressor for e in recovered[:50]] == [e.aggressor for e in original[:50]]

    def test_events_come_back_in_timestamp_order(
        self, tmp_path: Path, registry: InstrumentRegistry, mes: Instrument
    ) -> None:
        source = SyntheticTickSource(mes, SyntheticConfig(seed=7), registry.calendar("CME:MES"))
        store = ParquetStore(tmp_path / "raw", mes.timezone)
        store.write_events(mes, list(source.events(START, END)))
        stamps = [e.ts for e in store.read_events(mes, START, END, "TEST")]
        assert stamps == sorted(stamps)


class TestParquetSource:
    def test_it_reads_an_ingested_dataset(self, dataset, mes: Instrument) -> None:
        _, directory = dataset
        source = ParquetSource(mes, directory)
        events = list(source.events(START, END))
        assert events
        assert source.source_id.startswith("PARQUET:")

    def test_the_fingerprint_is_the_manifest_hash(self, dataset, mes: Instrument) -> None:
        result, directory = dataset
        source = ParquetSource(mes, directory)
        assert source.content_fingerprint() == result.manifest.content_sha256

    def test_content_verification_catches_tampering(self, dataset, mes: Instrument) -> None:
        _, directory = dataset
        target = next(directory.rglob("*.parquet"))
        target.write_bytes(target.read_bytes() + b"tampered")
        with pytest.raises(DataSourceError, match="no longer matches the content hash"):
            ParquetSource(mes, directory, verify_content=True)

    def test_a_wrong_instrument_is_refused(self, dataset, es: Instrument) -> None:
        _, directory = dataset
        with pytest.raises(DataSourceError, match="covers"):
            ParquetSource(es, directory)

    def test_a_range_outside_the_dataset_is_refused(self, dataset, mes: Instrument) -> None:
        """Zero trades over a window the data does not cover reads as 'no signal'."""
        _, directory = dataset
        source = ParquetSource(mes, directory)
        with pytest.raises(DataSourceError, match="but dataset"):
            list(source.events(from_iso("2025-01-01T00:00:00Z"), from_iso("2025-01-02T00:00:00Z")))

    def test_an_empty_range_is_refused(self, dataset, mes: Instrument) -> None:
        _, directory = dataset
        source = ParquetSource(mes, directory)
        with pytest.raises(DataSourceError, match="empty range"):
            list(source.events(END, START))

    def test_a_missing_manifest_is_refused(self, tmp_path: Path, mes: Instrument) -> None:
        empty = tmp_path / "bare"
        empty.mkdir()
        with pytest.raises(DataSourceError, match="no provenance"):
            ParquetSource(mes, empty)


class TestHashing:
    def test_the_manifest_is_excluded_from_its_own_hash(self, tmp_path: Path) -> None:
        directory = tmp_path / "ds"
        directory.mkdir()
        (directory / "part.parquet").write_bytes(b"data")
        before = hash_directory(directory)
        (directory / "_manifest.json").write_text("{}")
        assert hash_directory(directory) == before

    def test_renaming_a_partition_changes_the_hash(self, tmp_path: Path) -> None:
        """A partition moved to the wrong date is a different dataset."""
        directory = tmp_path / "ds"
        directory.mkdir()
        (directory / "a.parquet").write_bytes(b"data")
        before = hash_directory(directory)
        (directory / "a.parquet").rename(directory / "b.parquet")
        assert hash_directory(directory) != before
