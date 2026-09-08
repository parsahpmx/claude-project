"""API contract tests.

The suite is organised around the three properties the service claims, not around its
routes: no credential leaves the process, nothing but health is reachable without a token,
and the kill switch can only be operated by an accountable operator. Route coverage is a
by-product — the credential test walks every GET endpoint the OpenAPI document declares, so
a new endpoint is covered the moment it is added rather than when someone remembers to.
"""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from apps.api.main import _configured_users, create_app
from apps.api.security import ALGORITHM, Principal, Role, resolve_secret
from apps.api.state import EngineState, strip_credentials
from tests.api.conftest import (
    CONFIG_DIR,
    SECRET,
    SENTINELS,
    auth,
    env_without,
    write_run,
)

# --------------------------------------------------------------------------------------
# Credentials
# --------------------------------------------------------------------------------------


def _walk(payload: Any) -> list[str]:
    """Every scalar in a response, as strings, so a sentinel cannot hide in a nested list."""
    if isinstance(payload, dict):
        found: list[str] = []
        for key, value in payload.items():
            found.append(str(key))
            found.extend(_walk(value))
        return found
    if isinstance(payload, list):
        return [item for value in payload for item in _walk(value)]
    return [str(payload)]


def _get_endpoints(client: TestClient) -> list[str]:
    """Concrete GET paths from the OpenAPI document, parameterised ones filled in."""
    document = client.get("/openapi.json").json()
    paths = []
    for path, operations in document["paths"].items():
        if "get" not in operations:
            continue
        paths.append(
            path.replace("{instrument_id}", "CME:MES").replace("{run_id}", "run-0001")
        )
    return sorted(paths)


def test_no_endpoint_returns_a_broker_credential(client: TestClient, runs_dir: Path) -> None:
    """The property the whole config path exists to guarantee.

    Sentinel values are injected through the same environment variables the shipped
    ``brokers.yaml`` interpolates, so this exercises the real configuration rather than a
    fixture that happens to be clean.
    """
    write_run(runs_dir)
    headers = auth(Role.ADMIN)
    checked = 0
    for path in _get_endpoints(client):
        response = client.get(path, headers=headers, params={"run_id": "run-0001"})
        assert response.status_code == 200, f"{path} -> {response.status_code}"
        body = response.text
        for name, sentinel in SENTINELS.items():
            assert sentinel not in body, f"{path} leaked {name}"
        checked += 1
    assert checked >= 10, "the endpoint walk found almost nothing; the extraction broke"


def test_config_keeps_operational_settings_while_dropping_credentials(
    client: TestClient,
) -> None:
    """Stripping must not be so blunt that the config response stops being useful.

    Symbol maps, capabilities and the risk account block are all things a dashboard needs;
    a filter that removed them would be quietly replaced by one that removes nothing.
    """
    payload = client.get("/config", headers=auth(Role.VIEWER)).json()["config"]
    brokers = payload["brokers"]["brokers"]
    assert "connection" not in brokers["ibkr"], "the connection block must go wholesale"
    assert brokers["ibkr"]["symbols"]["CME:MES"] == "MES", "symbol maps must survive"
    assert brokers["ibkr"]["capabilities"]["order_types"], "capabilities must survive"
    assert payload["risk"]["account"]["starting_equity"] == 100_000.0
    assert payload["sessions"], "session definitions must survive"


def test_strip_credentials_removes_nested_and_listed_secrets() -> None:
    payload = {
        "brokers": [
            {"name": "x", "connection": {"host": "h", "password": "p"}},
            {"name": "y", "api_token": "t", "symbols": {"A": "B"}},
        ],
        "auth": {"anything": "at all"},
        "keep": {"starting_equity": 1.0},
    }
    cleaned = strip_credentials(payload)
    flat = _walk(cleaned)
    assert "p" not in flat and "t" not in flat and "at all" not in flat
    assert "B" in flat and "1.0" in flat


def test_strip_credentials_handles_non_string_keys() -> None:
    """YAML gives ``datetime.date`` keys for a holiday calendar; ``.lower()`` would raise."""
    from datetime import date

    cleaned = strip_credentials({date(2026, 12, 25): "holiday", "password": "x"})
    assert cleaned == {date(2026, 12, 25): "holiday"}


