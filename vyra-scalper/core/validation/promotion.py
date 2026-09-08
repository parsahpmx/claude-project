"""The promotion gate.

The single decision this platform exists to make: may a strategy be deployed?

The answer is **no by default**. Every criterion in ``BACKTEST_SPEC.md`` §8 must pass, and
a criterion that could not be evaluated counts as a failure rather than a pass — an
unmeasured risk is not an absent one. The gate returns the reasons, so a rejection is
actionable and an approval is auditable.

Nothing here looks at gross PnL. A strategy that is profitable before costs and not after
is not a strategy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.analytics.metrics import PerformanceReport
from core.events import FillModel
from core.validation.monte_carlo import MonteCarloResult
from core.validation.sensitivity import PlateauResult

__all__ = ["PromotionCriteria", "PromotionDecision", "PromotionGate", "evaluate_promotion"]


@dataclass(frozen=True, slots=True)
class PromotionCriteria:
    """The bar a strategy must clear. Every value is configuration.

    Defaults are deliberately demanding. A gate that most candidates pass is not a gate.
    """

    min_oos_trades: int = 100
    min_oos_sharpe: float = 0.5
    min_oos_expectancy: float = 0.0
    min_cost_headroom: float = 1.5
    min_plateau_fraction: float = 0.3
    max_peak_to_plateau_ratio: float = 2.0
    min_walk_forward_win_rate: float = 0.5
    max_probability_of_ruin: float = 0.05
    max_drawdown_understatement: float = 2.0
    min_profitable_regimes: int = 1
    require_realistic_fills: bool = True

    @classmethod
    def from_config(cls, section: Any) -> PromotionCriteria:
        return cls(
            min_oos_trades=section.int_("min_oos_trades", 100),
            min_oos_sharpe=section.float_("min_oos_sharpe", 0.5),
            min_oos_expectancy=section.float_("min_oos_expectancy", 0.0),
            min_cost_headroom=section.float_("min_cost_headroom", 1.5),
            min_plateau_fraction=section.float_("min_plateau_fraction", 0.3),
            max_peak_to_plateau_ratio=section.float_("max_peak_to_plateau_ratio", 2.0),
            min_walk_forward_win_rate=section.float_("min_walk_forward_win_rate", 0.5),
            max_probability_of_ruin=section.float_("max_probability_of_ruin", 0.05),
            max_drawdown_understatement=section.float_("max_drawdown_understatement", 2.0),
            min_profitable_regimes=section.int_("min_profitable_regimes", 1),
            require_realistic_fills=section.bool_("require_realistic_fills", True),
        )


@dataclass(frozen=True, slots=True)
class PromotionDecision:
    """Approved or not, and exactly why."""

    strategy_id: str
    approved: bool
    failures: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def summary(self) -> str:
        if self.approved:
            return f"{self.strategy_id}: APPROVED for promotion"
        return (
            f"{self.strategy_id}: NOT APPROVED — "
            f"{len(self.failures)} criteria failed"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "approved": self.approved,
            "failures": list(self.failures),
            "warnings": list(self.warnings),
            "evidence": self.evidence,
        }

    def render(self) -> str:
        """A human-readable verdict, failures first."""
        lines = [self.summary, ""]
        if self.failures:
            lines.append("Failed criteria:")
            lines.extend(f"  ✗ {failure}" for failure in self.failures)
            lines.append("")
        if self.warnings:
            lines.append("Warnings:")
            lines.extend(f"  ! {warning}" for warning in self.warnings)
            lines.append("")
        if self.evidence:
            lines.append("Evidence:")
            lines.extend(f"  {k}: {v}" for k, v in sorted(self.evidence.items()))
        return "\n".join(lines)


class PromotionGate:
    """Evaluates a strategy against every promotion criterion."""

    __slots__ = ("_criteria",)

    def __init__(self, criteria: PromotionCriteria | None = None) -> None:
        self._criteria = criteria or PromotionCriteria()

    @property
    def criteria(self) -> PromotionCriteria:
        return self._criteria

    def evaluate(
        self,
        strategy_id: str,
        *,
        out_of_sample: PerformanceReport | None,
        fill_model: FillModel | None = None,
        walk_forward: list[PerformanceReport] | None = None,
        monte_carlo: MonteCarloResult | None = None,
        plateaus: list[PlateauResult] | None = None,
    ) -> PromotionDecision:
        """Decide whether ``strategy_id`` may be promoted.

        Missing evidence is a **failure**, not a pass: a strategy that has not been
        walk-forward tested has not been shown to work out of sample more than once, and
        the honest verdict on an unmeasured risk is that it is unmeasured.
        """
        criteria = self._criteria
        failures: list[str] = []
        warnings: list[str] = []
        evidence: dict[str, Any] = {}

        if out_of_sample is None:
            return PromotionDecision(
                strategy_id=strategy_id,
                approved=False,
                failures=("NO_OUT_OF_SAMPLE_RESULT: nothing has been measured",),
            )

        self._check_out_of_sample(out_of_sample, criteria, failures, evidence)
        self._check_fill_model(fill_model, criteria, failures, evidence)
        self._check_walk_forward(walk_forward, criteria, failures, evidence)
        self._check_monte_carlo(monte_carlo, criteria, failures, evidence)
        self._check_plateaus(plateaus, criteria, failures, warnings, evidence)
        self._check_regimes(out_of_sample, criteria, failures, warnings, evidence)

        for warning in out_of_sample.implausibility_warnings:
            warnings.append(f"IMPLAUSIBLE_RESULT: {warning}")

        return PromotionDecision(
            strategy_id=strategy_id,
            approved=not failures,
            failures=tuple(failures),
            warnings=tuple(warnings),
            evidence=evidence,
        )

    # -- individual criteria -------------------------------------------------------------

    @staticmethod
    def _check_out_of_sample(
        report: PerformanceReport,
        criteria: PromotionCriteria,
        failures: list[str],
        evidence: dict[str, Any],
    ) -> None:
        net = report.net
        evidence["oos_trades"] = net.trade_count
        evidence["oos_net_pnl"] = round(net.total_pnl, 2)
        evidence["oos_expectancy"] = round(net.expectancy, 4)
        evidence["oos_sharpe"] = round(net.sharpe, 4)
        evidence["cost_headroom"] = report.cost_headroom

        if net.trade_count < criteria.min_oos_trades:
            failures.append(
                f"MIN_OOS_TRADES: {net.trade_count} trades is below the required "
                f"{criteria.min_oos_trades}. An unmeasurable result is not a good one."
            )
        if net.expectancy <= criteria.min_oos_expectancy:
            failures.append(
                f"OOS_EXPECTANCY: {net.expectancy:.4f} after costs is not above "
                f"{criteria.min_oos_expectancy}."
            )
        if net.sharpe < criteria.min_oos_sharpe:
            failures.append(
                f"MIN_OOS_SHARPE: {net.sharpe:.4f} is below the required "
                f"{criteria.min_oos_sharpe}."
            )
        headroom = report.cost_headroom
        if headroom is None:
            failures.append(
                "COST_HEADROOM: undefined because the strategy is not profitable after "
                "costs."
            )
        elif headroom < criteria.min_cost_headroom:
            failures.append(
                f"MIN_COST_HEADROOM: {headroom:.2f}x is below the required "
                f"{criteria.min_cost_headroom}x. There is no margin for real-world cost "
                "drift."
            )

    @staticmethod
    def _check_fill_model(
        fill_model: FillModel | None,
        criteria: PromotionCriteria,
        failures: list[str],
        evidence: dict[str, Any],
    ) -> None:
        if not criteria.require_realistic_fills:
            return
        evidence["fill_model"] = fill_model.value if fill_model else None
        if fill_model is None:
            failures.append("FILL_MODEL: not recorded, so the result cannot be trusted.")
        elif not fill_model.allowed_for_promotion:
            failures.append(
                f"FILL_MODEL: {fill_model.value} assumes limit orders fill on touch and "
                "is blocked from supporting a promotion decision."
            )

    @staticmethod
    def _check_walk_forward(
        walk_forward: list[PerformanceReport] | None,
        criteria: PromotionCriteria,
        failures: list[str],
        evidence: dict[str, Any],
    ) -> None:
        if not walk_forward:
            failures.append(
                "NO_WALK_FORWARD: the strategy has not been shown to work out of sample "
                "more than once."
            )
            return
        profitable = sum(1 for r in walk_forward if r.net.total_pnl > 0)
        win_rate = profitable / len(walk_forward)
        evidence["walk_forward_windows"] = len(walk_forward)
        evidence["walk_forward_win_rate"] = round(win_rate, 4)
        evidence["walk_forward_pnls"] = [round(r.net.total_pnl, 2) for r in walk_forward]

        if win_rate < criteria.min_walk_forward_win_rate:
            failures.append(
                f"WALK_FORWARD_CONSISTENCY: profitable in {profitable} of "
                f"{len(walk_forward)} windows ({win_rate:.0%}), below the required "
                f"{criteria.min_walk_forward_win_rate:.0%}. Consistency matters more than "
                "the aggregate."
            )

    @staticmethod
    def _check_monte_carlo(
        monte_carlo: MonteCarloResult | None,
        criteria: PromotionCriteria,
        failures: list[str],
        evidence: dict[str, Any],
    ) -> None:
        if monte_carlo is None:
            failures.append(
                "NO_MONTE_CARLO: the realised path is one draw, and its drawdown has not "
                "been tested against plausible reorderings."
            )
            return
        evidence["probability_of_ruin"] = round(monte_carlo.probability_of_ruin, 6)
        evidence["drawdown_p95"] = round(monte_carlo.drawdown_p95, 2)
        evidence["drawdown_understatement"] = round(monte_carlo.drawdown_understatement, 4)

        if monte_carlo.probability_of_ruin > criteria.max_probability_of_ruin:
            failures.append(
                f"PROBABILITY_OF_RUIN: {monte_carlo.probability_of_ruin:.1%} exceeds the "
                f"permitted {criteria.max_probability_of_ruin:.1%} at a "
                f"{monte_carlo.ruin_threshold_pct:.0%} drawdown."
            )
        if monte_carlo.drawdown_understatement > criteria.max_drawdown_understatement:
            failures.append(
                f"DRAWDOWN_UNDERSTATED: the 95th-percentile resampled drawdown is "
                f"{monte_carlo.drawdown_understatement:.2f}x the realised one. The "
                "backtest's drawdown owes too much to ordering luck."
            )

    @staticmethod
    def _check_plateaus(
        plateaus: list[PlateauResult] | None,
        criteria: PromotionCriteria,
        failures: list[str],
        warnings: list[str],
        evidence: dict[str, Any],
    ) -> None:
        if not plateaus:
            failures.append(
                "NO_SENSITIVITY_ANALYSIS: the chosen parameters have not been shown to sit "
                "in a profitable region rather than on a lucky point."
            )
            return
        evidence["plateaus"] = [p.to_dict() for p in plateaus]
        for plateau in plateaus:
            # Two distinct failures, reported distinctly. Collapsing them produced the
            # self-contradictory "spans 33% of the range, below the required 30%".
            if not plateau.is_plateau:
                failures.append(
                    f"PARAMETER_PLATEAU[{plateau.parameter}]: only "
                    f"{len(plateau.plateau_values)} of {plateau.swept_count} swept values "
                    "were profitable, so the best value is an isolated point rather than a "
                    "region. A peak surrounded by losses is noise."
                )
            elif plateau.plateau_fraction < criteria.min_plateau_fraction:
                failures.append(
                    f"PARAMETER_PLATEAU[{plateau.parameter}]: the profitable region spans "
                    f"{plateau.plateau_fraction:.0%} of the swept range, below the required "
                    f"{criteria.min_plateau_fraction:.0%}."
                )
            elif plateau.peak_to_plateau_ratio > criteria.max_peak_to_plateau_ratio:
                warnings.append(
                    f"PEAK_ABOVE_NEIGHBOURHOOD[{plateau.parameter}]: the best value scores "
                    f"{plateau.peak_to_plateau_ratio:.2f}x its own plateau mean. Prefer a "
                    "value nearer the plateau centre."
                )

    @staticmethod
    def _check_regimes(
        report: PerformanceReport,
        criteria: PromotionCriteria,
        failures: list[str],
        warnings: list[str],
        evidence: dict[str, Any],
    ) -> None:
        by_regime = report.by_regime
        if not by_regime:
            warnings.append(
                "NO_REGIME_ATTRIBUTION: PnL was not broken down by regime, so a strategy "
                "that works in only one cannot be distinguished from one that generalises."
            )
            return
        profitable = [regime for regime, pnl in by_regime.items() if pnl > 0]
        evidence["profitable_regimes"] = sorted(profitable)
        evidence["pnl_by_regime"] = {k: round(v, 2) for k, v in sorted(by_regime.items())}

        if len(profitable) < criteria.min_profitable_regimes:
            failures.append(
                f"REGIME_COVERAGE: profitable in {len(profitable)} regimes, below the "
                f"required {criteria.min_profitable_regimes}."
            )
        elif len(by_regime) > 1 and len(profitable) == 1:
            warnings.append(
                f"SINGLE_REGIME: profitable only in {profitable[0]}. Gate the strategy to "
                "that regime explicitly, or treat the result as regime-specific."
            )


def evaluate_promotion(
    strategy_id: str,
    out_of_sample: PerformanceReport | None,
    **evidence: Any,
) -> PromotionDecision:
    """Convenience wrapper around :meth:`PromotionGate.evaluate` with default criteria."""
    return PromotionGate().evaluate(strategy_id, out_of_sample=out_of_sample, **evidence)
