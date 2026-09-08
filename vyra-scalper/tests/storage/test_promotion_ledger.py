"""The promotion ledger, durably.

A promotion that does not survive a restart is a promotion nobody can audit, which defeats
the entire purpose of recording who approved it. These run against a real PostgreSQL server.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

from core.promotion import PromotionEvidence, PromotionLedger, assess
from core.storage.sql_store import SqlStore

pytestmark = pytest.mark.skipif(
    not os.environ.get("VYRA_TEST_PG_DSN"), reason="VYRA_TEST_PG_DSN is not set"
)


def clearing_evidence() -> PromotionEvidence:
    return PromotionEvidence(
        strategy_id="vwap_mean_reversion",
        strategy_version="1.0.0",
        config_hash="sha256:cfg",
        validation_passed=True,
        validation_run_id="run-123",
        consecutive_clean_paper_days=25,
        paper_trades=140,
        paper_net_pnl=1_050.0,
        backtest_expected_pnl=1_000.0,
        unresolved_reconciliation_breaks=0,
        explicit_risk_limits=True,
        kill_switch_armed=True,
    )


@pytest.fixture
def clean_store(store: SqlStore, dsn: str) -> SqlStore:
    import psycopg

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE promotions")
        connection.commit()
    return store


def test_a_promotion_survives_a_restarted_process(clean_store: SqlStore, dsn: str) -> None:
    ledger = PromotionLedger(store=clean_store)
    ledger.promote(
        assess(clearing_evidence()),
        approver="alice",
        reason="cleared the bar",
        config_hash="sha256:cfg",
    )

    result = subprocess.run(
        [
            sys.executable, "-c",
            "import sys; sys.path.insert(0, '.');"
            "from core.storage import SqlStore;"
            "from core.promotion import PromotionLedger;"
            f"s = SqlStore({dsn!r}); s.connect();"
            "l = PromotionLedger(store=s);"
            "st = l.state('vwap_mean_reversion', '1.0.0', 'sha256:cfg');"
            "print(st.promoted, st.approver); s.close()",
        ],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "True alice"


def test_the_evidence_behind_a_decision_is_stored_with_it(clean_store: SqlStore) -> None:
    """"On what evidence" is half the point of the record."""
    ledger = PromotionLedger(store=clean_store)
    ledger.promote(
        assess(clearing_evidence()), approver="alice", reason="ok", config_hash="sha256:cfg"
    )

    reloaded = PromotionLedger(store=clean_store)
    record = reloaded.records[-1]
    assert record.evidence["evidence"]["paper_trades"] == 140
    assert record.evidence["requirements"]["min_consecutive_clean_days"] == 20


def test_a_demotion_after_a_promotion_wins(clean_store: SqlStore) -> None:
    ledger = PromotionLedger(store=clean_store)
    ledger.promote(
        assess(clearing_evidence()), approver="alice", reason="ok", config_hash="sha256:cfg"
    )
    ledger.demote(
        "vwap_mean_reversion", "1.0.0", "sha256:cfg", approver="bob", reason="drawdown"
    )

    reloaded = PromotionLedger(store=clean_store)
    assert not reloaded.state("vwap_mean_reversion", "1.0.0", "sha256:cfg").promoted
    assert reloaded.promoted_strategies() == []


def test_the_api_reads_promotion_state_from_the_ledger(
    dsn: str, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Not a hardcoded False.

    A field that is always false because nobody wired it up looks identical to one that is
    false because nothing cleared the bar — until the day somebody promotes something and
    the console still says no.
    """
    from apps.api.state import EngineState

    monkeypatch.setenv("VYRA_PG_DSN", dsn)
    monkeypatch.delenv("VYRA_REDIS_URL", raising=False)
    state = EngineState(config_dir="configs", runs_dir=tmp_path / "runs")

    version = (
        state.bundle["strategies"]
        .section("strategies")
        .section("vwap_mean_reversion")
        .str_("version", "0.0.0")
    )
    assert not state.promotions.state(
        "vwap_mean_reversion", version, state.bundle.hash
    ).promoted

    state.promotions.promote(
        assess(
            PromotionEvidence(
                strategy_id="vwap_mean_reversion",
                strategy_version=version,
                config_hash=state.bundle.hash,
                validation_passed=True,
                validation_run_id="run-1",
                consecutive_clean_paper_days=25,
                paper_trades=140,
                paper_net_pnl=1_050.0,
                backtest_expected_pnl=1_000.0,
                unresolved_reconciliation_breaks=0,
                explicit_risk_limits=True,
                kill_switch_armed=True,
            )
        ),
        approver="alice",
        reason="ledger wiring test",
        config_hash=state.bundle.hash,
    )
    assert state.promotions.state(
        "vwap_mean_reversion", version, state.bundle.hash
    ).promoted, "the API's ledger did not observe its own promotion"
