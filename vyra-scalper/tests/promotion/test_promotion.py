"""The promotion gate and the ledger behind it.

Promotion is the only action in the platform that lets a strategy spend real money, so the
tests are mostly about the ways it could be granted when it should not be: on missing
evidence, by automation, against a failed assessment, or inherited by a strategy whose
parameters have since changed.

The last test asserts what this repository's state actually is: **nothing is promoted**.
"""

from __future__ import annotations

import pytest

from core.promotion import (
    PromotionEvidence,
    PromotionLedger,
    PromotionRequirements,
    assess,
)


def clearing_evidence(**overrides: object) -> PromotionEvidence:
    """Evidence that clears the bar, so a test can break exactly one thing."""
    fields: dict[str, object] = {
        "strategy_id": "vwap_mean_reversion",
        "strategy_version": "1.0.0",
        "config_hash": "sha256:cfg",
        "validation_passed": True,
        "validation_run_id": "run-123",
        "consecutive_clean_paper_days": 25,
        "paper_trades": 140,
        "paper_net_pnl": 1_050.0,
        "backtest_expected_pnl": 1_000.0,
        "unresolved_reconciliation_breaks": 0,
        "explicit_risk_limits": True,
        "kill_switch_armed": True,
    }
    fields.update(overrides)
    return PromotionEvidence(**fields)  # type: ignore[arg-type]


# --------------------------------------------------------------------------------------
# Missing evidence is a failure
# --------------------------------------------------------------------------------------


def test_empty_evidence_does_not_pass() -> None:
    """The default value of every field means "not measured", and that must not clear."""
    assessment = assess(
        PromotionEvidence(strategy_id="s", strategy_version="1.0.0", config_hash="c")
    )
    assert not assessment.approved
    assert len(assessment.missing) >= 6


@pytest.mark.parametrize(
    "field",
    [
        "validation_passed",
        "consecutive_clean_paper_days",
        "paper_trades",
        "unresolved_reconciliation_breaks",
        "explicit_risk_limits",
        "kill_switch_armed",
    ],
)
def test_any_single_unmeasured_requirement_blocks_promotion(field: str) -> None:
    """An unmeasured risk is not an absent one."""
    assessment = assess(clearing_evidence(**{field: None}))
    assert not assessment.approved
    assert any(field.split("_")[0] in m for m in assessment.missing)


def test_every_reason_is_returned_at_once() -> None:
    """An operator fixing one failure at a time, learning of the next only after a re-run,
    eventually stops reading the list."""
    assessment = assess(
        clearing_evidence(
            consecutive_clean_paper_days=2, paper_trades=5, explicit_risk_limits=False
        )
    )
    assert len(assessment.failures) >= 3


# --------------------------------------------------------------------------------------
# The bar
# --------------------------------------------------------------------------------------


def test_clearing_evidence_is_approved() -> None:
    """The bar has to be clearable, or it will be worked around."""
    assessment = assess(clearing_evidence())
    assert assessment.approved, assessment.failures + assessment.missing


def test_days_are_consecutive_not_cumulative() -> None:
    """A strategy that runs clean, breaks, and runs clean again has shown that it breaks."""
    assert not assess(clearing_evidence(consecutive_clean_paper_days=19)).approved
    assert assess(clearing_evidence(consecutive_clean_paper_days=20)).approved


def test_too_few_paper_trades_blocks_promotion() -> None:
    assessment = assess(clearing_evidence(paper_trades=40))
    assert not assessment.approved
    assert any("run of luck" in f for f in assessment.failures)


def test_paper_results_far_better_than_the_backtest_also_fail() -> None:
    """The asymmetry somebody will want to argue with.

    A paper result far above the backtest means the backtest is not modelling what
    happens — exactly as disqualifying as one far below it, and much easier to talk
    yourself into accepting.
    """
    assessment = assess(
        clearing_evidence(paper_net_pnl=5_000.0, backtest_expected_pnl=1_000.0)
    )
    assert not assessment.approved
    assert any("Better than expected is a failure too" in f for f in assessment.failures)


def test_an_unresolved_reconciliation_break_blocks_promotion() -> None:
    assessment = assess(clearing_evidence(unresolved_reconciliation_breaks=1))
    assert not assessment.approved
    assert any("nobody knows the size of" in f for f in assessment.failures)


def test_a_tripped_kill_switch_blocks_promotion() -> None:
    """Promoting while halted means promoting with nobody able to watch what happens."""
    assessment = assess(clearing_evidence(kill_switch_armed=False))
    assert not assessment.approved
    assert any("kill switch is tripped" in f for f in assessment.failures)


def test_a_validation_pass_with_no_run_behind_it_is_not_evidence() -> None:
    assessment = assess(clearing_evidence(validation_run_id=""))
    assert not assessment.approved
    assert any("cannot be checked" in m for m in assessment.missing)


