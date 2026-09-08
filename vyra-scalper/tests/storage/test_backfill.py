"""The cutover: dataset manifests into SQL, with the Parquet layer untouched.

The migration is deliberately partial, and the tests are written around that. Manifests move
into the database so a run can be traced to a fingerprint with a query. The Parquet files do
not move and stay the source of truth for the data and its content hash.

Which makes the important test the boring-sounding one: **old data still reads correctly
after the cutover**. A migration that indexed everything and quietly broke the reader would
pass every test about the index.
"""

from __future__ import annotations

import os

import pytest

from core.storage.backfill import backfill_datasets
from core.storage.sql_store import SqlStore

pytest.importorskip("pyarrow", reason="pyarrow is required for the Parquet layer")

from data.collectors.parquet_source import ParquetSource
from data.normalization.pipeline import IngestionPipeline

pytestmark = pytest.mark.skipif(
    not os.environ.get("VYRA_TEST_PG_DSN"), reason="VYRA_TEST_PG_DSN is not set"
)


@pytest.fixture
def dataset(tmp_path, registry, config_bundle):
    """A real ingested dataset: synthetic ticks through the real pipeline into Parquet."""
    from core.util.clock import from_iso
    from data.collectors.synthetic import SyntheticConfig, SyntheticTickSource

    instrument = registry.get("CME:MES")
    calendar = registry.calendar("CME:MES")
    root = tmp_path / "store" / "mes"
    pipeline = IngestionPipeline(instrument, root, calendar)
    source = SyntheticTickSource(instrument, SyntheticConfig(seed=11), calendar)
    result = pipeline.ingest(
        source,
        from_iso("2024-03-04T14:30:00Z"),
        from_iso("2024-03-04T15:00:00Z"),
        dataset_id="mes-2024-03-04",
    )
    return root, result.manifest


def test_manifests_are_indexed_with_their_fingerprint(
    store: SqlStore, dataset, tmp_path
) -> None:
    _root, manifest = dataset
    report = backfill_datasets(tmp_path / "store", store, verify_content=True)

    assert report.failed == [], report.to_dict()
    assert manifest.dataset_id in report.imported

    rows = {row["dataset_id"]: row for row in store.read_datasets()}
    indexed = rows[manifest.dataset_id]
    assert indexed["content_sha256"] == manifest.content_sha256, (
        "the index must copy the fingerprint, never recompute a different one"
    )
    assert indexed["row_count"] == manifest.row_count
    assert indexed["instruments"] == list(manifest.instruments)


def test_old_data_still_reads_after_the_cutover(store: SqlStore, dataset, tmp_path, registry) -> None:
    """The test the migration exists to keep true.

    Reading is unchanged because nothing about reading changed: the index is an index.
    """
    root, manifest = dataset
    window = (manifest.start_ts, manifest.end_ts)
    before = list(
        ParquetSource(instrument=registry.get("CME:MES"), root=root).events(*window)
    )

    backfill_datasets(tmp_path / "store", store, verify_content=True)

    after = list(
        ParquetSource(
            instrument=registry.get("CME:MES"), root=root, verify_content=True
        ).events(*window)
    )
    assert len(after) == len(before) > 0
    assert [e.ts_processed for e in after] == [e.ts_processed for e in before]


def test_a_dataset_that_fails_verification_is_not_indexed(
    store: SqlStore, dataset, tmp_path
) -> None:
    """An index entry pointing at data that changed under it is worse than no entry."""
    root, _manifest = dataset
    partitions = sorted(p for p in root.rglob("*.parquet"))
    assert partitions, "the fixture produced no parquet files"
    partitions[0].write_bytes(b"corrupted")

    report = backfill_datasets(tmp_path / "store", store, verify_content=True)

    assert report.imported == []
    assert len(report.failed) == 1
    assert "content hash" in report.failed[0][1]
    assert store.read_datasets() == []


def test_the_backfill_is_idempotent(store: SqlStore, dataset, tmp_path) -> None:
    """It runs on every cutover rehearsal, and on the real one after those."""
    backfill_datasets(tmp_path / "store", store)
    backfill_datasets(tmp_path / "store", store)
    assert len(store.read_datasets()) == 1


def test_an_unreadable_manifest_is_reported_not_skipped_silently(
    store: SqlStore, tmp_path
) -> None:
    broken = tmp_path / "store" / "broken"
    broken.mkdir(parents=True)
    (broken / "_manifest.json").write_text("{not json")

    report = backfill_datasets(tmp_path / "store", store)
    assert report.imported == []
    assert len(report.failed) == 1
    assert "unreadable manifest" in report.failed[0][1]


def test_a_missing_root_raises_rather_than_reporting_success(store: SqlStore, tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        backfill_datasets(tmp_path / "nowhere", store)
