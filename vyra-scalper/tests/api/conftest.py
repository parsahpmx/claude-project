"""Fixtures for the API tests.

The tests run against the *shipped* configuration rather than a fixture config, because
the property that matters most here — no broker credential can reach a client — is a
property of the real ``configs/`` tree. Credential values are injected through the same
environment variables the YAML interpolates, so the test exercises the deployment shape.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("fastapi", reason="the API extra is not installed")
pytest.importorskip("jose", reason="the API extra is not installed")
pytest.importorskip("multipart", reason="python-multipart is not installed")

from fastapi.testclient import TestClient

from apps.api.main import create_app
from apps.api.security import Role, create_access_token
from apps.api.state import EngineState
from core.risk.kill_switch import EmergencyPolicy, KillSwitch

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "configs"

SECRET = "test-signing-secret-of-sufficient-length-0123456789"

# Sentinel credentials pushed into the shipped config through its own ${VAR} interpolation.
# Every one of these strings must be absent from every response body.
SENTINELS = {
    "IBKR_ACCOUNT": "SENTINEL-IBKR-ACCOUNT-U1234567",
    "IBKR_CLIENT_ID": "SENTINEL-IBKR-CLIENT-ID-991",
    "MT5_LOGIN": "SENTINEL-MT5-LOGIN-70051234",
    "MT5_PASSWORD": "SENTINEL-MT5-PASSWORD-hunter2",
    "MT5_SERVER": "SENTINEL-MT5-SERVER-broker-live-07",
    "OANDA_ACCOUNT_ID": "SENTINEL-OANDA-ACCOUNT-001-002-33",
    "OANDA_API_TOKEN": "SENTINEL-OANDA-API-TOKEN-abcdef",
}

USERS = {
    "viewer": ("viewer-password-1", Role.VIEWER),
    "trader": ("trader-password-1", Role.TRADER),
    "operator": ("operator-password-1", Role.OPERATOR),
    "admin": ("admin-password-1", Role.ADMIN),
}

_USERS_ENV = ",".join(f"{n}:{p}:{r.value}" for n, (p, r) in USERS.items())


@pytest.fixture
def api_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VYRA_API_SECRET", SECRET)
    monkeypatch.setenv("VYRA_API_USERS", _USERS_ENV)
    for name, value in SENTINELS.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
def runs_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "runs"
    directory.mkdir()
    return directory


@pytest.fixture
def state(api_env: None, runs_dir: Path) -> EngineState:
    return EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir)


@pytest.fixture
def client(state: EngineState) -> Iterator[TestClient]:
    with TestClient(create_app(state)) as test_client:
        yield test_client


@pytest.fixture
def instant_reset_state(api_env: None, runs_dir: Path) -> EngineState:
    """A state whose switch has no minimum trip duration.

    The duration guard has a test of its own; tests about *who* may reset, and about what
    the audit record says, should not have to wait it out.
    """
    switch = KillSwitch(
        emergency_policy=EmergencyPolicy.HOLD,
        min_trip_seconds=0.0,
        state_file=runs_dir / "kill_switch_state.json",
    )
    return EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir, kill_switch=switch)


@pytest.fixture
def instant_reset_client(instant_reset_state: EngineState) -> Iterator[TestClient]:
    with TestClient(create_app(instant_reset_state)) as test_client:
        yield test_client


def auth(role: Role, subject: str | None = None) -> dict[str, str]:
    """Authorization header for a principal holding ``role``."""
    token = create_access_token(subject or role.value.lower(), role)
    return {"Authorization": f"Bearer {token}"}


def write_run(runs_dir: Path, run_id: str = "run-0001") -> Path:
    """A completed run on disk, shaped like the runner's output."""
    directory = runs_dir / run_id
    directory.mkdir(parents=True)
    manifest: dict[str, Any] = {
        "run_id": run_id,
        "created_at": "2026-01-02T00:00:00+00:00",
        "mode": "BACKTEST",
        "strategies": ["orb_breakout"],
        "instruments": ["CME:MES"],
        "fill_model": "REALISTIC",
        "is_reproducible": True,
        "result_hash": "sha256:deadbeef",
        "warnings": ["DATASET: SYNTHETIC data — results are not evidence of edge"],
        "config_hash": "sha256:cafe",
        "master_seed": 7,
    }
    metrics: dict[str, Any] = {
        "gross": {"total_pnl": 1500.0, "trade_count": 40, "sharpe": 2.1},
        "net": {"total_pnl": -120.0, "trade_count": 40, "sharpe": -0.3},
        "costs": {"commission": 800.0, "spread": 500.0, "slippage": 320.0},
        "survives_costs": False,
        "implausibility_warnings": [],
        "pnl_by_instrument": {"CME:MES": -120.0},
        "pnl_by_strategy": {"orb_breakout": -120.0},
        "pnl_by_regime": {"TREND": -120.0},
    }
    (directory / "manifest.json").write_text(json.dumps(manifest))
    (directory / "metrics.json").write_text(json.dumps(metrics))
    for name, rows in (
        ("trades.jsonl", [{"trade_id": f"t{i}", "gross_pnl": 1.0, "net_pnl": -0.5} for i in range(20)]),
        ("orders.jsonl", [{"order_id": f"o{i}"} for i in range(20)]),
        ("fills.jsonl", [{"fill_id": f"f{i}"} for i in range(20)]),
        ("equity.jsonl", [{"ts": i, "equity": 100_000.0 - i} for i in range(20)]),
        ("risk_events.jsonl", [{"decision": "APPROVED"} for _ in range(20)]),
    ):
        (directory / name).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return directory


def env_without(monkeypatch: pytest.MonkeyPatch, *names: str) -> None:
    for name in names:
        monkeypatch.delenv(name, raising=False)
    assert all(name not in os.environ for name in names)
