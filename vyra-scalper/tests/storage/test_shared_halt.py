"""Halt state shared across processes, and what happens when the sharing breaks.

The claims under test, in order of how much they matter:

1. **A halt reaches a process that did not receive it.** That is the whole reason this
   exists; an in-process switch halts only the process holding it.
2. **Losing the propagation channel halts trading.** Redis is not a latency cache here. A
   process that cannot reach it cannot know whether a halt was declared elsewhere, and its
   only two options are to keep trading through a halt it cannot see, or to stop.
3. **A stale copy can never clear a halt.** A Redis value left over from before a trip must
   not un-halt a process that has already seen the trip.

Redis is really killed in these tests, not mocked as unavailable — a client that raises on
a socket error and a client that hangs are different failures, and only the real one tells
you which you have.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Iterator

import pytest
import redis as redis_lib

from core.brokers.base import BrokerError, BrokerErrorCode, OrderRequest
from core.brokers.guard import GuardedBrokerAdapter
from core.brokers.paper import PaperBrokerAdapter
from core.events import FillModel, OrderType, QuoteEvent, Side
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.storage.halt import HALT_KEY, HaltPublisher, SharedHaltSource
from core.storage.sql_store import HaltRecord, SqlStore
from core.util.clock import now_ns

pytestmark = pytest.mark.skipif(
    not os.environ.get("VYRA_TEST_PG_DSN") or not os.environ.get("VYRA_TEST_REDIS_URL"),
    reason="VYRA_TEST_PG_DSN and VYRA_TEST_REDIS_URL are required",
)


@pytest.fixture
def disposable_redis(tmp_path) -> Iterator[tuple[redis_lib.Redis, subprocess.Popen]]:
    """A Redis this test may kill.

    Its own server on its own port, so a test that pulls the plug does not take the rest of
    the suite with it.
    """
    port = 56380
    process = subprocess.Popen(
        [
            "redis-server", "--port", str(port), "--bind", "127.0.0.1",
            "--save", "", "--appendonly", "no", "--dir", str(tmp_path),
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    client = redis_lib.Redis(
        host="127.0.0.1", port=port, decode_responses=True,
        socket_connect_timeout=1, socket_timeout=1,
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            client.ping()
            break
        except Exception:
            time.sleep(0.05)
    else:  # pragma: no cover - the server failed to start
        process.kill()
        pytest.fail("the disposable redis never came up")
    try:
        yield client, process
    finally:
        process.kill()
        process.wait(timeout=10)


# --------------------------------------------------------------------------------------
# 1. A halt reaches a process that did not receive it
# --------------------------------------------------------------------------------------


def test_a_trip_in_one_process_halts_another(store: SqlStore, cache, dsn: str) -> None:
    """A real second interpreter, started before the trip is visible to it."""
    publisher = HaltPublisher(store, cache)
    source = SharedHaltSource(store, cache)
    # Armed explicitly. A database that has never held a switch reports halted, which is
    # deliberate and has its own test — but it makes a useless precondition here.
    publisher.reset(operator="alice", reason="start armed")
    assert not source.is_halted()

    publisher.trip("MANUAL", "halt from the other process", emergency_policy="HOLD")

    result = subprocess.run(
        [
            sys.executable, "-c",
            "import sys; sys.path.insert(0, '.');"
            "import redis;"
            "from core.storage import SqlStore, SharedHaltSource;"
            f"s = SqlStore({dsn!r}); s.connect();"
            f"c = redis.Redis.from_url({os.environ['VYRA_TEST_REDIS_URL']!r},"
            " decode_responses=True);"
            "src = SharedHaltSource(s, c);"
            "print('HALTED' if src.is_halted() else 'ARMED'); s.close()",
        ],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "HALTED" in result.stdout


def test_the_durable_record_survives_a_flushed_cache(store: SqlStore, cache) -> None:
    """Redis is the channel, Postgres is the truth."""
    HaltPublisher(store, cache).trip("MANUAL", "halt")
    cache.flushdb()

    source = SharedHaltSource(store, cache)
    assert source.is_halted(), "a flushed cache lost the halt"
    assert source.stats.cache_misses == 1
    assert source.stats.store_reads == 1
    assert cache.get(HALT_KEY), "the cache should have been re-warmed from the store"


# --------------------------------------------------------------------------------------
# 2. Losing the propagation channel halts trading
# --------------------------------------------------------------------------------------


def test_killing_redis_halts_trading(store: SqlStore, disposable_redis) -> None:
    """The headline failure, triggered rather than simulated.

    The database stays up and says ARMED throughout. Trading stops anyway, because the
    process can no longer learn about a halt declared somewhere else.
    """
    cache, process = disposable_redis
    HaltPublisher(store, cache).reset(operator="alice", reason="start armed")
    source = SharedHaltSource(store, cache, require_cache=True)
    assert not source.is_halted(), "precondition: armed while everything is up"

    process.kill()
    process.wait(timeout=10)

    assert source.is_halted(), "a dead propagation channel did not halt trading"
    assert source.stats.cache_failures >= 1
    record = store.read_halt()
    assert record is not None and not record.is_tripped, (
        "the durable record must still say armed: this halt is about not being able to "
        "see one, not about one having been declared"
    )


def test_a_dead_redis_refuses_orders_at_the_venue_boundary(
    store: SqlStore, disposable_redis, registry, config_bundle
) -> None:
    """End to end: kill Redis, then try to trade through a real adapter."""
    cache, process = disposable_redis
    HaltPublisher(store, cache).reset(operator="alice", reason="start armed")
    source = SharedHaltSource(store, cache, require_cache=True)

    paper = PaperBrokerAdapter(
        instruments={i: registry.get(i) for i in registry.ids()},
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=0,
    )
    paper.connect()
    paper.advance(
        QuoteEvent("CME:MES", "CME", 1_000_000_000, 1_000_000_000, 1_000_000_000, 1,
                   "TEST", bid=5100.0, ask=5100.25, bid_size=10, ask_size=10)
    )
    guarded = GuardedBrokerAdapter(paper, source)
    request = OrderRequest(
        client_order_id="c1", instrument_id="CME:MES", side=Side.BUY, quantity=1.0,
        order_type=OrderType.MARKET, strategy_id="t", ts_created=now_ns(),
    )
    assert guarded.submit_order(request).accepted, "precondition: trading while healthy"

    process.kill()
    process.wait(timeout=10)

    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(
            OrderRequest(
                client_order_id="c2", instrument_id="CME:MES", side=Side.BUY,
                quantity=1.0, order_type=OrderType.MARKET, strategy_id="t",
                ts_created=now_ns(),
            )
        )
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE


def test_a_dead_redis_refuses_even_risk_reducing_exits(
    store: SqlStore, disposable_redis
) -> None:
    """If the state cannot be read, the emergency policy cannot be read either.

    Flattening on the assumption that the policy allows it would be guessing with orders.
    """
    cache, process = disposable_redis
    HaltPublisher(store, cache).trip(
        "MANUAL", "halt", emergency_policy="FLATTEN_IMMEDIATELY"
    )
    source = SharedHaltSource(store, cache, require_cache=True)
    assert source.allows_risk_reducing_exit(), "precondition: flattening policy allows exits"

    process.kill()
    process.wait(timeout=10)

    assert source.is_halted()
    assert not source.allows_risk_reducing_exit()


def test_a_single_process_deployment_may_opt_out(store: SqlStore, disposable_redis) -> None:
    """``require_cache=False`` is for a deployment with no other process to reach.

    It is an explicit configuration, not a fallback, and it still reads the durable record —
    what it gives up is knowing about a trip that never touched this database.
    """
    cache, process = disposable_redis
    HaltPublisher(store, cache).reset(operator="alice", reason="start armed")
    source = SharedHaltSource(store, cache, require_cache=False)

    process.kill()
    process.wait(timeout=10)

    assert not source.is_halted(), "the opt-out should fall through to the durable record"
    assert source.stats.cache_failures >= 1


def test_an_unreachable_database_halts_trading(cache) -> None:
    """Both channels gone is the same answer as either: halted."""
    store = SqlStore("postgresql://127.0.0.1:1/nothing?connect_timeout=1")
    cache.flushdb()
    source = SharedHaltSource(store, cache)
    assert source.is_halted()
    assert source.stats.store_failures >= 1


def test_a_database_with_no_switch_yet_halts_rather_than_assuming_armed(
    store: SqlStore, cache
) -> None:
    """A wiped table and a fresh install look identical. Neither may resume trading."""
    cache.flushdb()
    source = SharedHaltSource(store, cache)
    assert store.read_halt() is None
    assert source.is_halted()
    assert source.stats.fail_closed >= 1


# --------------------------------------------------------------------------------------
# 3. A stale copy can never clear a halt
# --------------------------------------------------------------------------------------


def test_a_stale_cached_value_cannot_un_halt_a_process(store: SqlStore, cache) -> None:
    """The subtle one.

    A process has seen the trip at epoch N. Redis is then written with a leftover value
    from epoch N-1 saying ARMED — a replayed message, a rolled-back replica, a cache
    restored from a snapshot. Accepting it would clear a halt that is still in force.
    """
    publisher = HaltPublisher(store, cache)
    source = SharedHaltSource(store, cache)
    tripped = publisher.trip("MANUAL", "halt")
    assert source.is_halted()

    stale = HaltRecord(
        state="ARMED", emergency_policy="HOLD", epoch=tripped.epoch - 1,
        updated_at_ns=now_ns(),
    )
    cache.set(HALT_KEY, json.dumps(stale.to_dict()))

    assert source.is_halted(), "a stale cached value cleared a live halt"
    assert source.stats.stale_epochs_rejected == 1


def test_a_newer_value_is_accepted(store: SqlStore, cache) -> None:
    """The rule is monotonic, not frozen: a legitimate reset must still land."""
    publisher = HaltPublisher(store, cache)
    source = SharedHaltSource(store, cache)
    publisher.trip("MANUAL", "halt")
    assert source.is_halted()

    publisher.reset(operator="alice", reason="condition cleared")
    assert not source.is_halted()


def test_an_unparseable_cached_value_falls_back_to_the_store(
    store: SqlStore, cache
) -> None:
    """A value that means nothing is a miss, not a guess."""
    HaltPublisher(store, cache).trip("MANUAL", "halt")
    cache.set(HALT_KEY, "{not json")

    source = SharedHaltSource(store, cache)
    assert source.is_halted()
    assert source.stats.cache_misses == 1


# --------------------------------------------------------------------------------------
# The audit trail
# --------------------------------------------------------------------------------------


def test_a_trip_and_a_reset_are_both_recorded(store: SqlStore, cache) -> None:
    publisher = HaltPublisher(store, cache)
    publisher.trip("DAILY_LOSS", "daily loss limit breached")
    publisher.reset(operator="alice", reason="reviewed and cleared")

    history = store.read_halt_history()
    assert [h["is_reset"] for h in history] == [True, False]
    assert history[0]["operator"] == "alice"
    assert history[1]["trigger"] == "DAILY_LOSS"


def test_an_anonymous_reset_is_refused(store: SqlStore, cache) -> None:
    publisher = HaltPublisher(store, cache)
    publisher.trip("MANUAL", "halt")
    with pytest.raises(ValueError, match="operator identity"):
        publisher.reset(operator="  ", reason="whatever")


def test_publishing_survives_a_dead_cache_and_says_so(
    store: SqlStore, disposable_redis
) -> None:
    """The durable write must land even when the channel is gone.

    A halt that failed to record because a cache was down would be a halt nobody could
    explain afterwards.
    """
    cache, process = disposable_redis
    process.kill()
    process.wait(timeout=10)

    record = HaltPublisher(store, cache).trip("MANUAL", "halt with the cache down")
    assert record.is_tripped
    stored = store.read_halt()
    assert stored is not None and stored.is_tripped
