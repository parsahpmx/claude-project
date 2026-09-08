"""Monte Carlo resampling: what the one realised path does not tell you."""

from __future__ import annotations

import pytest

from core.events import Side
from core.portfolio.position import RealizedTrade
from core.validation.monte_carlo import ResampleMethod, run_monte_carlo


def trades(pnls: list[float], fees: float = 10.0) -> list[RealizedTrade]:
    return [
        RealizedTrade("CME:MES", "v", Side.BUY, 1, 5100.0, 5101.0, pnl + fees, fees, 0, 1)
        for pnl in pnls
    ]


ALTERNATING = trades([200.0, -100.0] * 60)


class TestSequenceVersusSampleRisk:
    def test_shuffling_preserves_total_pnl(self) -> None:
        """Shuffle isolates sequence risk: the same trades in a different order."""
        result = run_monte_carlo(
            ALTERNATING, 100_000.0, iterations=200, method=ResampleMethod.SHUFFLE, seed=1
        )
        assert result.pnl_p05 == pytest.approx(result.realised_pnl)
        assert result.pnl_p95 == pytest.approx(result.realised_pnl)

    def test_shuffling_still_varies_the_drawdown(self) -> None:
        """A bad run of losses at the wrong time is exactly what this measures."""
        result = run_monte_carlo(
            ALTERNATING, 100_000.0, iterations=500, method=ResampleMethod.SHUFFLE, seed=1
        )
        assert result.drawdown_p95 > result.realised_max_drawdown

    def test_bootstrapping_varies_total_pnl(self) -> None:
        result = run_monte_carlo(
            ALTERNATING, 100_000.0, iterations=500, method=ResampleMethod.BOOTSTRAP, seed=1
        )
        assert result.pnl_p05 < result.realised_pnl < result.pnl_p95


class TestRiskMeasures:
    def test_probability_of_ruin_is_reported(self) -> None:
        losers = trades([-500.0] * 100)
        result = run_monte_carlo(
            losers, 10_000.0, iterations=200, ruin_threshold_pct=0.2, seed=1
        )
        assert result.probability_of_ruin == 1.0

    def test_a_robust_strategy_has_no_ruin(self) -> None:
        result = run_monte_carlo(ALTERNATING, 1_000_000.0, iterations=200, seed=1)
        assert result.probability_of_ruin == 0.0

    def test_drawdown_understatement_is_a_ratio_to_the_realised_path(self) -> None:
        result = run_monte_carlo(ALTERNATING, 100_000.0, iterations=500, seed=1)
        assert result.drawdown_understatement == pytest.approx(
            result.drawdown_p95 / result.realised_max_drawdown
        )

    def test_probability_of_loss_is_reported(self) -> None:
        marginal = trades([100.0, -95.0] * 50)
        result = run_monte_carlo(marginal, 100_000.0, iterations=500, seed=1)
        assert 0.0 <= result.probability_of_loss <= 1.0

    def test_net_pnl_is_used_not_gross(self) -> None:
        """A Monte Carlo on gross PnL answers a question about an untradeable strategy."""
        with_fees = trades([100.0] * 50, fees=10.0)
        result = run_monte_carlo(with_fees, 100_000.0, iterations=50, seed=1)
        assert result.realised_pnl == pytest.approx(50 * 100.0)


class TestDeterminism:
    def test_the_same_seed_reproduces_the_result(self) -> None:
        first = run_monte_carlo(ALTERNATING, 100_000.0, iterations=200, seed=7)
        second = run_monte_carlo(ALTERNATING, 100_000.0, iterations=200, seed=7)
        assert first.to_dict() == second.to_dict()

    def test_a_different_seed_gives_a_different_result(self) -> None:
        first = run_monte_carlo(ALTERNATING, 100_000.0, iterations=200, seed=7)
        second = run_monte_carlo(ALTERNATING, 100_000.0, iterations=200, seed=8)
        assert first.to_dict() != second.to_dict()


class TestGuards:
    def test_one_trade_is_not_a_distribution(self) -> None:
        with pytest.raises(ValueError, match="not a distribution"):
            run_monte_carlo(trades([100.0]), 100_000.0)

    def test_non_positive_equity_is_refused(self) -> None:
        with pytest.raises(ValueError, match="starting_equity must be positive"):
            run_monte_carlo(ALTERNATING, 0.0)

    def test_zero_iterations_is_refused(self) -> None:
        with pytest.raises(ValueError, match="iterations must be positive"):
            run_monte_carlo(ALTERNATING, 100_000.0, iterations=0)
