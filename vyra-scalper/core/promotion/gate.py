"""The bar a strategy clears before it may trade real money.

Every requirement here is a **precondition**, not a score. There is no weighted total that
lets a strong walk-forward result compensate for an unresolved reconciliation break, because
those two things are not commensurable and a number that pretends they are is a number
somebody will optimise.

**Missing evidence is a failure.** The same rule the validation gate already applies: a
requirement nobody measured is not a requirement nobody violated. An unmeasured risk is not
an absent one.

The bar itself, and why each part of it:

* **The validation pipeline passed.** Walk-forward, Monte Carlo, parameter plateau, cost
  stress. Without it there is no evidence the strategy has an edge at all.
* **Consecutive clean paper days.** Not cumulative days — *consecutive*. A strategy that
  runs clean for nineteen days, breaks, and runs clean for nineteen more has demonstrated
  that it breaks. The counter resets.
* **Enough paper trades.** Twenty clean days of two trades a day is forty trades, which
  cannot distinguish an edge from a run of luck.
* **Paper results consistent with the backtest.** A paper result far better than the
  backtest is as much of a red flag as one far worse: it means the backtest is not modelling
  what actually happens.
* **No unresolved reconciliation breaks.** A position the engine and the venue disagree
  about is a position nobody knows the size of.
* **Explicit risk limits.** Not inherited defaults. Somebody decided what this strategy may
  lose.
* **A named human approver.** Recorded, and never a service account.
* **The kill switch armed.** Promoting while trading is halted means promoting without
  anybody able to watch what happens next.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.util.logging import get_logger

__all__ = [
    "PromotionAssessment",
    "PromotionEvidence",
    "PromotionRequirements",
    "assess",
]

_log = get_logger("promotion.gate")


@dataclass(frozen=True, slots=True)
class PromotionRequirements:
    """The bar. Configuration, so it can be raised — and a change is a reviewed diff."""

    min_consecutive_clean_days: int = 20
    min_paper_trades: int = 100
    max_backtest_divergence_pct: float = 0.50
    require_validation_pass: bool = True
    require_zero_reconciliation_breaks: bool = True
    require_explicit_risk_limits: bool = True
    require_armed_kill_switch: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "min_consecutive_clean_days": self.min_consecutive_clean_days,
            "min_paper_trades": self.min_paper_trades,
            "max_backtest_divergence_pct": self.max_backtest_divergence_pct,
            "require_validation_pass": self.require_validation_pass,
            "require_zero_reconciliation_breaks": self.require_zero_reconciliation_breaks,
            "require_explicit_risk_limits": self.require_explicit_risk_limits,
            "require_armed_kill_switch": self.require_armed_kill_switch,
        }


@dataclass(slots=True)
class PromotionEvidence:
    """What is known about a strategy's readiness.

    Every field defaults to the value that means "not measured", and every one of those is
    a failure. That is deliberate: an empty evidence object must not pass.
    """

    strategy_id: str
    strategy_version: str
    config_hash: str
    validation_passed: bool | None = None
    validation_run_id: str = ""
    consecutive_clean_paper_days: int | None = None
    paper_trades: int | None = None
    paper_net_pnl: float | None = None
    backtest_expected_pnl: float | None = None
    unresolved_reconciliation_breaks: int | None = None
    explicit_risk_limits: bool | None = None
    kill_switch_armed: bool | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "config_hash": self.config_hash,
            "validation_passed": self.validation_passed,
            "validation_run_id": self.validation_run_id,
            "consecutive_clean_paper_days": self.consecutive_clean_paper_days,
            "paper_trades": self.paper_trades,
            "paper_net_pnl": self.paper_net_pnl,
            "backtest_expected_pnl": self.backtest_expected_pnl,
            "unresolved_reconciliation_breaks": self.unresolved_reconciliation_breaks,
            "explicit_risk_limits": self.explicit_risk_limits,
            "kill_switch_armed": self.kill_switch_armed,
            "notes": list(self.notes),
        }


@dataclass(slots=True)
class PromotionAssessment:
    """Whether the bar is cleared, and every reason it is not."""

    strategy_id: str
    strategy_version: str
    approved: bool
    failures: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    requirements: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "approved": self.approved,
            "failures": list(self.failures),
            "missing": list(self.missing),
            "evidence": dict(self.evidence),
            "requirements": dict(self.requirements),
        }


def assess(
    evidence: PromotionEvidence, requirements: PromotionRequirements | None = None
) -> PromotionAssessment:
    """Check the evidence against the bar. Never raises; returns every reason at once.

    Returning all of them rather than the first is deliberate: an operator fixing one
    failure at a time, learning about the next only after a re-run, will eventually stop
    reading the list.
    """
    bar = requirements or PromotionRequirements()
    failures: list[str] = []
    missing: list[str] = []

    def require(value: object, name: str, description: str) -> bool:
        if value is None:
            missing.append(f"{name}: {description} was never measured")
            return False
        return True

    if bar.require_validation_pass and require(
        evidence.validation_passed, "validation", "the validation pipeline"
    ):
        if not evidence.validation_passed:
                failures.append(
                "the validation pipeline did not pass this strategy"
                + (f" (run {evidence.validation_run_id})" if evidence.validation_run_id else "")
            )
        elif not evidence.validation_run_id:
            missing.append(
                "validation_run_id: a pass with no run behind it cannot be checked"
            )

    if require(
        evidence.consecutive_clean_paper_days, "paper_days", "consecutive clean paper days"
    ):
        days = int(evidence.consecutive_clean_paper_days or 0)
        if days < bar.min_consecutive_clean_days:
            failures.append(
                f"{days} consecutive clean paper days, {bar.min_consecutive_clean_days} "
                "required. Consecutive, not cumulative: a strategy that breaks and "
                "recovers has demonstrated that it breaks"
            )

    if require(evidence.paper_trades, "paper_trades", "the paper trade count"):
        trades = int(evidence.paper_trades or 0)
        if trades < bar.min_paper_trades:
            failures.append(
                f"{trades} paper trades, {bar.min_paper_trades} required to distinguish "
                "an edge from a run of luck"
            )

    if evidence.paper_net_pnl is None or evidence.backtest_expected_pnl is None:
        missing.append(
            "paper_vs_backtest: paper and backtest results were not compared, so nobody "
            "has checked whether the backtest models what actually happens"
        )
    else:
        expected = evidence.backtest_expected_pnl
        if expected == 0:
            missing.append(
                "backtest_expected_pnl is zero; there is nothing to compare paper against"
            )
        else:
            divergence = abs(evidence.paper_net_pnl - expected) / abs(expected)
            if divergence > bar.max_backtest_divergence_pct:
                # Better than expected fails too. A paper result far above the backtest
                # means the backtest is not modelling what happens, which is exactly as
                # disqualifying as one far below it.
                failures.append(
                    f"paper results diverge from the backtest by {divergence:.0%}, above "
                    f"the {bar.max_backtest_divergence_pct:.0%} tolerance. Better than "
                    "expected is a failure too: it means the backtest is wrong"
                )

    if bar.require_zero_reconciliation_breaks and require(
        evidence.unresolved_reconciliation_breaks,
        "reconciliation",
        "unresolved reconciliation breaks",
    ):
        breaks = int(evidence.unresolved_reconciliation_breaks or 0)
        if breaks > 0:
            failures.append(
                f"{breaks} unresolved reconciliation break(s): a position the engine and "
                "the venue disagree about is a position nobody knows the size of"
            )

    if bar.require_explicit_risk_limits and require(
        evidence.explicit_risk_limits, "risk_limits", "explicit per-strategy risk limits"
    ) and not evidence.explicit_risk_limits:
        failures.append(
            "no explicit risk limits for this strategy; inherited defaults mean nobody "
            "decided what it may lose"
        )

    if bar.require_armed_kill_switch and require(
        evidence.kill_switch_armed, "kill_switch", "the kill switch state"
    ) and not evidence.kill_switch_armed:
        failures.append(
            "the kill switch is tripped; promoting while trading is halted means "
            "promoting without anybody able to watch what happens next"
        )

    approved = not failures and not missing
    assessment = PromotionAssessment(
        strategy_id=evidence.strategy_id,
        strategy_version=evidence.strategy_version,
        approved=approved,
        failures=failures,
        missing=missing,
        evidence=evidence.to_dict(),
        requirements=bar.to_dict(),
    )
    _log.info(
        "promotion_assessed",
        strategy=evidence.strategy_id,
        version=evidence.strategy_version,
        approved=approved,
        failures=len(failures),
        missing=len(missing),
    )
    return assessment
