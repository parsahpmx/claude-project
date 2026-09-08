"""Parameter plateaus and cost stress.

The plateau test is the defence against reporting the maximum of a noisy sample; the
stress test is the defence against an edge that exists only at exactly today's costs.
"""

from __future__ import annotations

import pytest

from core.events import Side
from core.portfolio.position import RealizedTrade
from core.validation.sensitivity import find_plateau, sweep_from_results
from core.validation.stress import run_cost_stress


class TestPlateauDetection:
    def test_a_contiguous_profitable_region_is_a_plateau(self) -> None:
        sweep = sweep_from_results(
            "entry_sigma",
            [(1.0, -50, 200), (1.5, 80, 200), (2.0, 120, 200),
             (2.5, 110, 200), (3.0, 90, 200), (3.5, -20, 200)],
        )
        result = find_plateau(sweep)
        assert result.is_plateau
        assert result.plateau_values == (1.5, 2.0, 2.5, 3.0)
        assert result.plateau_fraction == pytest.approx(4 / 6)
        assert result.passes(0.3)

    def test_a_lone_peak_is_not_a_plateau(self) -> None:
        """The maximum of a noisy sample is not an edge."""
        sweep = sweep_from_results(
            "entry_sigma",
            [(1.0, -50, 200), (1.5, -30, 200), (2.0, 400, 200),
             (2.5, -40, 200), (3.0, -60, 200), (3.5, -20, 200)],
        )
        result = find_plateau(sweep)
        assert not result.is_plateau
        assert result.plateau_values == (2.0,)
        assert not result.passes(0.3)

    def test_an_entirely_unprofitable_sweep_has_no_plateau(self) -> None:
        sweep = sweep_from_results(
            "entry_sigma", [(1.0, -50, 200), (2.0, -30, 200), (3.0, -10, 200)]
        )
        result = find_plateau(sweep)
        assert result.plateau_values == ()
        assert result.plateau_fraction == 0.0
        assert not result.passes(0.0)

    def test_a_point_with_too_few_trades_is_excluded(self) -> None:
        """A plateau built out of three-trade samples is a plateau built out of noise."""
        sweep = sweep_from_results(
            "entry_sigma",
            [(1.0, 50, 200), (1.5, 60, 200), (2.0, 500, 3), (2.5, 70, 200)],
        )
        result = find_plateau(sweep, min_trades=100)
        assert 2.0 not in result.plateau_values

    def test_the_peak_to_plateau_ratio_flags_an_outlier(self) -> None:
        sweep = sweep_from_results(
            "entry_sigma", [(1.0, 10, 200), (1.5, 10, 200), (2.0, 300, 200), (2.5, 10, 200)]
        )
        result = find_plateau(sweep)
        assert result.peak_to_plateau_ratio > 2.0

    def test_a_flat_profitable_sweep_has_a_ratio_near_one(self) -> None:
        sweep = sweep_from_results(
            "entry_sigma", [(1.0, 100, 200), (1.5, 102, 200), (2.0, 101, 200)]
        )
        result = find_plateau(sweep)
        assert result.peak_to_plateau_ratio == pytest.approx(1.0, abs=0.02)
        assert result.plateau_fraction == 1.0

    def test_a_sweep_needs_at_least_three_points(self) -> None:
        with pytest.raises(ValueError, match="at least 3 points"):
            sweep_from_results("x", [(1.0, 10, 100), (2.0, 20, 100)])

    def test_duplicate_values_are_refused(self) -> None:
        with pytest.raises(ValueError, match="duplicate values"):
            sweep_from_results("x", [(1.0, 10, 100), (1.0, 20, 100), (2.0, 30, 100)])

    def test_the_sweep_order_does_not_matter(self) -> None:
        forward = sweep_from_results(
            "x", [(1.0, 10, 100), (2.0, 50, 100), (3.0, 20, 100)]
        )
        shuffled = sweep_from_results(
            "x", [(3.0, 20, 100), (1.0, 10, 100), (2.0, 50, 100)]
        )
        assert find_plateau(forward).to_dict() == find_plateau(shuffled).to_dict()


def make_trades(pnls: list[float], fee: float) -> list[RealizedTrade]:
    """``gross_pnl`` includes the fee, so ``net_pnl`` is the figure passed in."""
    return [
        RealizedTrade("CME:MES", "v", Side.BUY, 1, 5100.0, 5101.0, pnl + fee, fee, 0, 1)
        for pnl in pnls
    ]


class TestCostStress:
    def test_the_curve_degrades_with_the_multiple(self) -> None:
        result = run_cost_stress(make_trades([100.0, -50.0] * 50, fee=10.0))
        expectancies = [p.expectancy for p in result.points]
        assert expectancies == sorted(expectancies, reverse=True)

    def test_headroom_is_the_break_even_multiple(self) -> None:
        """Net expectancy at the break-even multiple must be approximately zero."""
        trades = make_trades([100.0, -50.0] * 50, fee=10.0)
        result = run_cost_stress(trades)
        assert result.headroom is not None
        gross = sum(t.gross_pnl for t in trades)
        fees = sum(t.fees for t in trades)
        assert result.headroom == pytest.approx(gross / fees, rel=1e-3)

    def test_higher_fees_leave_less_headroom(self) -> None:
        cheap = run_cost_stress(make_trades([100.0, -50.0] * 50, fee=5.0))
        dear = run_cost_stress(make_trades([100.0, -50.0] * 50, fee=20.0))
        assert cheap.headroom is not None and dear.headroom is not None
        assert cheap.headroom > dear.headroom

    def test_an_unprofitable_strategy_has_no_headroom(self) -> None:
        result = run_cost_stress(make_trades([-10.0] * 50, fee=5.0))
        assert result.headroom is None
        assert not result.passes(1.5)

    def test_zero_fees_report_the_search_bound_not_infinity(self) -> None:
        """A strategy that paid no costs is suspicious, not infinitely robust."""
        result = run_cost_stress(
            make_trades([100.0] * 50, fee=0.0), max_search_multiple=100.0
        )
        assert result.headroom == 100.0

    def test_the_baseline_multiple_is_reported(self) -> None:
        result = run_cost_stress(make_trades([100.0, -50.0] * 50, fee=10.0))
        assert any(p.multiple == 1.0 for p in result.points)

    def test_the_upper_bound_caveat_is_carried_with_the_result(self) -> None:
        """Scaling costs does not change which trades were taken."""
        result = run_cost_stress(make_trades([100.0, -50.0] * 50, fee=10.0))
        assert "upper bound" in result.to_dict()["note"]

    def test_no_trades_is_refused(self) -> None:
        with pytest.raises(ValueError, match="at least one trade"):
            run_cost_stress([])

    def test_the_fee_share_of_gross_is_reported(self) -> None:
        result = run_cost_stress(make_trades([100.0] * 50, fee=25.0))
        assert result.fee_share_of_gross == pytest.approx(0.2)
