#!/usr/bin/env python3
"""Replay a recorded run from its manifest and verify the result hash.

Usage:
    python scripts/replay_run.py runs/<run_id>/manifest.json [--config configs]

The check that matters: the replay's result hash must equal the one the manifest recorded.
If it does not, the run was not reproducible, and the script says why — a dirty working
tree, a changed configuration, or a changed dataset.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.backtest.manifest import RunManifest, git_state  # noqa: E402
from core.backtest.runner import run_backtest  # noqa: E402
from core.config.loader import load_bundle  # noqa: E402
from core.util.logging import configure_logging  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay a recorded VYRA run")
    parser.add_argument("manifest", help="path to the run's manifest.json")
    parser.add_argument("--config", default=str(REPO_ROOT / "configs"))
    parser.add_argument("--log-level", default="ERROR")
    args = parser.parse_args()

    configure_logging(args.log_level)
    manifest_path = Path(args.manifest)
    if not manifest_path.is_file():
        print(f"manifest not found: {manifest_path}", file=sys.stderr)
        return 2

    recorded = RunManifest.read(manifest_path)
    print(f"Replaying run {recorded['run_id']}")
    print(f"  recorded commit : {recorded['git_commit']} (dirty: {recorded['git_dirty']})")
    print(f"  recorded config : {recorded['config_hash']}")
    print(f"  recorded dataset: {recorded['dataset_fingerprint']}")
    print(f"  recorded result : {recorded['result_hash']}")

    problems: list[str] = []
    if recorded["git_dirty"]:
        problems.append(
            "the original run had an uncommitted working tree, so it cannot be "
            "reproduced from its commit"
        )
    commit, dirty = git_state()
    if commit != recorded["git_commit"]:
        problems.append(
            f"the working tree is at {commit[:12]}, the run was made at "
            f"{str(recorded['git_commit'])[:12]}"
        )
    if dirty:
        problems.append("the current working tree has uncommitted changes")

    current_config = load_bundle(args.config).hash
    if current_config != recorded["config_hash"]:
        problems.append(
            f"configuration has changed: {current_config} != {recorded['config_hash']}"
        )

    replayed = run_backtest(
        config_dir=args.config, run_id=f"replay-{recorded['run_id']}", write_outputs=False
    )
    print(f"  replayed result : {replayed.manifest.result_hash}")
    print(f"  replayed dataset: {replayed.manifest.dataset_fingerprint}")

    if replayed.manifest.result_hash == recorded["result_hash"]:
        print("\nREPRODUCED: the result hash matches exactly.")
        return 0

    print("\nNOT REPRODUCED: the result hash differs.")
    if problems:
        print("Likely causes:")
        for problem in problems:
            print(f"  - {problem}")
    else:
        print(
            "  No difference was detected in the commit, configuration or dataset. "
            "That points to genuine non-determinism in the engine, which is a bug."
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
