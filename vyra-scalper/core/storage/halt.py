"""Halt state that every process shares.

An in-process kill switch halts the process holding it. That was correct while one process
did everything; it is wrong the moment there are two, because the one that received the trip
stops and the other keeps trading. This module makes the halt global.

**The split.** PostgreSQL is the durable truth: it survives a restart, a crash, and a
read-only ``runs/`` mount, and it is what a new process reads on start. Redis is the
propagation channel: a trip written to Postgres is pushed to Redis so every other process
sees it on its next check rather than on its next poll of the database.

**Losing Redis halts trading, deliberately.** Redis is not a cache here whose loss costs
latency. It is how a halt reaches the processes that did not receive it, so a process that
cannot reach Redis cannot know whether a halt was declared somewhere else. It has exactly
two options: assume not — and keep trading through a halt it cannot see — or stop. It stops.
That is a real availability cost, taken knowingly: a Redis outage stops trading, and the
alternative is a Redis outage silently disabling the kill switch.

**A stale copy can never clear a halt.** Every write takes the next epoch. A reader that has
seen epoch N refuses any value carrying a lower one, so a Redis value left over from before
a trip cannot un-halt a process that already saw the trip.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from core.storage.sql_store import HaltRecord, SqlStore, StoreUnavailable
from core.util.clock import Nanos, now_ns
from core.util.logging import get_logger

__all__ = ["HALT_KEY", "HaltPublisher", "SharedHaltSource", "SharedHaltStats"]

_log = get_logger("storage.halt")

HALT_KEY = "vyra:halt:global"


class _CacheDown(RuntimeError):
    """The propagation channel could not be read, in a deployment that requires it.

    Internal to this module: it exists so the cache-down path can skip the database read
    rather than fall through to it, and it never escapes :meth:`SharedHaltSource.current`.
    """

# Refreshed on every read that consults the database, so a live system keeps it warm. If
# every process dies the key expires and the next one to start reads Postgres instead —
# which is the correct source anyway, just slower.
HALT_TTL_SECONDS = 300

_FLATTENING_POLICIES = frozenset({"FLATTEN_IMMEDIATELY", "FLATTEN_ON_RECOVERY"})


@dataclass(slots=True)
class SharedHaltStats:
    """What the source did. Exported as metrics: a guard nobody can observe is a guard
    nobody trusts, and "halted because the cache was unreachable" must be visible as its
    own number rather than as an unexplained drop in order flow."""

    cache_hits: int = 0
    cache_misses: int = 0
    cache_failures: int = 0
    store_reads: int = 0
    store_failures: int = 0
    stale_epochs_rejected: int = 0
    fail_closed: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "cache_failures": self.cache_failures,
            "store_reads": self.store_reads,
            "store_failures": self.store_failures,
            "stale_epochs_rejected": self.stale_epochs_rejected,
            "fail_closed": self.fail_closed,
        }


class SharedHaltSource:
    """Cross-process halt state, satisfying :class:`~core.brokers.guard.HaltSource`.

    Args:
        store: the durable record.
        cache: a Redis client, or ``None`` to run on the database alone. ``None`` is an
            explicit single-process configuration, not a fallback — see
            ``require_cache``.
        require_cache: when True (the default) an unreachable cache halts trading. Set it
            False only for a genuinely single-process deployment, where there is no other
            process a halt could need to reach.
    """

    __slots__ = ("_cache", "_last_epoch", "_require_cache", "_stats", "_store")

    def __init__(
        self, store: SqlStore, cache: Any = None, require_cache: bool = True
    ) -> None:
        self._store = store
        self._cache = cache
        self._require_cache = require_cache and cache is not None
        self._stats = SharedHaltStats()
        # The highest epoch this process has ever accepted. Never decreases.
        self._last_epoch = -1

    @property
    def stats(self) -> SharedHaltStats:
        return self._stats

    @property
    def description(self) -> str:
        channel = "postgres+redis" if self._cache is not None else "postgres"
        return f"shared halt state ({channel}, epoch {self._last_epoch})"

    # -- the protocol -------------------------------------------------------------------

    def is_halted(self) -> bool:
        return self.current().is_tripped

    def allows_risk_reducing_exit(self) -> bool:
        record = self.current()
        if not record.is_tripped:
            return True
        return record.emergency_policy in _FLATTENING_POLICIES

    # -- resolution ---------------------------------------------------------------------

    def current(self) -> HaltRecord:
        """The halt state, or a synthetic halted record when it cannot be established.

        Never raises. A source that raised would push the decision onto every caller, and
        the answer is the same everywhere: if halt state cannot be established, the system
        is halted.
        """
        try:
            record = self._from_cache()
        except _CacheDown as exc:
            # Deliberately not falling through to the database. A healthy database does
            # not tell this process that a halt declared elsewhere would have reached it.
            return self._halted_because(
                f"the halt propagation channel is unreachable: {exc}"
            )
        if record is None:
            record = self._from_store()
        if record is None:
            self._stats.fail_closed += 1
            return self._halted_because("halt state could not be established")
        return self._accept(record)

    def _accept(self, record: HaltRecord) -> HaltRecord:
        """Apply the monotonic-epoch rule.

        A value older than one already seen is refused. Accepting it would let a stale
        cached copy from before a trip clear a halt this process has already observed,
        which is the failure this rule exists to make impossible.
        """
        if record.epoch < self._last_epoch:
            self._stats.stale_epochs_rejected += 1
            _log.critical(
                "stale_halt_epoch_rejected",
                seen=self._last_epoch,
                offered=record.epoch,
                reason_codes=["KILL_SWITCH_STATE_STALE"],
            )
            return self._halted_because(
                f"a halt state older than one already seen was offered "
                f"(epoch {record.epoch} < {self._last_epoch})"
            )
        self._last_epoch = record.epoch
        return record

    def _halted_because(self, detail: str) -> HaltRecord:
        """The synthetic record used whenever the answer is "we cannot tell".

        ``HOLD`` rather than a flattening policy: if the state cannot be read, the real
        emergency policy cannot be read either, and sending flattening orders on that basis
        would be guessing with orders.
        """
        _log.critical(
            "halt_state_unavailable_failing_closed",
            detail=detail,
            reason_codes=["KILL_SWITCH_ACTIVE", "KILL_SWITCH_STATE_UNREADABLE"],
        )
        return HaltRecord(
            state="TRIPPED",
            emergency_policy="HOLD",
            epoch=max(self._last_epoch, 0),
            updated_at_ns=now_ns(),
            trigger="STATE_UNAVAILABLE",
            detail=detail,
        )

    def _from_cache(self) -> HaltRecord | None:
        """Read the propagation channel.

        Returns ``None`` on a miss so the database is consulted. A cache *failure* when a
        cache is required does not return None — it returns nothing at all, because the
        caller must not treat "Redis is down" as "check the database and carry on": the
        point of requiring the cache is that a process which cannot see the propagation
        channel cannot know about a halt declared elsewhere.
        """
        if self._cache is None:
            return None
        try:
            raw = self._cache.get(HALT_KEY)
        except Exception as exc:
            self._stats.cache_failures += 1
            if self._require_cache:
                _log.critical(
                    "halt_cache_unreachable",
                    detail=str(exc),
                    reason_codes=["KILL_SWITCH_ACTIVE", "HALT_CACHE_UNREACHABLE"],
                )
                # Fail closed by short-circuiting to a halted record, without consulting
                # the database: the database being healthy does not tell this process that
                # a halt declared elsewhere would have reached it.
                self._stats.fail_closed += 1
                raise _CacheDown(str(exc)) from exc
            return None
        if raw is None:
            self._stats.cache_misses += 1
            return None
        try:
            payload = json.loads(raw)
            record = HaltRecord.from_dict(payload)
        except Exception as exc:
            # A value that will not parse is a value that means nothing. Counted as a miss
            # so the database settles it, rather than guessed at.
            self._stats.cache_misses += 1
            _log.warning("halt_cache_value_unparseable", detail=str(exc))
            return None
        self._stats.cache_hits += 1
        return record

    def _from_store(self) -> HaltRecord | None:
        try:
            record = self._store.read_halt()
            self._stats.store_reads += 1
        except StoreUnavailable as exc:
            self._stats.store_failures += 1
            _log.critical(
                "halt_store_unreachable",
                detail=str(exc),
                reason_codes=["KILL_SWITCH_ACTIVE", "HALT_STORE_UNREACHABLE"],
            )
            return None
        if record is None:
            # A database that has never held a switch is armed, and the first write
            # records that rather than leaving the row absent for the next reader to
            # interpret.
            return None
        self._push_to_cache(record)
        return record

    def _push_to_cache(self, record: HaltRecord) -> None:
        """Warm the propagation channel after a database read. Best effort by design:
        failing to warm a cache is not a reason to halt — failing to *read* it is."""
        if self._cache is None:
            return
        try:
            self._cache.set(
                HALT_KEY, json.dumps(record.to_dict()), ex=HALT_TTL_SECONDS
            )
        except Exception as exc:  # pragma: no cover - covered by the cache-down tests
            _log.warning("halt_cache_write_failed", detail=str(exc))


class HaltPublisher:
    """Writes halt state so every process sees it.

    Order matters: **durable first, then propagate**. A crash between the two leaves the
    truth recorded and the cache stale — and a stale cache that says "armed" is refused by
    the epoch rule on any reader that has seen the trip, while readers that have not will
    read the database on their next miss. The reverse order would leave a system that
    believes it is halted with no record of why.
    """

    __slots__ = ("_cache", "_store")

    def __init__(self, store: SqlStore, cache: Any = None) -> None:
        self._store = store
        self._cache = cache

    def trip(
        self,
        trigger: str,
        detail: str,
        emergency_policy: str = "HOLD",
        ts: Nanos | None = None,
        context: dict[str, Any] | None = None,
    ) -> HaltRecord:
        stamp = ts if ts is not None else now_ns()
        record = self._store.write_halt(
            state="TRIPPED",
            emergency_policy=emergency_policy,
            trigger=trigger,
            detail=detail,
            tripped_at_ns=stamp,
            ts=stamp,
        )
        self._store.append_halt_history(
            ts=stamp, trigger=trigger, detail=detail, context=context, epoch=record.epoch
        )
        self._publish(record)
        return record

    def reset(
        self,
        operator: str,
        reason: str,
        emergency_policy: str = "HOLD",
        ts: Nanos | None = None,
    ) -> HaltRecord:
        """Clear the halt. The operator is recorded; an anonymous reset is refused."""
        if not operator.strip():
            raise ValueError("a reset requires an operator identity for the audit trail")
        if not reason.strip():
            raise ValueError("a reset requires a reason for the audit trail")
        stamp = ts if ts is not None else now_ns()
        record = self._store.write_halt(
            state="ARMED", emergency_policy=emergency_policy, ts=stamp
        )
        self._store.append_halt_history(
            ts=stamp, trigger="MANUAL", detail=reason, operator=operator,
            is_reset=True, epoch=record.epoch,
        )
        self._publish(record)
        return record

    def _publish(self, record: HaltRecord) -> None:
        if self._cache is None:
            return
        try:
            self._cache.set(HALT_KEY, json.dumps(record.to_dict()), ex=HALT_TTL_SECONDS)
        except Exception as exc:
            # The durable write already succeeded, so the halt is real and will be found.
            # Logged at CRITICAL because until the cache recovers, other processes reach it
            # only through their own database reads.
            _log.critical(
                "halt_publish_failed",
                detail=str(exc),
                state=record.state,
                reason_codes=["HALT_CACHE_UNREACHABLE"],
            )
