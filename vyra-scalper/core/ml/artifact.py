"""What a trained model is, and what it must carry to be usable.

A model file on its own is not a result. Reproducing one means knowing the code, the data
and the randomness that produced it, so an artifact that cannot name all three is refused
rather than loaded — the same rule the run manifest applies to a backtest, for the same
reason.

The dataset is identified by the **content hash from its manifest**, not by a path. A path
says where the data was; a hash says what it was. Retraining on "the data in that directory"
after somebody re-ingested it produces a different model with the same provenance.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from core.util.clock import now_ns, to_iso
from core.util.logging import get_logger

__all__ = ["ModelArtifact"]

_log = get_logger("ml.artifact")

ARTIFACT_VERSION = 1


def _git_commit() -> str:
    """The commit that produced this model, or a marker saying it is not reproducible."""
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10, check=True
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"], capture_output=True, text=True, timeout=10, check=True
        ).stdout.strip()
        return f"{commit}-dirty" if dirty else commit
    except Exception:
        return "UNKNOWN"


@dataclass(slots=True)
class ModelArtifact:
    """A trained model plus everything needed to reproduce and to refuse it.

    Attributes:
        dataset_sha256: the content hash from the dataset manifest the model trained on.
            The identity of the data, not its location.
        oos_metrics: out-of-sample only. Training metrics live in ``train_metrics`` and are
            deliberately named so nobody quotes them as performance.
    """

    model_id: str
    model_type: str
    feature_names: tuple[str, ...]
    dataset_sha256: str
    dataset_id: str
    config_hash: str
    seed: int
    label_horizon: int
    oos_metrics: dict[str, float] = field(default_factory=dict)
    train_metrics: dict[str, float] = field(default_factory=dict)
    parameters: dict[str, Any] = field(default_factory=dict)
    coefficients: list[float] = field(default_factory=list)
    intercept: float = 0.0
    git_commit: str = field(default_factory=_git_commit)
    created_at_ns: int = field(default_factory=now_ns)
    warnings: list[str] = field(default_factory=list)
    version: int = ARTIFACT_VERSION

    @property
    def is_reproducible(self) -> bool:
        """Whether this model can be rebuilt from what it records.

        A dirty tree or a missing dataset hash means it cannot: the code or the data that
        produced it is not identified, so retraining would produce something else.
        """
        return (
            self.git_commit not in ("UNKNOWN", "")
            and not self.git_commit.endswith("-dirty")
            and bool(self.dataset_sha256)
        )

    def add_warning(self, warning: str) -> None:
        if warning not in self.warnings:
            self.warnings.append(warning)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "model_id": self.model_id,
            "model_type": self.model_type,
            "feature_names": list(self.feature_names),
            "dataset_sha256": self.dataset_sha256,
            "dataset_id": self.dataset_id,
            "config_hash": self.config_hash,
            "seed": self.seed,
            "label_horizon": self.label_horizon,
            "oos_metrics": dict(self.oos_metrics),
            "train_metrics": dict(self.train_metrics),
            "parameters": dict(self.parameters),
            "coefficients": list(self.coefficients),
            "intercept": self.intercept,
            "git_commit": self.git_commit,
            "created_at": to_iso(self.created_at_ns),
            "created_at_ns": self.created_at_ns,
            "is_reproducible": self.is_reproducible,
            "warnings": list(self.warnings),
        }

    def write(self, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True))
        _log.info(
            "model_artifact_written",
            model_id=self.model_id,
            path=str(target),
            reproducible=self.is_reproducible,
        )
        return target

    @classmethod
    def read(cls, path: str | Path) -> ModelArtifact:
        payload = json.loads(Path(path).read_text())
        if int(payload.get("version", 0)) != ARTIFACT_VERSION:
            raise ValueError(
                f"model artifact version {payload.get('version')} is not "
                f"{ARTIFACT_VERSION}; refusing to load a format this code does not know"
            )
        return cls(
            model_id=str(payload["model_id"]),
            model_type=str(payload["model_type"]),
            feature_names=tuple(payload["feature_names"]),
            dataset_sha256=str(payload["dataset_sha256"]),
            dataset_id=str(payload.get("dataset_id", "")),
            config_hash=str(payload.get("config_hash", "")),
            seed=int(payload["seed"]),
            label_horizon=int(payload["label_horizon"]),
            oos_metrics=dict(payload.get("oos_metrics", {})),
            train_metrics=dict(payload.get("train_metrics", {})),
            parameters=dict(payload.get("parameters", {})),
            coefficients=list(payload.get("coefficients", [])),
            intercept=float(payload.get("intercept", 0.0)),
            git_commit=str(payload.get("git_commit", "UNKNOWN")),
            created_at_ns=int(payload.get("created_at_ns", 0)),
            warnings=list(payload.get("warnings", [])),
        )

    def require_features(self, available: tuple[str, ...]) -> None:
        """Refuse to run against a feature set that is not the one trained on.

        Raises:
            ValueError: on any difference, order included. A model whose inputs arrive in a
                different order is being fed different data, and the failure would be a
                quietly wrong probability rather than an error.
        """
        if tuple(available) != tuple(self.feature_names):
            raise ValueError(
                f"model {self.model_id} was trained on {list(self.feature_names)} but was "
                f"offered {list(available)}; a model fed different inputs returns a "
                "confident number about a different question"
            )
