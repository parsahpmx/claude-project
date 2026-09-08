"""The promotion gate: no by default, and every rejection says why."""

from __future__ import annotations

import pytest

from core.analytics.metrics import MetricSet, PerformanceReport
from core.events import FillModel
from core.validation.monte_carlo import MonteCarloResult, ResampleMethod
from core.validation.promotion import PromotionCriteria, PromotionGate
from core.validation.sensitivity import PlateauResult


def metric_set(
    label: str = "after costs", *, trades: int = 200, expectancy: float = 25.0,
    sharpe: float = 1.5, total: float = 5000.0,
) -> MetricSet:
    return MetricSet(
        label=label, total_pnl=total, trade_count=trades,
        win_count=int(trades * 0.55), loss_count=int(trades * 0.45),
        win_rate=0.55, average_win=200.0, average_loss=150.0, payoff_ratio=1.33,
        profit_factor=1.6, expectancy=expectancy, sharpe=sharpe, sortino=2.0,
        max_drawdown=800.0, max_drawdown_pct=0.008,
    )


def passing_report(**overrides) -> PerformanceReport:
    net = overrides.pop("net", metric_set())
    gross = overrides.pop("gross", metric_set("before costs", total=7000.0, expectancy=35.0))
    defaults = {
        "gross": gross, "net": net, "starting_equity": 100_000.0, "ending_equity": 105_000.0,
        "commission_cost": 2000.0, "total_cost": 2000.0,
        "by_regime": {"RANGE": 3000.0, "LOW_VOLATILITY": 2000.0},
    }
    defaults.update(overrides)
    return PerformanceReport(**defaults)


def passing_walk_forward(count: int = 6, profitable: int = 5) -> list[PerformanceReport]:
    return [
        passing_report(net=metric_set(total=500.0 if i < profitable else -200.0))
        for i in range(count)
    ]


def passing_monte_carlo(**overrides) -> MonteCarloResult:
    defaults = {
        "method": ResampleMethod.BOOTSTRAP, "iterations": 1000, "trade_count": 200,
        "starting_equity": 100_000.0, "realised_pnl": 5000.0, "realised_max_drawdown": 800.0,
        "median_pnl": 5000.0, "pnl_p05": 2000.0, "pnl_p95": 8000.0,
        "median_max_drawdown": 900.0, "drawdown_p95": 1200.0, "worst_drawdown": 2000.0,
        "probability_of_loss": 0.02, "probability_of_ruin": 0.0, "ruin_threshold_pct": 0.2,
    }
    defaults.update(overrides)
    return MonteCarloResult(**defaults)


def passing_plateau(**overrides) -> PlateauResult:
    defaults = {
        "parameter": "entry_deviation_sigma", "best_value": 2.0, "best_metric": 25.0,
        "plateau_values": (1.5, 2.0, 2.5), "plateau_fraction": 0.5,
        "plateau_mean_metric": 20.0, "swept_count": 6, "profitable_count": 3,
        "peak_to_plateau_ratio": 1.25,
    }
    defaults.update(overrides)
    return PlateauResult(**defaults)


def evaluate(gate: PromotionGate | None = None, **overrides):
    kwargs = {
        "out_of_sample": passing_report(),
        "fill_model": FillModel.REALISTIC,
        "walk_forward": passing_walk_forward(),
        "monte_carlo": passing_monte_carlo(),
        "plateaus": [passing_plateau()],
    }
    kwargs.update(overrides)
    return (gate or PromotionGate()).evaluate("test_strategy", **kwargs)


class TestFullEvidenceApproves:
    def test_a_strategy_with_complete_evidence_is_approved(self) -> None:
        decision = evaluate()
        assert decision.approved, decision.failures
        assert not decision.failures

    def test_the_evidence_is_recorded_for_audit(self) -> None:
        decision = evaluate()
        for key in ("oos_trades", "oos_sharpe", "cost_headroom",
                    "walk_forward_win_rate", "probability_of_ruin", "plateaus"):
            assert key in decision.evidence