def test_config_response_is_json_serialisable(state: EngineState) -> None:
    """Date keys must be canonicalised, or the response fails at serialisation instead."""
    json.dumps(state.safe_config())
    json.dumps(state.safe_config("sessions"))


def test_no_feed_attached_is_not_reported_as_healthy(client: TestClient) -> None:
    """"Nothing is subscribed" must not read as "everything is fine"."""
    body = client.get("/system/feed", headers=auth(Role.VIEWER)).json()
    assert body["attached"] is False
    assert body["state"] == "NOT_ATTACHED"
    assert "not a feed outage" in body["note"]
    assert client.get("/health").json()["feed"] == "NOT_ATTACHED"


def test_a_stale_feed_is_visibly_stale(api_env: None, runs_dir: Path) -> None:
    """The failure this endpoint exists for.

    A socket that is open but has stopped delivering is the dangerous case: every naive
    check calls it connected, and the engine would trade on a price that stopped updating.
    """

    class StaleFeed:
        def diagnostics(self) -> dict[str, Any]:
            return {"state": "STALE", "connected": True, "silence_ms": 45_000.0}

    state = EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir, feed=StaleFeed())
    with TestClient(create_app(state)) as client:
        body = client.get("/system/feed", headers=auth(Role.VIEWER)).json()
        assert body["state"] == "STALE"
        assert body["attached"] is True
        assert client.get("/health").json()["feed"] == "STALE"


def test_a_feed_that_cannot_answer_is_not_reported_healthy(
    api_env: None, runs_dir: Path
) -> None:
    """A health check that throws is not a passing health check."""

    class BrokenFeed:
        def diagnostics(self) -> dict[str, Any]:
            raise RuntimeError("transport is wedged")

    state = EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir, feed=BrokenFeed())
    with TestClient(create_app(state)) as client:
        body = client.get("/system/feed", headers=auth(Role.VIEWER)).json()
        assert body["state"] == "UNKNOWN"
        assert "wedged" in body["note"]


def test_feed_diagnostics_cannot_leak_a_venue_token(
    api_env: None, runs_dir: Path
) -> None:
    """The filter runs again at the boundary.

    The transport's own diagnostics already exclude its auth headers. This proves the
    guarantee does not depend on every upstream component remembering to.
    """

    class LeakyFeed:
        def diagnostics(self) -> dict[str, Any]:
            return {
                "state": "CONNECTED",
                "headers": {"Authorization": "Bearer SENTINEL-FEED-TOKEN"},
                "api_key": "SENTINEL-FEED-KEY",
                "connection": {"url": "wss://feed.example.com?key=SENTINEL-URL-KEY"},
                "silence_ms": 12.0,
            }

    state = EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir, feed=LeakyFeed())
    with TestClient(create_app(state)) as client:
        body = client.get("/system/feed", headers=auth(Role.VIEWER)).text
    assert "SENTINEL" not in body
    assert '"silence_ms":12.0' in body.replace(" ", ""), "the useful fields must survive"


# --------------------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------------------


def test_health_is_the_only_unauthenticated_endpoint(client: TestClient) -> None:
    open_paths = {"/health", "/", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}
    for path in _get_endpoints(client):
        response = client.get(path)
        if path in open_paths:
            assert response.status_code == 200, path
        else:
            assert response.status_code == 401, f"{path} answered without a token"


def test_health_exposes_no_position_or_pnl(client: TestClient) -> None:
    body = client.get("/health").json()
    assert set(body) == {
        "status",
        "uptime_seconds",
        "started_at",
        "config_hash",
        "instruments",
        "kill_switch",
        "runs_available",
        "feed",
    }


