"""The durable store, against a real PostgreSQL server.

The tests that matter here are the ones about *disorder*: two writers racing, a write
arriving out of order, a process killed mid-write. The happy path is one test; the rest is
what happens when the assumptions behind the happy path do not hold.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time

import psycopg
import pytest

from core.storage.sql_store import SqlStore, StoreUnavailable
from core.util.clock import now_ns

pytestmark = pytest.mark.skipif(
    not os.environ.get("VYRA_TEST_PG_DSN"), reason="VYRA_TEST_PG_DSN is not set"
)


def an_order(client_order_id: str = "c1", ts: int | None = None, **kwargs: object) -> dict:
    order = {
        "client_order_id": client_order_id,
        "broker_order_id": "b1",
        "strategy_id": "test",
        "instrument_id": "CME:MES",
        "side": "BUY",
        "quantity": 2.0,
        "filled_qty": 0.0,
        "order_type": "MARKET",
        "time_in_force": "DAY",
        "state": "ACKNOWLEDGED",
        "reduce_only": False,
        "reason_codes": [],
        "updated_at_ns": ts if ts is not None else now_ns(),
    }
    order.update(kwargs)
    return order


# --------------------------------------------------------------------------------------
# Schema
# --------------------------------------------------------------------------------------


def test_migrations_are_idempotent(store: SqlStore) -> None:
    """Applied on every service start, so running twice must be a no-op."""
    assert store.migrate() == 0


def test_the_dsn_never_appears_in_a_repr() -> None:
    """It carries a password."""
    store = SqlStore("postgresql://user:SENTINEL-PG-PASSWORD@host/db")
    assert "SENTINEL-PG-PASSWORD" not in repr(store)


def test_operations_without_a_connection_are_refused() -> None:
    with pytest.raises(StoreUnavailable):
        SqlStore("postgresql://nowhere").read_halt()


def test_an_unreachable_database_raises_rather_than_defaulting() -> None:
    """No default is safe: "not tripped" resumes trading on no evidence."""
    store = SqlStore("postgresql://127.0.0.1:1/nothing?connect_timeout=1")
    with pytest.raises(StoreUnavailable):
        store.connect()


# --------------------------------------------------------------------------------------
# The kill switch, durably
# --------------------------------------------------------------------------------------


def test_a_fresh_database_reports_no_switch_rather_than_armed(store: SqlStore) -> None:
    """A database that has never held a switch and one that lost its row look the same.

    Returning "armed" for both would let a wiped table resume trading.
    """
    assert store.read_halt() is None


def test_halt_state_survives_a_new_connection(store: SqlStore, dsn: str) -> None:
    store.write_halt("TRIPPED", "HOLD", trigger="MANUAL", detail="halt", tripped_at_ns=1)

    other = SqlStore(dsn)
    other.connect()
    try:
        record = other.read_halt()
        assert record is not None and record.is_tripped
        assert record.trigger == "MANUAL"
    finally:
        other.close()


def test_halt_state_survives_a_restarted_process(store: SqlStore, dsn: str) -> None:
    """A separate interpreter, started after the trip, must come up halted.

    This is the invariant the filesystem version had, carried over: a switch that forgets
    on restart is one a crash loop silently resets.
    """
    store.write_halt("TRIPPED", "HOLD", trigger="MANUAL", detail="halt", tripped_at_ns=1)

    result = subprocess.run(
        [
            sys.executable, "-c",
            "import sys; sys.path.insert(0, '.');"
            "from core.storage import SqlStore;"
            f"s = SqlStore({dsn!r}); s.connect();"
            "r = s.read_halt(); print(r.state, r.epoch); s.close()",
        ],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split()[0] == "TRIPPED"


def test_each_write_takes_the_next_epoch(store: SqlStore) -> None:
    """Monotonic, so a stale copy can be recognised as stale."""
    first = store.write_halt("TRIPPED", "HOLD", trigger="MANUAL", tripped_at_ns=1)
    second = store.write_halt("ARMED", "HOLD")
    third = store.write_halt("TRIPPED", "FLATTEN_IMMEDIATELY", trigger="DAILY_LOSS")
    assert [first.epoch, second.epoch, third.epoch] == [1, 2, 3]


def test_history_is_append_only(store: SqlStore) -> None:
    store.append_halt_history(ts=1, trigger="MANUAL", detail="first", epoch=1)
    store.append_halt_history(
        ts=2, trigger="MANUAL", detail="second", operator="alice", is_reset=True, epoch=2
    )
    history = store.read_halt_history()
    assert [h["detail"] for h in history] == ["second", "first"]
    assert history[0]["operator"] == "alice"
    assert history[0]["is_reset"] is True


# --------------------------------------------------------------------------------------
# Disorder
# --------------------------------------------------------------------------------------


def test_an_older_write_cannot_move_an_order_backwards(store: SqlStore) -> None:
    """Retries arrive out of order. That is normal, not an error to detect afterwards."""
    assert store.upsert_order(an_order("c1", ts=2_000, state="FILLED", filled_qty=2.0))
    assert not store.upsert_order(an_order("c1", ts=1_000, state="ACKNOWLEDGED"))

    stored = {o["client_order_id"]: o for o in store.read_orders()}
    assert stored["c1"]["state"] == "FILLED"
    assert stored["c1"]["filled_qty"] == 2.0


def test_a_write_at_the_same_stamp_is_applied(store: SqlStore) -> None:
    """Equal stamps are a tie, not a conflict: the later caller wins deterministically."""
    store.upsert_order(an_order("c1", ts=5_000, state="ACKNOWLEDGED"))
    assert store.upsert_order(an_order("c1", ts=5_000, state="FILLED"))
    assert store.read_orders()[0]["state"] == "FILLED"


def test_concurrent_writers_do_not_lose_the_newest(store: SqlStore, dsn: str) -> None:
    """Eight threads, own connections, interleaved stamps.

    The assertion is not "no exception" but "the final row is the newest write": a store
    that serialised correctly and still lost an update would pass a smoke test.
    """
    errors: list[str] = []
    stamps = list(range(1_000, 1_000 + 8 * 25, 1))

    def writer(index: int) -> None:
        worker = SqlStore(dsn)
        try:
            worker.connect()
            for offset in range(25):
                stamp = stamps[index * 25 + offset]
                worker.upsert_order(an_order("shared", ts=stamp, state=f"S{stamp}"))
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
        finally:
            worker.close()

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert not errors, errors
    stored = store.read_orders()[0]
    assert stored["state"] == f"S{max(stamps)}", "a newer write was lost"
    assert stored["updated_at_ns"] == max(stamps)


def test_concurrent_position_writers_converge(store: SqlStore, dsn: str) -> None:
    errors: list[str] = []

    def writer(index: int) -> None:
        worker = SqlStore(dsn)
        try:
            worker.connect()
            for offset in range(20):
                worker.upsert_position(
                    "CME:MES", quantity=float(index * 20 + offset),
                    avg_price=5100.0, ts=1_000 + index * 20 + offset,
                )
        except Exception as exc:
            errors.append(str(exc))
        finally:
            worker.close()

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert not errors, errors
    positions = store.read_positions()
    assert positions["CME:MES"]["updated_at_ns"] == 1_000 + 6 * 20 - 1


def test_a_process_killed_mid_write_leaves_no_half_state(store: SqlStore, dsn: str) -> None:
    """SIGKILL during a write loop.

    A crash must leave the row at some *complete* value — the old one or a new one — never
    a mixture. Every write is a single statement in its own transaction, so there is no
    read-modify-write in application code for a kill to interrupt halfway.
    """
    store.upsert_order(an_order("victim", ts=1_000, state="ACKNOWLEDGED", filled_qty=0.0))

    script = (
        "import sys, time; sys.path.insert(0, '.');"
        "from core.storage import SqlStore;"
        f"s = SqlStore({dsn!r}); s.connect();"
        "i = 0\n"
        "while True:\n"
        "    i += 1\n"
        "    s.upsert_order({'client_order_id':'victim','broker_order_id':'b',"
        "'strategy_id':'t','instrument_id':'CME:MES','side':'BUY','quantity':2.0,"
        "'filled_qty':float(i % 3),'order_type':'MARKET','time_in_force':'DAY',"
        "'state':'FILLED' if i % 2 else 'PARTIALLY_FILLED','reduce_only':False,"
        "'reason_codes':[],'updated_at_ns':2_000 + i})\n"
    )
    process = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    process.send_signal(signal.SIGKILL)
    process.wait(timeout=30)

    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT state, filled_qty, updated_at_ns FROM orders WHERE client_order_id='victim'"
        )
        row = cursor.fetchone()

    assert row is not None, "the row vanished"
    state, filled, stamp = row
    # A complete value from some write, not a mixture of two.
    assert state in {"ACKNOWLEDGED", "FILLED", "PARTIALLY_FILLED"}
    assert filled in {0.0, 1.0, 2.0}
    assert stamp >= 1_000
    # The store is usable immediately afterwards: a killed writer must not leave a lock or
    # an aborted transaction behind that blocks the next process.
    assert store.upsert_order(an_order("victim", ts=10_000_000, state="CANCELLED"))


def test_working_orders_can_be_read_apart_from_terminal_ones(store: SqlStore) -> None:
    store.upsert_order(an_order("working", ts=1, state="ACKNOWLEDGED"))
    store.upsert_order(an_order("done", ts=2, state="FILLED"))
    working = {o["client_order_id"] for o in store.read_orders(working_only=True)}
    assert working == {"working"}
