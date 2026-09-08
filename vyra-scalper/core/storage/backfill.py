"""Back-fill the dataset index from the Parquet layer.

The cutover this supports is deliberately partial. Dataset *manifests* move into SQL so a
run can be traced to a fingerprint with a query instead of a directory walk; the Parquet
files themselves do not move, and stay the source of truth for both the data and its
content hash.

That is the whole point of the design: after the cutover, every existing dataset must still
read exactly as it did before, because nothing about how it is read has changed. The
migration adds an index; it does not take custody of anything.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from core.storage.sql_store import SqlStore
from core.util.clock import now_ns
from core.util.logging import get_logger
from data.storage.manifest import MANIFEST_FILENAME, DatasetManifest

__all__ = ["BackfillReport", "backfill_datasets"]

_log = get_logger("storage.backfill")


class BackfillReport:
    """What the back-fill did, and what it refused to do."""

    __slots__ = ("failed", "imported", "skipped")

    def __init__(self) -> None:
        self.imported: list[str] = []
        self.skipped: list[tuple[str, str]] = []
        self.failed: list[tuple[str, str]] = []

    def to_dict(self) -> dict[str, Any]:
        return {
            "imported": list(self.imported),
            "skipped": [{"path": p, "reason": r} for p, r in self.skipped],
            "failed": [{"path": p, "reason": r} for p, r in self.failed],
            "imported_count": len(self.imported),
            "skipped_count": len(self.skipped),
            "failed_count": len(self.failed),
        }


def backfill_datasets(
    root: str | Path, store: SqlStore, verify_content: bool = False
) -> BackfillReport:
    """Index every dataset manifest under ``root``.

    Args:
        root: a directory containing dataset directories, each with a manifest.
        store: the destination index.
        verify_content: re-hash each dataset and compare against its manifest before
            indexing. Off by default because hashing a large archive is expensive; on for
            a cutover, where the cost is the point — an index entry pointing at data that
            has changed under it is worse than no entry.

    A dataset that fails verification is **recorded as failed and not indexed**. Indexing it
    anyway would put a fingerprint in the database that does not describe the files, which
    is precisely the confusion the fingerprint exists to prevent.
    """
    report = BackfillReport()
    root_path = Path(root)
    if not root_path.is_dir():
        raise FileNotFoundError(f"dataset root {root_path} does not exist")

    for manifest_path in sorted(root_path.rglob(MANIFEST_FILENAME)):
        directory = manifest_path.parent
        try:
            manifest = DatasetManifest.read(directory)
        except Exception as exc:
            report.failed.append((str(directory), f"unreadable manifest: {exc}"))
            continue

        if verify_content:
            try:
                if not manifest.verify(directory):
                    report.failed.append(
                        (str(directory), "content hash does not match the manifest")
                    )
                    continue
            except Exception as exc:
                report.failed.append((str(directory), f"verification failed: {exc}"))
                continue

        try:
            store.upsert_dataset(
                {
                    "dataset_id": manifest.dataset_id,
                    "source": manifest.source,
                    "instruments": list(manifest.instruments),
                    "start_ts": manifest.start_ts,
                    "end_ts": manifest.end_ts,
                    "row_count": manifest.row_count,
                    "content_sha256": manifest.content_sha256,
                    "notes": list(manifest.notes),
                    "gap_count": len(manifest.gaps),
                    "location": str(directory),
                    "imported_at_ns": now_ns(),
                }
            )
        except Exception as exc:
            report.failed.append((str(directory), f"index write failed: {exc}"))
            continue
        report.imported.append(manifest.dataset_id)

    _log.info(
        "dataset_backfill_complete",
        imported=len(report.imported),
        skipped=len(report.skipped),
        failed=len(report.failed),
        verified=verify_content,
    )
    return report
