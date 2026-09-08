"""Real servers, not fakes.

Every test in this directory runs against an actual PostgreSQL instance and an actual Redis
instance. The failures being tested — a dead cache, a killed process, two writers racing —
are the ones a fake gets wrong, because a fake fails in whatever way its author imagined.

The servers are found through ``VYRA_TEST_PG_DSN`` and ``VYRA_TEST_REDIS_URL``. Without
them the suite skips rather than silently testing nothing, and CI sets both.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

pytest.importorskip("psycopg", reason="psycopg is required for the storage suite")
pytest.importorskip("redis", reason="redis is required for the storage suite")

import psycopg
import redis as redis_lib

from core.storage.sql_store import SqlStore

PG_DSN = os.environ.get("VYRA_TEST_PG_DSN", "")
REDIS_URL = os.environ.get("VYRA_TEST_REDIS_URL", "")

requires_pg = pytest.mark.skipif(not PG_DSN, reason="VYRA_TEST_PG_DSN is not set")
requires_redis = pytest.mark.skipif(not REDIS_URL, reason="VYRA_TEST_REDIS_URL is not set")


@pytest.fixture
def dsn() -> str:
    if not PG_DSN:
        pytest.skip("VYRA_TEST_PG_DSN is not set")
    return PG_DSN


@pytest.fixture
def store(dsn: str) -> Iterator[SqlStore]:
    """A migrated store on a clean schema.

    Tables are truncated rather than dropped: the migration is exercised once per session
    and its idempotency is tested explicitly, not implicitly by every other test.
    """
    store = SqlStore(dsn)
    store.connect()
    store.migrate()
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "TRUNCATE kill_switch_state, kill_switch_history, orders, positions,"
                " datasets"
            )
        connection.commit()
    yield store
    store.close()


@pytest.fixture
def cache() -> Iterator[redis_lib.Redis]:
    if not REDIS_URL:
        pytest.skip("VYRA_TEST_REDIS_URL is not set")
    client = redis_lib.Redis.from_url(REDIS_URL, decode_responses=True)
    client.flushdb()
    yield client
    client.close()