def test_the_bar_can_be_raised_but_not_silently_lowered() -> None:
    """Requirements are configuration, so raising them is a reviewed diff."""
    strict = PromotionRequirements(min_consecutive_clean_days=60, min_paper_trades=500)
    assert not assess(clearing_evidence(), strict).approved


# --------------------------------------------------------------------------------------
# The ledger
# --------------------------------------------------------------------------------------


def test_a_promotion_against_a_failed_assessment_is_refused() -> None:
    """Not logged as an override. An override that is merely logged becomes routine."""
    ledger = PromotionLedger()
    failed = assess(clearing_evidence(paper_trades=1))
    with pytest.raises(ValueError, match="has not cleared the promotion bar"):
        ledger.promote(failed, approver="alice", reason="looks fine", config_hash="c")
    assert ledger.records == ()


@pytest.mark.parametrize("approver", ["system", "ci", "bot", "automation", "  ", "ADMIN"])
def test_automation_cannot_approve_a_promotion(approver: str) -> None:
    """An approval attributed to automation is an approval nobody made."""
    ledger = PromotionLedger()
    with pytest.raises(ValueError, match="not a person"):
        ledger.promote(
            assess(clearing_evidence()), approver=approver, reason="r", config_hash="c"
        )


def test_a_promotion_requires_a_reason() -> None:
    ledger = PromotionLedger()
    with pytest.raises(ValueError, match="requires a reason"):
        ledger.promote(
            assess(clearing_evidence()), approver="alice", reason="   ", config_hash="c"
        )


def test_a_promotion_records_who_when_and_on_what_evidence() -> None:
    ledger = PromotionLedger()
    record = ledger.promote(
        assess(clearing_evidence()),
        approver="alice",
        reason="cleared the bar on 25 clean days",
        config_hash="sha256:cfg",
    )
    assert record.approver == "alice"
    assert record.ts > 0
    assert record.evidence["evidence"]["consecutive_clean_paper_days"] == 25
    assert record.evidence["requirements"]["min_paper_trades"] == 100


def test_a_parameter_change_de_promotes_automatically() -> None:
    """The parameters are the strategy, and the evidence was about a particular set."""
    ledger = PromotionLedger()
    ledger.promote(
        assess(clearing_evidence()), approver="alice", reason="ok", config_hash="sha256:v1"
    )
    assert ledger.state("vwap_mean_reversion", "1.0.0", "sha256:v1").promoted
    assert not ledger.state("vwap_mean_reversion", "1.0.0", "sha256:v2").promoted
    assert not ledger.state("vwap_mean_reversion", "1.0.1", "sha256:v1").promoted


def test_demotion_needs_no_assessment() -> None:
    """Stopping is always allowed, in the same way the kill switch is always allowed to
    trip. The approver is still recorded: a demotion is also a decision."""
    ledger = PromotionLedger()
    ledger.promote(
        assess(clearing_evidence()), approver="alice", reason="ok", config_hash="c"
    )
    ledger.demote("vwap_mean_reversion", "1.0.0", "c", approver="bob", reason="drawdown")
    assert not ledger.state("vwap_mean_reversion", "1.0.0", "c").promoted
    assert [r.action for r in ledger.records] == ["PROMOTE", "DEMOTE"]


def test_the_ledger_is_append_only() -> None:
    """A promotion is never edited into a demotion; it is followed by one."""
    ledger = PromotionLedger()
    ledger.promote(
        assess(clearing_evidence()), approver="alice", reason="ok", config_hash="c"
    )
    ledger.demote("vwap_mean_reversion", "1.0.0", "c", approver="bob", reason="x")
    ledger.promote(
        assess(clearing_evidence()), approver="alice", reason="again", config_hash="c"
    )
    assert len(ledger.records) == 3
    assert ledger.state("vwap_mean_reversion", "1.0.0", "c").promoted


# --------------------------------------------------------------------------------------
# What is true of this repository today
# --------------------------------------------------------------------------------------


def test_nothing_in_this_repository_is_promoted() -> None:
    """The mechanism is built. It has not been used, and this asserts that.

    Promotion requires paper-trading evidence that cannot exist yet: there is no live feed,
    so there have been no paper-trading days at all, clean or otherwise.
    """
    assert PromotionLedger().promoted_strategies() == []


def test_the_shipped_strategies_have_no_paper_evidence(config_bundle) -> None:
    """Every configured strategy fails the bar for the same reason: nothing has run."""
    section = config_bundle["strategies"].section("strategies")
    for name in section:
        spec = section.section(name)
        assessment = assess(
            PromotionEvidence(
                strategy_id=name,
                strategy_version=spec.str_("version", "0.0.0"),
                config_hash=config_bundle.hash,
            )
        )
        assert not assessment.approved
        assert any("paper" in m for m in assessment.missing)