def test_token_round_trip(client: TestClient) -> None:
    response = client.post(
        "/auth/token", data={"username": "operator", "password": "operator-password-1"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "OPERATOR"
    assert body["token_type"] == "bearer"
    claims = jwt.decode(body["access_token"], SECRET, algorithms=[ALGORITHM])
    assert claims["sub"] == "operator"


@pytest.mark.parametrize(
    ("username", "password"),
    [("operator", "wrong-password"), ("nobody", "operator-password-1")],
)
def test_login_failures_are_indistinguishable(
    client: TestClient, username: str, password: str
) -> None:
    """An unknown user and a wrong password must answer identically.

    A message that distinguishes them turns the endpoint into an account enumerator.
    """
    response = client.post("/auth/token", data={"username": username, "password": password})
    assert response.status_code == 401
    assert response.json()["detail"] == "incorrect username or password"


def test_token_signed_with_another_secret_is_rejected(client: TestClient) -> None:
    forged = jwt.encode(
        {"sub": "attacker", "role": "ADMIN", "exp": datetime.now(UTC) + timedelta(hours=1)},
        "a-different-secret-of-sufficient-length-000000",
        algorithm=ALGORITHM,
    )
    response = client.get("/system/status", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401


def test_unsigned_token_is_rejected(client: TestClient) -> None:
    """``alg: none`` is the classic JWT bypass; the decoder pins HS256.

    Assembled by hand rather than with ``jwt.encode``, which refuses to mint one — the
    point is that a token an attacker *can* assemble is refused on the way in.
    """

    def segment(payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    unsigned = (
        f"{segment({'alg': 'none', 'typ': 'JWT'})}."
        f"{segment({'sub': 'attacker', 'role': 'ADMIN'})}."
    )
    response = client.get("/system/status", headers={"Authorization": f"Bearer {unsigned}"})
    assert response.status_code == 401


def test_expired_token_is_rejected(client: TestClient) -> None:
    expired = jwt.encode(
        {"sub": "viewer", "role": "VIEWER", "exp": datetime.now(UTC) - timedelta(minutes=1)},
        SECRET,
        algorithm=ALGORITHM,
    )
    response = client.get("/system/status", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_token_with_unknown_role_is_rejected(client: TestClient) -> None:
    """A valid signature is not authorisation: the role still has to exist."""
    token = jwt.encode(
        {"sub": "viewer", "role": "SUPERUSER", "exp": datetime.now(UTC) + timedelta(hours=1)},
        SECRET,
        algorithm=ALGORITHM,
    )
    response = client.get("/system/status", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_startup_refuses_a_missing_signing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """No default key. A service that starts with a known secret issues forgeable tokens."""
    env_without(monkeypatch, "VYRA_API_SECRET")
    with pytest.raises(RuntimeError, match="VYRA_API_SECRET is not set"), TestClient(
        create_app()
    ):
        pass


def test_startup_refuses_a_short_signing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VYRA_API_SECRET", "too-short")
    with pytest.raises(RuntimeError, match="at least 32"):
        resolve_secret()


def test_no_default_user_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    env_without(monkeypatch, "VYRA_API_USERS")
    assert _configured_users() == {}


def test_malformed_user_entry_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VYRA_API_USERS", "alice:password")
    with pytest.raises(RuntimeError, match="malformed"):
        _configured_users()


def test_an_empty_password_is_refused_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    """A blank password field opens the account rather than disabling it.

    ``compare_digest("", "")`` succeeds, so an entry left blank in the environment would
    authenticate anyone who submits an empty password. Startup refuses it instead.
    """
    monkeypatch.setenv("VYRA_API_USERS", "alice::ADMIN")
    with pytest.raises(RuntimeError, match="empty name or password"):
        _configured_users()


def test_unknown_role_in_user_entry_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VYRA_API_USERS", "alice:password:SUPERUSER")
    with pytest.raises(RuntimeError, match="unknown role"):
        _configured_users()


# --------------------------------------------------------------------------------------
# Authorisation
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("held", "required", "allowed"),
    [
        (Role.VIEWER, Role.VIEWER, True),
        (Role.VIEWER, Role.TRADER, False),
        (Role.VIEWER, Role.OPERATOR, False),
        (Role.TRADER, Role.VIEWER, True),
        (Role.TRADER, Role.OPERATOR, False),
        (Role.OPERATOR, Role.TRADER, True),
        (Role.OPERATOR, Role.OPERATOR, True),
        (Role.OPERATOR, Role.ADMIN, False),
        (Role.ADMIN, Role.OPERATOR, True),
        (Role.ADMIN, Role.ADMIN, True),
    ],
)
def test_role_hierarchy(held: Role, required: Role, allowed: bool) -> None:
    assert Principal("someone", held).can(required) is allowed


def test_viewer_cannot_trip_the_kill_switch(client: TestClient) -> None:
    response = client.post(
        "/kill-switch/trip", json={"reason": "test"}, headers=auth(Role.VIEWER)
    )
    assert response.status_code == 403
    assert client.get("/kill-switch", headers=auth(Role.VIEWER)).json()["is_tripped"] is False


def test_trader_cannot_trip_the_kill_switch(client: TestClient) -> None:
    response = client.post(
        "/kill-switch/trip", json={"reason": "test"}, headers=auth(Role.TRADER)
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------------------
# Kill switch
# --------------------------------------------------------------------------------------


def test_operator_trips_the_switch_and_health_degrades(client: TestClient) -> None:
    response = client.post(
        "/kill-switch/trip",
        json={"reason": "data feed suspect"},
        headers=auth(Role.OPERATOR, "alice"),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_tripped"] is True
    assert body["allows_new_entries"] is False
    assert "alice" in (body["detail"] or "")

    health = client.get("/health").json()
    assert health["status"] == "degraded"
    assert health["kill_switch"] == "TRIPPED"

    status_body = client.get("/system/status", headers=auth(Role.VIEWER)).json()
    assert any("HALTED" in warning for warning in status_body["warnings"])


def test_reset_records_the_token_identity_not_a_body_field(
    instant_reset_client: TestClient, instant_reset_state: EngineState
) -> None:
    """The operator on the audit record comes from the token.

    If the body could name the operator, a caller could attribute a resume to somebody
    else, and the trail the switch exists to produce would be worthless.
    """
    instant_reset_client.post(
        "/kill-switch/trip", json={"reason": "manual"}, headers=auth(Role.OPERATOR, "alice")
    )
    response = instant_reset_client.post(
        "/kill-switch/reset",
        json={"reason": "feed verified", "condition_cleared": True, "operator": "somebody-else"},
        headers=auth(Role.OPERATOR, "bob"),
    )
    assert response.status_code == 200
    assert response.json()["is_tripped"] is False
    record = instant_reset_state.kill_switch.history[-1]
    assert record.is_reset is True
    assert record.operator == "bob"
    assert "somebody-else" not in json.dumps(record.to_dict())


def test_reset_before_the_minimum_duration_is_a_conflict(client: TestClient) -> None:
    """The switch's refusal is the feature, so it surfaces as 409 rather than a 500."""
    client.post("/kill-switch/trip", json={"reason": "manual"}, headers=auth(Role.OPERATOR))
    response = client.post(
        "/kill-switch/reset",
        json={"reason": "looks fine", "condition_cleared": True},
        headers=auth(Role.OPERATOR),
    )
    assert response.status_code == 409
    assert client.get("/kill-switch", headers=auth(Role.VIEWER)).json()["is_tripped"] is True


def test_reset_without_clearing_the_condition_is_refused(
    instant_reset_client: TestClient,
) -> None:
    client = instant_reset_client
    client.post("/kill-switch/trip", json={"reason": "manual"}, headers=auth(Role.OPERATOR))
    response = client.post(
        "/kill-switch/reset",
        json={"reason": "resuming", "condition_cleared": False},
        headers=auth(Role.OPERATOR),
    )
    assert response.status_code == 409
    assert client.get("/kill-switch", headers=auth(Role.VIEWER)).json()["is_tripped"] is True


def test_resetting_an_untripped_switch_is_a_conflict(client: TestClient) -> None:
    response = client.post(
        "/kill-switch/reset",
        json={"reason": "nothing to do", "condition_cleared": True},
        headers=auth(Role.OPERATOR),
    )
    assert response.status_code == 409


def test_a_tripped_switch_survives_a_service_restart(
    api_env: None, runs_dir: Path
) -> None:
    """Restarting the API must not clear a halt.

    A switch that forgets on restart is one a crash-loop silently resets.
    """
    first = EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir)
    with TestClient(create_app(first)) as client:
        client.post(
            "/kill-switch/trip", json={"reason": "halt"}, headers=auth(Role.OPERATOR)
        )

    second = EngineState(config_dir=CONFIG_DIR, runs_dir=runs_dir)
    with TestClient(create_app(second)) as client:
        assert client.get("/health").json()["kill_switch"] == "TRIPPED"


def test_the_switch_persists_outside_the_runs_directory(
    api_env: None, tmp_path: Path
) -> None:
    """The API's own state does not live among the run artefacts.

    A deployment mounts the runs directory read-only — the record of what a run produced
    should not be alterable by the service that displays it — and the kill switch still has
    to be able to write, or a trip would fail exactly when it matters.
    """
    runs = tmp_path / "runs"
    runs.mkdir()
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    engine = EngineState(config_dir=CONFIG_DIR, runs_dir=runs, state_dir=state_dir)

    with TestClient(create_app(engine)) as client:
        response = client.post(
            "/kill-switch/trip", json={"reason": "halt"}, headers=auth(Role.OPERATOR)
        )
    assert response.status_code == 200
    assert (state_dir / "kill_switch_state.json").is_file()
    assert not (runs / "kill_switch_state.json").exists()


# --------------------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------------------


def test_markets_lists_the_registry_and_flags_cfd_depth(client: TestClient) -> None:
    markets = client.get("/markets", headers=auth(Role.VIEWER)).json()
    assert markets
    by_id = {m["instrument_id"]: m for m in markets}
    assert by_id["CME:MES"]["supports_exchange_depth"] is True
    cfds = [m for m in markets if m["instrument_id"].startswith("CFD:")]
    assert cfds, "the fixture config should contain CFDs"
    assert all(m["supports_exchange_depth"] is False for m in cfds), (
        "broker CFD depth is one dealer's quoting, not centralised liquidity"
    )


def test_unknown_instrument_is_404(client: TestClient) -> None:
    response = client.get("/markets/NOPE:NOPE", headers=auth(Role.VIEWER))
    assert response.status_code == 404


def test_strategies_report_enabled_and_promoted_separately(client: TestClient) -> None:
    """Enabled is a configuration fact; promoted is a validation result."""
    strategies = client.get("/strategies", headers=auth(Role.VIEWER)).json()
    assert strategies
    assert all(s["promoted"] is False for s in strategies), (
        "nothing has passed the validation pipeline, so nothing may report as promoted"
    )


def test_risk_limits_are_served_from_the_engine_config(
    client: TestClient, state: EngineState
) -> None:
    limits = client.get("/risk/limits", headers=auth(Role.VIEWER)).json()
    assert limits["max_risk_per_trade_pct"] == state.limits.max_risk_per_trade_pct
    assert limits["max_daily_loss_pct"] == state.limits.max_daily_loss_pct


def test_unknown_config_section_is_404(client: TestClient) -> None:
    response = client.get("/config", params={"section": "nope"}, headers=auth(Role.VIEWER))
    assert response.status_code == 404


def test_performance_keeps_gross_and_net_apart(client: TestClient, runs_dir: Path) -> None:
    """The distinction the platform exists to preserve must survive the API boundary."""
    write_run(runs_dir)
    body = client.get("/backtests/run-0001/performance", headers=auth(Role.VIEWER)).json()
    assert body["gross"]["total_pnl"] == 1500.0
    assert body["net"]["total_pnl"] == -120.0
    assert body["survives_costs"] is False
    assert body["costs"]["commission"] == 800.0


def test_run_listing_carries_the_dataset_warning(client: TestClient, runs_dir: Path) -> None:
    """A synthetic run must be labelled synthetic wherever it is displayed."""
    write_run(runs_dir)
    runs = client.get("/backtests", headers=auth(Role.VIEWER)).json()["runs"]
    assert runs[0]["run_id"] == "run-0001"
    assert any("SYNTHETIC" in w for w in runs[0]["warnings"])


def test_unknown_run_is_404(client: TestClient) -> None:
    response = client.get("/backtests/nope", headers=auth(Role.VIEWER))
    assert response.status_code == 404


def test_row_endpoints_are_bounded(client: TestClient, runs_dir: Path) -> None:
    """An unbounded equity curve is millions of rows and takes the service down."""
    write_run(runs_dir)
    headers = auth(Role.VIEWER)
    body = client.get(
        "/backtests/run-0001/equity", params={"limit": 5}, headers=headers
    ).json()
    assert body["count"] == 5
    over = client.get(
        "/backtests/run-0001/equity", params={"limit": 10_000}, headers=headers
    )
    assert over.status_code == 422


def test_the_equity_curve_is_sampled_across_the_whole_run(
    client: TestClient, runs_dir: Path
) -> None:
    """The head of the file is not the curve.

    A backtest writes an equity point per second; the first 500 of 410,000 points are all
    at the opening balance. Truncating would draw a flat line for a run that made and lost
    money, so the endpoint samples across the file and always includes the final point.
    """
    directory = write_run(runs_dir)
    rows = [{"ts": i, "equity": 100_000.0 + i} for i in range(5_000)]
    (directory / "equity.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    body = client.get(
        "/backtests/run-0001/equity", params={"limit": 100}, headers=auth(Role.VIEWER)
    ).json()

    assert body["total"] == 5_000, "the client must be told how much it is not seeing"
    assert body["count"] <= 100
    points = body["points"]
    assert points[0]["equity"] == 100_000.0
    assert points[-1]["equity"] == 100_000.0 + 4_999, "the curve must end where the run did"
    spread = points[-1]["ts"] - points[0]["ts"]
    assert spread == 4_999, "points must span the run, not cluster at its start"


def test_ledger_endpoints_report_the_total_they_truncated(
    client: TestClient, runs_dir: Path
) -> None:
    """A page of 500 rows out of an unknown number reads as a complete ledger."""
    write_run(runs_dir)
    body = client.get(
        "/trades", params={"run_id": "run-0001", "limit": 5}, headers=auth(Role.VIEWER)
    ).json()
    assert body["count"] == 5
    assert body["total"] == 20


def test_run_summaries_render_strategies_as_strings(
    client: TestClient, runs_dir: Path
) -> None:
    """The manifest records a strategy as an object; a summary row needs a string.

    Flattened by the API rather than by each client, because a client that rendered the
    object directly would print "[object Object]" — which is what happened before.
    """
    directory = write_run(runs_dir)
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest["strategies"] = [{"id": "vwap_mean_reversion", "version": "1.0.0"}]
    (directory / "manifest.json").write_text(json.dumps(manifest))

    runs = client.get("/backtests", headers=auth(Role.VIEWER)).json()["runs"]
    assert runs[0]["strategies"] == ["vwap_mean_reversion@1.0.0"]

    detail = client.get("/backtests/run-0001", headers=auth(Role.VIEWER)).json()
    assert detail["manifest"]["strategies"] == [
        {"id": "vwap_mean_reversion", "version": "1.0.0"}
    ], "the detail endpoint keeps the manifest as written"


def test_rows_for_an_unknown_run_are_empty_not_an_error(client: TestClient) -> None:
    body = client.get("/trades", params={"run_id": "nope"}, headers=auth(Role.VIEWER)).json()
    assert body["trades"] == []


def test_positions_are_empty_and_say_why(client: TestClient) -> None:
    """No live trader is attached; a backtest's last position is not a held position."""
    body = client.get("/positions", headers=auth(Role.VIEWER)).json()
    assert body["positions"] == []
    assert "not a held position" in body["note"]


def test_an_unreadable_run_does_not_break_the_listing(
    client: TestClient, runs_dir: Path
) -> None:
    write_run(runs_dir)
    broken = runs_dir / "run-broken"
    broken.mkdir()
    (broken / "manifest.json").write_text("{not json")
    (broken / "metrics.json").write_text("{}")
    runs = client.get("/backtests", headers=auth(Role.VIEWER)).json()["runs"]
    assert [r["run_id"] for r in runs] == ["run-0001"]


def test_sessions_report_state_per_instrument(client: TestClient) -> None:
    body = client.get("/sessions", headers=auth(Role.VIEWER)).json()
    entry = body["instruments"]["CME:MES"]
    assert set(entry) == {
        "session_id",
        "is_open",
        "state",
        "trading_date",
        "blocked_window",
    }


def test_openapi_document_builds(client: TestClient) -> None:
    """A dashboard is generated against it; a schema error here is a broken client."""
    document = client.get("/openapi.json").json()
    assert document["info"]["title"] == "VYRA Scalper Engine API"
    assert "/kill-switch/trip" in document["paths"]
