"""MVP acceptance criteria (§33 of the platform specification).

Each test corresponds to one required capability. The MVP is complete only when this
module passes in full.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.backtest.runner import run_backtest
from core.events import FillModel
from tests.backtest.conftest import make_config


class TestDataPipeline:
    """download -> normalise -> bars."""

    def test_market_data_is_ingested(self, short_run) -> None:
        assert short_run.result.events_processed > 0

    def test_data_is_normalised_and_the_quality_recorded(self, short_run) -> None:
        validation = short_run.result.data_quality["validation"]
        assert validation, "no validation counters were recorded"
        counters = next(iter(validation.values()))
        assert counters["accepted"] > 0
        assert "drop_rate" in counters

    def test_bars_are_built(self, short_run) -> None:
        assert short_run.result.bars_built > 0


class TestEventDrivenBacktest:
    def test_the_run_completes_and_processes_events_in_order(self, short_run) -> None:
        assert short_run.result.events_processed > 0
        equity = short_run.result.portfolio.equity_curve
        assert all(equity[i].ts <= equity[i + 1].ts for i in range(len(equity) - 1))

    def test_at_least_one_strategy_executed(self, short_run) -> None:
        assert short_run.result.signals, "the strategy produced no signals"

    def test_the_backtester_uses_the_production_objects(self) -> None:
        """No separate backtest strategy path may exist."""
        import core.backtest.engine as engine_module

        source = Path(engine_module.__file__).read_text()
        assert "class BacktestStrategy" not in source
        assert "BaseStrategy" in source


class TestCostModelling:
    def test_spread_is_modelled(self, short_run) -> None:
        fills = short_run.result.fills
        assert fills, "no fills to inspect"
        assert any(f.get("spread_at_fill") for f in fills)

    def test_commission_is_charged(self, short_run) -> None:
        assert short_run.report.commission_cost > 0

    def test_slippage_moves_the_fill_away_from_the_expected_price(self, short_run) -> None:
        fills = short_run.result.fills
        slipped = [
            f for f in fills
            if f.get("expected_price") and f["price"] != f["expected_price"]
        ]
        assert slipped, "no fill differed from its expected price; slippage is not applied"

    def test_gross_and_net_are_reported_separately(self, short_run) -> None:
        report = short_run.report
        assert report.gross.total_pnl != report.net.total_pnl or report.net.trade_count == 0
        assert report.cost_drag >= 0

    def test_the_default_fill_model_is_not_optimistic(self, short_run) -> None:
        assert short_run.manifest.fill_model != FillModel.OPTIMISTIC.value


class TestRiskControls:
    def test_position_sizing_is_applied(self, short_run) -> None:
        decisions = [d for d in short_run.result.risk_events if d["action"] == "APPROVE"]
        assert decisions, "no approved decisions"
        sized = [d for d in decisions if d.get("sizing")]
        assert sized, "no decision carried a sizing record"
        assert all(d["approved_qty"] > 0 for d in sized)

    def test_every_order_carries_a_risk_decision(self, short_run) -> None:
        """The structural guarantee that risk cannot be bypassed."""
        for order in short_run.result.orders:
            assert order["risk_decision_id"], f"order {order['order_id']} has no risk decision"

    def test_max_daily_loss_triggers_the_kill_switch(self, tmp_path: Path) -> None:
        """A tight daily-loss limit must halt the run."""

        import yaml

        config_dir = make_config(tmp_path, end="2024-03-05T12:00:00Z")
        risk = yaml.safe_load((config_dir / "risk.yaml").read_text())
        risk["loss_limits"]["max_daily_loss_pct"] = 0.0001  # 0.01% — certain to breach
        risk["loss_limits"]["max_weekly_loss_pct"] = 0.0002
        (config_dir / "risk.yaml").write_text(yaml.safe_dump(risk))

        run = run_backtest(config_dir, output_root=tmp_path / "runs", run_id="halt",
                           write_outputs=False)
        assert run.result.halted, "a 0.01% daily loss limit did not halt the run"
        halts = [d for d in run.result.risk_events if d["action"] == "HALT"]
        assert halts
        assert halts[0]["reason_codes"] == ["KILL_SWITCH_ACTIVE"]

    def test_no_orders_are_placed_after_a_halt(self, tmp_path: Path) -> None:
        import yaml

        config_dir = make_config(tmp_path, end="2024-03-05T12:00:00Z")
        risk = yaml.safe_load((config_dir / "risk.yaml").read_text())
        risk["loss_limits"]["max_daily_loss_pct"] = 0.0001
        risk["loss_limits"]["max_weekly_loss_pct"] = 0.0002
        (config_dir / "risk.yaml").write_text(yaml.safe_dump(risk))

        run = run_backtest(config_dir, output_root=tmp_path / "runs", run_id="halt2",
                           write_outputs=False)
        halt_ts = min(
            (d["ts"] for d in run.result.risk_events if d["action"] == "HALT"), default=None
        )
        if halt_ts is None:
            pytest.skip("the run did not halt in this window")
        entries_after = [
            o for o in run.result.orders
            if o["is_entry"] and o["ts_created"] > halt_ts and o["state"] != "REJECTED_LOCAL"
        ]
        assert not entries_after, f"{len(entries_after)} entries were created after the halt"


class TestReconciliation:
    def test_the_book_agrees_with_the_venue_at_the_end_of_the_run(self, short_run) -> None:
        """Both are derived from the same fills, so any divergence is an engine bug."""
        final = short_run.result.data_quality.get("final_reconciliation")
        assert final is not None, "the run did not reconcile at the end"
        assert final["is_clean"], f"book diverged from the venue: {final['divergences']}"

    def test_no_divergence_was_recorded_during_the_run(self, short_run) -> None:
        assert "reconciliation" not in short_run.result.data_quality


class TestOutputs:
    def test_an_equity_curve_is_produced(self, short_run) -> None:
        curve = short_run.result.portfolio.equity_curve
        assert len(curve) > 1
        assert all(hasattr(p, "drawdown") for p in curve)

    def test_a_trade_ledger_is_produced(self, short_run) -> None:
        path = short_run.output_directory / "trades.jsonl"
        assert path.is_file()
        for line in path.read_text().splitlines():
            row = json.loads(line)
            for field in ("entry_price", "exit_price", "gross_pnl", "fees", "net_pnl",
                          "mae", "mfe", "holding_ns"):
                assert field in row

    def test_performance_metrics_are_produced(self, short_run) -> None:
        path = short_run.output_directory / "metrics.json"
        assert path.is_file()
        metrics = json.loads(path.read_text())
        assert "gross" in metrics and "net" in metrics
        assert "costs" in metrics and "survives_costs" in metrics

    def test_a_human_readable_report_is_produced(self, short_run) -> None:
        report = (short_run.output_directory / "report.md").read_text()
        assert "Before vs after costs" in report
        assert "Reproducibility" in report

    def test_warnings_lead_the_report(self, short_run) -> None:
        """A reader who stops after the first screen must know what to distrust."""
        report = (short_run.output_directory / "report.md").read_text()
        warnings_at = report.index("Read this first")
        assert warnings_at < report.index("Before vs after costs")

    def test_every_surface_shows_both_kinds_of_warning(self, short_run) -> None:
        """Provenance warnings and result-shape warnings must not be split across surfaces."""
        report = (short_run.output_directory / "report.md").read_text()
        for warning in short_run.warnings:
            assert warning in report, f"report.md omits {warning!r}"
        assert set(short_run.summary["warnings"]) == set(short_run.warnings)
        assert any("SYNTHETIC" in w for w in short_run.warnings)
        assert any("TRADES" in w for w in short_run.warnings)

    def test_orders_fills_and_risk_events_are_all_written(self, short_run) -> None:
        for name in ("orders.jsonl", "fills.jsonl", "risk_events.jsonl", "equity.jsonl"):
            assert (short_run.output_directory / name).is_file(), f"{name} was not written"


class TestReproducibilityCriterion:
    def test_the_backtest_reproduces_from_its_configuration(self, tmp_path: Path) -> None:
        config_dir = make_config(tmp_path)
        first = run_backtest(config_dir, output_root=tmp_path / "a", run_id="x",
                             write_outputs=False)
        second = run_backtest(config_dir, output_root=tmp_path / "b", run_id="y",
                              write_outputs=False)
        assert first.manifest.result_hash == second.manifest.result_hash
