"""Run manifests — the reproducibility record.

Every run writes one (``BACKTEST_SPEC.md`` §7).  It records the git commit, the config
hash, the dataset fingerprint, every model choice and the random seed, plus a hash of the
result.  Re-running from the manifest must reproduce that hash exactly.

``git_dirty`` is captured honestly: a run made from an uncommitted working tree cannot be
replayed, and the report says so rather than implying a reproducibility it does not have.
"""

from __future__ import annotations

import json
import platform
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from core.util.clock import now_ns, to_iso
from core.util.ids import content_hash
from core.util.logging import get_logger

__all__ = ["RunManifest", "git_state"]

_log = get_logger("backtest.manifest")


def git_state(repo_root: Path | None = None) -> tuple[str, bool]:
    """Return ``(commit_sha, is_dirty)`` for the working tree.

    Returns ``("unknown", True)`` when git is unavailable or the directory is not a
    repository.  Marking an unknown state as dirty is deliberate: an unidentifiable
    revision is not reproducible, and the safe report is the pessimistic one.
    """
    root = repo_root or Path(__file__).resolve().parents[2]
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root, capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root, capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        return commit, bool(status)
    except (subprocess.SubprocessError, OSError, FileNotFoundError):
        _log.warning("git_state_unavailable", repo_root=str(root))
        return "unknown", True


@dataclass(slots=True)
class RunManifest:
    """Everything needed to reproduce a run."""

    run_id: str
    engine_version: str
    mode: str
    git_commit: str
    git_dirty: bool
    config_hash: str
    configs: dict[str, str]
    strategies: list[dict[str, str]]
    dataset_id: str
    dataset_fingerprint: str
    instruments: list[str]
    start_ts: int
    end_ts: int
    fill_model: str
    slippage_model: dict[str, Any]
    latency_model: dict[str, Any]
    commission_model: dict[str, Any]
    random_seed: int
    environment: dict[str, str] = field(default_factory=dict)
    data_quality: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    result_hash: str = ""
    created_at: str = ""

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = to_iso(now_ns())
        if not self.environment:
            self.environment = {
                "python": sys.version.split()[0],
                "platform": platform.platform(),
                "implementation": platform.python_implementation(),
            }
        if self.git_dirty:
            self.add_warning(
                "NOT_REPRODUCIBLE: the working tree had uncommitted changes, so this run "
                "cannot be replayed from its commit"
            )
        if self.dataset_fingerprint.startswith("sha256:") and "SYNTH" in self.dataset_id:
            self.add_warning(
                "SYNTHETIC: generated data. It exercises the pipeline and supports no "
                "claim about expectancy"
            )
        if self.fill_model == "OPTIMISTIC":
            self.add_warning(
                "OPTIMISTIC_FILLS: limit orders fill on touch. Blocked from supporting a "
                "promotion decision"
            )
        if self.latency_model.get("order_latency_us", 1) <= 0:
            self.add_warning(
                "IDEALISED: zero latency configured. Not a tradeable result"
            )

    def add_warning(self, warning: str) -> None:
        if warning not in self.warnings:
            self.warnings.append(warning)

    @property
    def is_reproducible(self) -> bool:
        return not self.git_dirty and self.git_commit != "unknown"

    def finalise(self, result: dict[str, Any]) -> str:
        """Hash the run's outputs and store it.  Returns the hash."""
        self.result_hash = content_hash(result)
        return self.result_hash

    def to_dict(self) -> dict[str, Any]:
        from dataclasses import asdict

        payload = asdict(self)
        payload["is_reproducible"] = self.is_reproducible
        return payload

    def write(self, directory: Path) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "manifest.json"
        path.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True))
        return path

    @classmethod
    def read(cls, path: Path) -> dict[str, Any]:
        """Load a manifest for replay.

        Returns the raw dict rather than an instance: replay reads the recorded settings
        and rebuilds the run from them, so nothing about the current code is allowed to
        leak into what the manifest claimed.
        """
        payload = json.loads(Path(path).read_text())
        if not isinstance(payload, dict):
            raise ValueError(f"{path}: manifest must be a JSON object")
        return payload
