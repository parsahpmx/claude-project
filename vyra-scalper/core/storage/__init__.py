"""Durable and shared state.

PostgreSQL holds what must outlive a process — the kill switch, orders, positions, and an
index of dataset manifests. Redis carries a halt to the processes that did not receive it.
Market data and run artefacts stay on disk: they are large, append-only and already
content-hashed, and a row store would cost the fingerprint that makes a run reproducible
while buying nothing.
"""

from core.storage.halt import HaltPublisher, SharedHaltSource
from core.storage.migrations import SCHEMA_VERSION, apply_migrations
from core.storage.sql_store import HaltRecord, SqlStore, StoreUnavailable

__all__ = [
    "SCHEMA_VERSION",
    "HaltPublisher",
    "HaltRecord",
    "SharedHaltSource",
    "SqlStore",
    "StoreUnavailable",
    "apply_migrations",
]
