"""The kill switch's state, in PostgreSQL and propagated through Redis.

This is the seam that moves the switch off the filesystem without moving any of its rules.
The switch still owns the minimum trip duration, the refusal to reset without an operator,
and the absence of a force flag; this class stores what the switch hands it and gives it
back. Splitting it that way is the point — a backend that understood the rules would be a
second place they could be implemented differently, and the two would eventually disagree
about whether trading is halted.

Two things happen on every save:

* The **serialised payload** is written, so the switch comes back as exactly the object it
  was — full audit trail included.
* The **normalised columns** are written alongside it and pushed to Redis, so another
  process learns about the halt without parsing a payload it has no business knowing about.

``load`` raises rather than returning ``None`` when the store cannot be read. The switch
reads ``None`` as "nothing stored yet, start armed" and an exception as "I cannot tell,
start tripped", and those must never be confused.
"""

from __future__ import annotations

import json
from typing import Any

from core.storage.sql_store import SqlStore
from core.util.clock import Nanos
from core.util.logging import get_logger

__all__ = ["SqlSwitchBackend"]

_log = get_logger("storage.switch_backend")

HALT_KEY = "vyra:halt:global"
HALT_TTL_SECONDS = 300


class SqlSwitchBackend:
    """Durable switch state, with cross-process propagation.

    Args:
        store: the durable record. Must already be connected and migrated.
        cache: a Redis client for propagation, or ``None`` for a single-process
            deployment. Publishing is best effort — the durable write has already
            succeeded by then, so a halt is never lost because a cache was down — but the
            failure is logged at CRITICAL, because until the cache recovers other
            processes only see the halt through their own database reads.
    """

    __slots__ = ("_cache", "_store")

    def __init__(self, store: SqlStore, cache: Any = None) -> None:
        self._store = store
        self._cache = cache

    def save(self, payload: dict[str, Any]) -> None:
        record = payload.get("trip_record") or {}
        state = str(payload.get("state", "ARMED"))
        policy = str(payload.get("emergency_policy", "HOLD"))
        tripped_at: Nanos | None = int(record["ts"]) if record.get("ts") else None

        # One statement. Splitting the normalised columns from the payload would leave a
        # window in which a crash left them disagreeing about whether trading is halted —
        # and the restarting switch reads the payload while every other process reads the
        # columns, so the disagreement would be invisible until it mattered.
        written = self._store.write_halt(
            state=state,
            emergency_policy=policy,
            trigger=str(record.get("trigger")) if record.get("trigger") else None,
            detail=str(record.get("detail", "")) if record else None,
            tripped_at_ns=tripped_at,
            payload=payload,
        )
        self._publish(
            {
                "state": written.state,
                "emergency_policy": written.emergency_policy,
                "epoch": written.epoch,
                "updated_at_ns": written.updated_at_ns,
                "trigger": written.trigger,
                "detail": written.detail,
                "tripped_at_ns": written.tripped_at_ns,
            }
        )

    def load(self) -> dict[str, Any] | None:
        """The stored payload, ``None`` when nothing was ever written.

        Raises:
            StoreUnavailable: when the store cannot be read. Deliberately not caught here:
                the switch's own handler for it comes back tripped, and swallowing it would
                turn "I cannot tell" into "nothing was stored", which comes back armed.
        """
        return self._store.read_switch_payload()

    def _publish(self, snapshot: dict[str, Any]) -> None:
        if self._cache is None:
            return
        try:
            self._cache.set(HALT_KEY, json.dumps(snapshot), ex=HALT_TTL_SECONDS)
        except Exception as exc:
            _log.critical(
                "halt_publish_failed",
                detail=str(exc),
                state=snapshot.get("state"),
                reason_codes=["HALT_CACHE_UNREACHABLE"],
            )
