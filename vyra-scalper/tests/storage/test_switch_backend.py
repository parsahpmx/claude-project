"""The kill switch with its state in PostgreSQL rather than on disk.

What must survive the move: every rule the switch owns. The minimum trip duration, the
refusal to reset without an operator, the absence of a force flag, and the full audit trail
are all properties of the switch, not of where its bytes live — so the same tests that hold
for the file-backed switch have to hold here, and the interesting new question is what
happens when the store is unreadable.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

from core.risk.kill_switch import (
    EmergencyPolicy,
    KillSwitch,
    KillSwitchState,
    Trigger,
)
from core.storage.sql_store import SqlStore, StoreUnavailable
from core.storage.switch_backend import SqlSwitchBackend

pytestmark = pytest.mark.skipif(
    not os.environ.get("VYRA_TEST_PG_DSN"), reason="VYRA_TEST_PG_DSN is not set"
)


def test_two_stores_are_refused(store: SqlStore, tmp_path) -> None:
    """A file *and* a database is two places to disagree.

    They would be discovered disagreeing on a restart, which is the worst moment.
    """
    with pytest.raises(ValueError, match="not both"):
        KillSwitch(
            state_file=tmp_path / "state.json", backend=SqlSwitchBackend(store)
        )


def test_a_trip_survives_a_restarted_process(store: SqlStore, cache, dsn: str) -> None:
    """The invariant carried over from the filesystem version, now across processes."""
    switch = KillSwitch(backend=SqlSwitchBackend(store, cache), min_trip_seconds=0.0)
    switch.trip(Trigger.MANUAL, "halt before restart")

    result = subprocess.run(
        [
            sys.executable, "-c",
            "import sys; sys.path.insert(0, '.');"
            "from core.storage import SqlStore;"
            "from core.storage.switch_backend import SqlSwitchBackend;"
            "from core.risk.kill_switch import KillSwitch;"
            f"s = SqlStore({dsn!r}); s.connect();"
            "k = KillSwitch(backend=SqlSwitchBackend(s));"
            "print(k.state.value, len(k.history), k.trip_record.detail); s.close()",
        ],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("TRIPPED")
    assert "halt before restart" in result.stdout


def test_the_audit_trail_survives_the_move(store: SqlStore, cache) -> None:
    """History is not truncated by a restart.

    The file-backed switch restored the full history for the same reason: the next persist
    would otherwise write back only this process's records and lose every prior trip.
    """
    backend = SqlSwitchBackend(store, cache)
    switch = KillSwitch(backend=backend, min_trip_seconds=0.0)
    switch.trip(Trigger.MANUAL, "first")
    switch.reset(operator="alice", reason="cleared", condition_cleared=True)
    switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "second")

    restored = KillSwitch(backend=SqlSwitchBackend(store, cache), min_trip_seconds=0.0)
    assert restored.state is KillSwitchState.TRIPPED
    assert len(restored.history) == 3
    assert [r.is_reset for r in restored.history] == [False, True, False]
    assert restored.history[1].operator == "alice"


def test_the_rules_are_unchanged_by_the_move(store: SqlStore, cache) -> None:
    """A reset that comes too soon is still refused, and still by the switch."""
    switch = KillSwitch(backend=SqlSwitchBackend(store, cache), min_trip_seconds=60.0)
    switch.trip(Trigger.MANUAL, "halt")
    with pytest.raises(ValueError, match="minimum"):
        switch.reset(operator="alice", reason="too soon", condition_cleared=True)
    with pytest.raises(ValueError, match="condition"):
        switch.reset(operator="alice", reason="nope", condition_cleared=False)
    assert switch.is_tripped


def test_a_fresh_database_comes_back_armed(store: SqlStore) -> None:
    """Readable and empty is armed. Unreadable is not — that is the next test."""
    switch = KillSwitch(backend=SqlSwitchBackend(store))
    assert switch.state is KillSwitchState.ARMED


def test_an_unreadable_store_comes_back_tripped() -> None:
    """"I cannot tell whether I was halted" is read as "I was halted".

    The distinction the backend exists to preserve: ``load`` returns None for "nothing
    stored" and raises for "cannot read", and collapsing them would resume trading after a
    database outage.
    """
    dead = SqlStore("postgresql://127.0.0.1:1/nothing?connect_timeout=1")
    switch = KillSwitch(backend=SqlSwitchBackend(dead))
    assert switch.state is KillSwitchState.TRIPPED
    assert switch.trip_record is not None
    assert switch.trip_record.trigger is Trigger.RISK_SERVICE_UNAVAILABLE


def test_a_failed_persist_is_raised_not_swallowed(store: SqlStore) -> None:
    """If the switch cannot record that it is tripped, the caller must find out."""

    class Broken(SqlSwitchBackend):
        def save(self, payload: dict) -> None:
            raise StoreUnavailable("the store is gone")

    switch = KillSwitch(backend=Broken(store))
    with pytest.raises(StoreUnavailable):
        switch.trip(Trigger.MANUAL, "halt")


def test_a_trip_is_visible_to_another_process_through_the_cache(
    store: SqlStore, cache
) -> None:
    """The switch's own writes propagate, not just the halt publisher's."""
    from core.storage.halt import SharedHaltSource

    switch = KillSwitch(backend=SqlSwitchBackend(store, cache), min_trip_seconds=0.0)
    switch.trip(Trigger.MANUAL, "halt")

    observer = SharedHaltSource(store, cache)
    assert observer.is_halted()


def test_the_emergency_policy_reaches_another_process(store: SqlStore, cache) -> None:
    """A flattening policy must be readable by the process that has to flatten."""
    from core.storage.halt import SharedHaltSource

    switch = KillSwitch(
        emergency_policy=EmergencyPolicy.FLATTEN_IMMEDIATELY,
        backend=SqlSwitchBackend(store, cache),
        min_trip_seconds=0.0,
    )
    switch.trip(Trigger.MANUAL, "halt")

    observer = SharedHaltSource(store, cache)
    assert observer.is_halted()
    assert observer.allows_risk_reducing_exit()


def test_the_api_uses_the_shared_switch_when_a_dsn_is_configured(
    dsn: str, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End to end: a halt tripped through the API is visible to another process.

    Without this the storage layer would be built and unused, which is the failure mode
    where a system looks like it has a global kill switch and does not.
    """
    from apps.api.state import EngineState
    from core.storage.halt import SharedHaltSource
    from core.storage.sql_store import SqlStore

    monkeypatch.setenv("VYRA_PG_DSN", dsn)
    monkeypatch.setenv("VYRA_REDIS_URL", os.environ["VYRA_TEST_REDIS_URL"])
    state = EngineState(
        config_dir="configs", runs_dir=tmp_path / "runs", state_dir=tmp_path / "state"
    )
    state.kill_switch.trip(Trigger.MANUAL, "halted through the API")

    observer_store = SqlStore(dsn)
    observer_store.connect()
    try:
        assert SharedHaltSource(observer_store, cache=None).is_halted()
    finally:
        observer_store.close()

    assert not (tmp_path / "state" / "kill_switch_state.json").exists(), (
        "the switch must not also be writing a file: two stores would disagree"
    )


