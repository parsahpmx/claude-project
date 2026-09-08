"""Dataset manifests.

Every normalised dataset directory carries a ``_manifest.json`` (``DATA_SPEC.md`` §8). It
records what the data is, where it came from, how much of it was rejected, and a content
hash.

The hash is the point. A backtest manifest references it, so if the underlying data
changes the backtest's hash changes too — and an old result cannot be silently
re-attributed to new data. Without this, "the same backtest" means nothing.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from core.util.clock import Nanos, now_ns, to_iso
from core.util.logging import get_logger

__all__ = ["MANIFEST_FILENAME", "SCHEMA_VERSION", "DataGap", "DatasetManifest"]

_log = get_logger("data.storage.manifest")

MANIFEST_FILENAME = "_manifest.json"
SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class DataGap:
    """A period with no data. Recorded, never filled.

    ``reason`` distinguishes an expected absence (the venue was closed) from an unexplained
    one. Collapsing the two would let a feed outage hide behind a weekend.
    """

    start_ts: Nanos
    end_ts: Nanos
    reason: str = "UNKNOWN"

    @property
    def duration_ns(self) -> int:
        return max(0, self.end_ts - self.start_ts)

    @property
    def is_explained(self) -> bool:
        return self.reason not in ("UNKNOWN", "")

    def to_dict(self) -> dict[str, Any]:
        return {
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "start_iso": to_iso(self.start_ts),
            "end_iso": to_iso(self.end_ts),
            "duration_ns": self.duration_ns,
            "reason": self.reason,
            "is_explained": self.is_explained,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> DataGap:
        return cls(
            start_ts=int(payload["start_ts"]),
            end_ts=int(payload["end_ts"]),
            reason=str(payload.get("reason", "UNKNOWN")),
        )


@dataclass(slots=True)
class DatasetManifest:
    """Provenance for one normalised dataset."""

    dataset_id: str
    source: str
    instruments: list[str]
    start_ts: Nanos
    end_ts: Nanos
    row_count: int = 0
    schema_version: int = SCHEMA_VERSION
    content_sha256: str = ""
    created_at: str = ""
    generator_version: str = ""
    seed: int | None = None
    gaps: list[DataGap] = field(default_factory=list)
    validation_counters: dict[str, Any] = field(default_factory=dict)
    columns: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = to_iso(now_ns())
        if self.end_ts < self.start_ts:
            raise ValueError(
                f"dataset {self.dataset_id!r}: end_ts {self.end_ts} precedes start_ts "
                f"{self.start_ts}"
            )

    @property
    def fingerprint(self) -> str:
        """The value a backtest manifest references."""
        return self.content_sha256

    @property
    def unexplained_gaps(self) -> list[DataGap]:
        """Gaps with no recorded reason — the ones worth investigating."""
        return [g for g in self.gaps if not g.is_explained]

    @property
    def drop_rate(self) -> float:
        """Fraction of rows rejected during normalisation, across all instruments."""
        accepted = 0
        dropped = 0
        for counters in self.validation_counters.values():
            if isinstance(counters, dict):
                accepted += int(counters.get("accepted", 0))
                dropped += int(counters.get("dropped", 0))
        total = accepted + dropped
        return dropped / total if total else 0.0

    def add_note(self, note: str) -> None:
        if note not in self.notes:
            self.notes.append(note)

    def to_dict(self) -> dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "schema_version": self.schema_version,
            "source": self.source,
            "instruments": list(self.instruments),
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "start_iso": to_iso(self.start_ts),
            "end_iso": to_iso(self.end_ts),
            "row_count": self.row_count,
            "content_sha256": self.content_sha256,
            "created_at": self.created_at,
            "generator_version": self.generator_version,
            "seed": self.seed,
            "columns": list(self.columns),
            "gaps": [g.to_dict() for g in self.gaps],
            "unexplained_gap_count": len(self.unexplained_gaps),
            "validation_counters": dict(self.validation_counters),
            "drop_rate": round(self.drop_rate, 6),
            "notes": list(self.notes),
        }

    def write(self, directory: str | Path) -> Path:
        path = Path(directory) / MANIFEST_FILENAME
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True))
        _log.info(
            "dataset_manifest_written",
            dataset_id=self.dataset_id,
            path=str(path),
            rows=self.row_count,
            drop_rate=round(self.drop_rate, 6),
        )
        return path

    @classmethod
    def read(cls, directory: str | Path) -> DatasetManifest:
        """Load a manifest.

        Raises:
            FileNotFoundError: when the directory has no manifest. A dataset without one
                has no provenance, and using it would produce a backtest whose inputs
                cannot be identified.
        """
        path = Path(directory) / MANIFEST_FILENAME
        if not path.is_file():
            raise FileNotFoundError(
                f"{path} not found. A dataset without a manifest has no provenance; "
                "re-ingest it with scripts/ingest_data.py."
            )
        payload = json.loads(path.read_text())
        return cls(
            dataset_id=str(payload["dataset_id"]),
            source=str(payload["source"]),
            instruments=list(payload.get("instruments", [])),
            start_ts=int(payload["start_ts"]),
            end_ts=int(payload["end_ts"]),
            row_count=int(payload.get("row_count", 0)),
            schema_version=int(payload.get("schema_version", SCHEMA_VERSION)),
            content_sha256=str(payload.get("content_sha256", "")),
            created_at=str(payload.get("created_at", "")),
            generator_version=str(payload.get("generator_version", "")),
            seed=payload.get("seed"),
            gaps=[DataGap.from_dict(g) for g in payload.get("gaps", [])],
            validation_counters=dict(payload.get("validation_counters", {})),
            columns=list(payload.get("columns", [])),
            notes=list(payload.get("notes", [])),
        )

    def verify(self, directory: str | Path) -> bool:
        """Whether the files on disk still hash to what the manifest recorded.

        Returns ``False`` rather than raising, so a caller can decide whether a changed
        dataset is a problem — but it is never silently ignored: the mismatch is logged.
        """
        actual = hash_directory(directory)
        if actual == self.content_sha256:
            return True
        _log.error(
            "dataset_content_changed",
            dataset_id=self.dataset_id,
            recorded=self.content_sha256,
            actual=actual,
            detail="results referencing this dataset are no longer reproducible",
        )
        return False


def hash_directory(directory: str | Path, exclude: tuple[str, ...] = (MANIFEST_FILENAME,)) -> str:
    """SHA-256 over every data file in ``directory``, in a stable order.

    The manifest itself is excluded — it contains the hash, so including it would be
    circular. File names are hashed alongside contents, so renaming a partition changes
    the fingerprint even when the bytes do not.
    """
    root = Path(directory)
    digest = hashlib.sha256()
    files = sorted(
        p for p in root.rglob("*") if p.is_file() and p.name not in exclude
    )
    for path in files:
        digest.update(str(path.relative_to(root)).encode())
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    return "sha256:" + digest.hexdigest()