class TestMissingEvidenceIsAFailure:
    """An unmeasured risk is not an absent one."""

    def test_no_out_of_sample_result(self) -> None:
        decision = evaluate(out_of_sample=None)
        assert not decision.approved
        assert any("NO_OUT_OF_SAMPLE_RESULT" in f for f in decision.failures)

    def test_no_walk_forward(self) -> None:
        decision = evaluate(walk_forward=None)
        assert not decision.approved
        assert any("NO_WALK_FORWARD" in f for f in decision.failures)

    def test_no_monte_carlo(self) -> None:
        decision = evaluate(monte_carlo=None)
        assert not decision.approved
        assert any("NO_MONTE_CARLO" in f for f in decision.failures)

    def test_no_sensitivity_analysis(self) -> None:
        decision = evaluate(plateaus=None)
        assert not decision.approved
        assert any("NO_SENSITIVITY_ANALYSIS" in f for f in decision.failures)

    def test_no_fill_model_recorded(self) -> None:
        decision = evaluate(fill_model=None)
        assert not decision.approved
        assert any("FILL_MODEL" in f for f in decision.failures)

    def test_nothing_at_all_fails_everything(self) -> None:
        decision = PromotionGate().evaluate("bare", out_of_sample=None)
        assert not decision.approved


class TestIndividualCriteria:
    def test_too_few_out_of_sample_trades(self) -> None:
        decision = evaluate(out_of_sample=passing_report(net=metric_set(trades=20)))
        assert any("MIN_OOS_TRADES" in f for f in decision.failures)

    def test_negative_expectancy_after_costs(self) -> None:
        decision = evaluate(
            out_of_sample=passing_report(net=metric_set(expectancy=-5.0, total=-1000.0))
        )
        assert any("OOS_EXPECTANCY" in f for f in decision.failures)

    def test_sharpe_below_the_bar(self) -> None:
        decision = evaluate(out_of_sample=passing_report(net=metric_set(sharpe=0.1)))
        assert any("MIN_OOS_SHARPE" in f for f in decision.failures)

    def test_insufficient_cost_headroom(self) -> None:
        """Below 1.5x there is no margin for real-world cost drift.

        Headroom is gross / drag: the multiple of current costs at which net PnL reaches
        zero. Gross 5,200 against a drag of 4,200 leaves 1.24x.
        """
        thin = passing_report(
            gross=metric_set("before costs", total=5200.0),
            net=metric_set(total=1000.0),
        )
        assert thin.cost_headroom is not None
        assert thin.cost_headroom < 1.5
        decision = evaluate(out_of_sample=thin)
        assert any("MIN_COST_HEADROOM" in f for f in decision.failures)

    def test_ample_cost_headroom_passes(self) -> None:
        ample = passing_report(
            gross=metric_set("before costs", total=7000.0),
            net=metric_set(total=5000.0),
        )
        assert ample.cost_headroom == pytest.approx(3.5)
        decision = evaluate(out_of_sample=ample)
        assert not any("COST_HEADROOM" in f for f in decision.failures)

    def test_optimistic_fills_are_blocked(self) -> None:
        decision = evaluate(fill_model=FillModel.OPTIMISTIC)
        assert any("FILL_MODEL" in f for f in decision.failures)

    def test_inconsistent_walk_forward(self) -> None:
        """Consistency matters more than the aggregate."""
        decision = evaluate(walk_forward=passing_walk_forward(count=6, profitable=1))
        assert any("WALK_FORWARD_CONSISTENCY" in f for f in decision.failures)

    def test_high_probability_of_ruin(self) -> None:
        decision = evaluate(monte_carlo=passing_monte_carlo(probability_of_ruin=0.5))
        assert any("PROBABILITY_OF_RUIN" in f for f in decision.failures)

    def test_drawdown_understated_by_ordering_luck(self) -> None:
        decision = evaluate(
            monte_carlo=passing_monte_carlo(
                realised_max_drawdown=100.0, drawdown_p95=5000.0
            )
        )
        assert any("DRAWDOWN_UNDERSTATED" in f for f in decision.failures)

    def test_an_isolated_peak_is_rejected_as_not_a_region(self) -> None:
        """A peak surrounded by losses is noise, and the message must say so."""
        decision = evaluate(
            plateaus=[
                passing_plateau(
                    plateau_values=(2.0,), plateau_fraction=0.33, profitable_count=1
                )
            ]
        )
        failure = next(f for f in decision.failures if "PARAMETER_PLATEAU" in f)
        assert "isolated point" in failure
        # The old message read "spans 33% ... below the required 30%", which is false
        # arithmetic; the real cause is that one point is not a region.
        assert "below the required" not in failure

    def test_a_genuine_but_too_narrow_plateau_reports_the_fraction(self) -> None:
        decision = evaluate(
            plateaus=[
                passing_plateau(
                    plateau_values=(2.0, 2.5), plateau_fraction=0.2, swept_count=10
                )
            ]
        )
        failure = next(f for f in decision.failures if "PARAMETER_PLATEAU" in f)
        assert "20% of the swept range" in failure
        assert "below the required 30%" in failure

    def test_a_peak_far_above_its_neighbourhood_warns(self) -> None:
        decision = evaluate(plateaus=[passing_plateau(peak_to_plateau_ratio=8.0)])
        assert any("PEAK_ABOVE_NEIGHBOURHOOD" in w for w in decision.warnings)

    def test_profitable_in_only_one_regime_warns(self) -> None:
        decision = evaluate(
            out_of_sample=passing_report(by_regime={"RANGE": 5000.0, "BREAKOUT": -200.0})
        )
        assert any("SINGLE_REGIME" in w for w in decision.warnings)

    def test_no_regime_attribution_warns(self) -> None:
        decision = evaluate(out_of_sample=passing_report(by_regime={}))
        assert any("NO_REGIME_ATTRIBUTION" in w for w in decision.warnings)