def test_a_saved_state_is_written_in_one_statement(store: SqlStore, cache, dsn: str) -> None:
    """The normalised columns and the payload must never be able to disagree.

    A restarting switch reads the payload; every other process reads the columns. If a
    crash could land between two writes, one would come back halted while the others kept
    trading — and nothing would report the disagreement.
    """
    import psycopg

    switch = KillSwitch(backend=SqlSwitchBackend(store, cache), min_trip_seconds=0.0)
    switch.trip(Trigger.MANUAL, "halt")
    switch.reset(operator="alice", reason="cleared", condition_cleared=True)
    switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "halt again")

    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT state, payload->>'state' FROM kill_switch_state")
        columns_state, payload_state = cursor.fetchone()

    assert columns_state == payload_state == "TRIPPED"


def test_an_unparseable_stored_payload_comes_back_tripped(store: SqlStore, dsn: str) -> None:
    """Fetching it and understanding it are the same requirement.

    A payload written by an older version, truncated, or hand-edited is exactly as
    unreadable as a database that will not answer — and raising would abort startup rather
    than coming back halted.
    """
    import psycopg

    store.write_halt("TRIPPED", "HOLD", trigger="MANUAL", tripped_at_ns=1)
    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute(
            "UPDATE kill_switch_state SET payload = %s WHERE id = 'global'",
            ('{"state": "ARMED", "history": [{"ts": 1}]}',),
        )
        connection.commit()

    switch = KillSwitch(backend=SqlSwitchBackend(store))
    assert switch.state is KillSwitchState.TRIPPED
    assert switch.trip_record is not None
    assert "could not be parsed" in switch.trip_record.detail


def test_a_configured_but_dead_cache_refuses_to_start(dsn: str, tmp_path, monkeypatch) -> None:
    """No silent downgrade.

    Starting anyway would produce a service that reports a global kill switch and only
    discovers the propagation channel is dead at the first trip.
    """
    from apps.api.state import EngineState

    monkeypatch.setenv("VYRA_PG_DSN", dsn)
    monkeypatch.setenv("VYRA_REDIS_URL", "redis://127.0.0.1:1/0")
    with pytest.raises(Exception, match="onnect"):
        EngineState(config_dir="configs", runs_dir=tmp_path / "runs")
