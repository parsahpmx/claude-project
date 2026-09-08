"""Reproducibility: the same configuration must produce the same result, exactly."""

from __future__ import annotations

import json
from pathlib import Path

from core.backtest.runner import run_backtest
from tests.backtest.conftest import make_config


class TestDeterminism:
    def test_the_same_configuration_produces_an_identical_result_hash(
        self, tmp_path: Path
    ) -> None:
        """The core reproducibility guarantee (BACKTEST_SPEC.md §7).

        Run under two different run ids on purpose: the hash must cover the economic
        result, not the run's identity.
        """
        config_dir = make_config(tmp_path)
        first = run_backtest(config_dir, output_root=tmp_path / "a", run_id="r1",
                             write_outputs=False)
        second = run_backtest(config_dir, output_root=tmp_path / "b", run_id="r2",
                              write_outputs=False)
        # Guard against a vacuous pass: a window with no trades would match trivially, and
        # would prove nothing about the parts of the engine that matter.
        assert first.result.portfolio.realized_trades, "window produced no trades to compare"
        assert first.manifest.result_hash == second.manifest.result_hash

    def test_trade_ledgers_are_identical_trade_for_trade(self, tmp_path: Path) -> None:
        config_dir = make_config(tmp_path)
        first = run_backtest(config_dir, output_root=tmp_path / "a", run_id="r1",
                             write_outputs=False)
        second = run_backtest(config_dir, output_root=tmp_path / "b", run_id="r2",
                              write_outputs=False)
        assert first.result.portfolio.realized_trades, "window produced no trades to compare"
        assert [t.to_dict() for t in first.result.portfolio.realized_trades] == [
            t.to_dict() for t in second.result.portfolio.realized_trades
        ]

    def test_a_different_seed_produces_a_different_result(self, tmp_path: Path) -> None:
        """Otherwise the hash would be proving nothing."""
        base = run_backtest(make_config(tmp_path / "base"), output_root=tmp_path / "a",
                            run_id="r1", write_outputs=False)
        other = run_backtest(
            make_config(tmp_path / "other", overrides={"run.random_seed": 999}),
            output_root=tmp_path / "b", run_id="r2", write_outputs=False,
        )
        assert base.manifest.result_hash != other.manifest.result_hash

    def test_a_changed_config_changes_the_config_hash(self, tmp_path: Path) -> None:
        base = run_backtest(make_config(tmp_path / "base"), output_root=tmp_path / "a",
                            run_id="r1", write_outputs=False)
        changed = run_backtest(
            make_config(tmp_path / "changed", end="2024-03-05T03:00:00Z"),
            output_root=tmp_path / "b", run_id="r2", write_outputs=False,
        )
        assert base.manifest.config_hash != changed.manifest.config_hash


class TestManifest:
    def test_the_manifest_records_everything_needed_to_replay(self, short_run) -> None:
        payload = short_run.manifest.to_dict()
        for field in (
            "git_commit", "git_dirty", "config_hash", "configs", "dataset_id",
            "dataset_fingerprint", "instruments", "start_ts", "end_ts", "fill_model",
            "slippage_model", "latency_model", "random_seed", "environment",
            "result_hash", "engine_version",
        ):
            assert field in payload, f"manifest is missing {field}"

    def test_the_manifest_is_written_next_to_the_results(self, short_run) -> None:
        path = short_run.output_directory / "manifest.json"
        assert path.is_file()
        assert json.loads(path.read_text())["result_hash"] == short_run.manifest.result_hash

    def test_synthetic_data_is_watermarked(self, short_run) -> None:
        """No expectancy claim may be made from generated data."""
        assert any("SYNTHETIC" in w for w in short_run.manifest.warnings)

    def test_a_dirty_tree_is_flagged_as_not_reproducible(self, short_run) -> None:
        manifest = short_run.manifest
        if manifest.git_dirty:
            assert not manifest.is_reproducible
            assert any("NOT_REPRODUCIBLE" in w for w in manifest.warnings)
        else:
            assert manifest.is_reproducible

    def test_optimistic_fills_are_flagged(self, tmp_path: Path) -> None:
        run = run_backtest(
            make_config(tmp_path, overrides={"execution.fill_model": "OPTIMISTIC"}),
            output_root=tmp_path / "runs", run_id="opt", write_outputs=False,
        )
        assert any("OPTIMISTIC_FILLS" in w for w in run.manifest.warnings)

    def test_zero_latency_is_flagged_as_idealised(self, tmp_path: Path) -> None:
        from core.backtest.manifest import RunManifest

        manifest = RunManifest(
            run_id="r", engine_version="0.1.0", mode="BACKTEST", git_commit="abc",
            git_dirty=False, config_hash="sha256:x", configs={}, strategies=[],
            dataset_id="D", dataset_fingerprint="sha256:y", instruments=[], start_ts=0,
            end_ts=1, fill_model="REALISTIC", slippage_model={},
            latency_model={"order_latency_us": 0}, commission_model={}, random_seed=1,
        )
        assert any("IDEALISED" in w for w in manifest.warnings)