class TestImplausibleResults:
    def test_an_implausible_result_is_surfaced_as_a_warning(self) -> None:
        """No losing trades in 200 is a bug far more often than an edge."""
        perfect = metric_set(trades=200, total=50_000.0)
        report = passing_report(
            net=MetricSet(
                label="after costs", total_pnl=50_000.0, trade_count=200,
                win_count=200, loss_count=0, win_rate=1.0, average_win=250.0,
                average_loss=0.0, expectancy=250.0, sharpe=perfect.sharpe,
            )
        )
        decision = evaluate(out_of_sample=report)
        assert any("IMPLAUSIBLE_RESULT" in w for w in decision.warnings)


class TestConfigurableBar:
    def test_a_stricter_bar_rejects_what_a_looser_one_accepts(self) -> None:
        assert evaluate().approved
        strict = PromotionGate(PromotionCriteria(min_oos_trades=100_000))
        assert not evaluate(strict).approved

    def test_criteria_load_from_the_shipped_configuration(self, config_bundle) -> None:
        criteria = PromotionCriteria.from_config(
            config_bundle["validation"].section("promotion")
        )
        assert criteria.min_oos_trades == 100
        assert criteria.min_cost_headroom == 1.5
        assert criteria.require_realistic_fills


class TestRendering:
    def test_a_rejection_lists_its_failures(self) -> None:
        decision = evaluate(out_of_sample=passing_report(net=metric_set(trades=5)))
        rendered = decision.render()
        assert "NOT APPROVED" in rendered
        assert "MIN_OOS_TRADES" in rendered

    def test_an_approval_says_so(self) -> None:
        assert "APPROVED for promotion" in evaluate().render()
