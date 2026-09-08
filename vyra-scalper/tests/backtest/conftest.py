"""Fixtures for backtest tests.

Runs use a short window so the suite stays fast; the pipeline exercised is identical to a
full run, only the amount of data differs.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]


def make_config(
    tmp_path: Path,
    *,
    start: str = "2024-03-05T00:00:00Z",
    end: str = "2024-03-05T08:00:00Z",
    overrides: dict | None = None,
) -> Path:
    """Copy the shipped configuration and narrow the backtest window."""
    target = tmp_path / "configs"
    shutil.copytree(REPO_ROOT / "configs", target)
    backtest = yaml.safe_load((target / "backtest.yaml").read_text())
    backtest["data"]["start"] = start
    backtest["data"]["end"] = end
    for key, value in (overrides or {}).items():
        section, _, field = key.partition(".")
        if field:
            backtest.setdefault(section, {})[field] = value
        else:
            backtest[section] = value
    (target / "backtest.yaml").write_text(yaml.safe_dump(backtest))
    return target


@pytest.fixture(scope="session")
def short_run(tmp_path_factory: pytest.TempPathFactory):
    """One shared backtest, reused across tests.

    Eight hours: long enough for the regime engine (30 bars) and the VWAP window (20 bars)
    to warm up and for the strategy to actually trade, which is what the acceptance tests
    need to observe. A shorter window runs faster but tests only the warm-up path.
    """
    from core.backtest.runner import run_backtest

    tmp = tmp_path_factory.mktemp("short_run")
    config_dir = make_config(tmp)
    return run_backtest(config_dir, output_root=tmp / "runs", run_id="test-short")
