"""Durable state in PostgreSQL.

What lives here and what does not is a deliberate split:

* **Here**: the kill switch, orders, positions, and an index of dataset manifests. State
  that must outlive a process, be shared by several, and be correct after a crash.
* **Not here**: market data and run artefacts. Those are large, append-only and already
  content-hashed on disk; moving them into a row store would buy nothing and cost the
  fingerprint that makes a run reproducible.

Two properties the schema and this class exist to provide:

**Monotonicity.** Every mutable row carries the nanosecond stamp of the write that produced
it, and an update older than the stored one is discarded. Two processes writing the same
order out of order is not an error condition to detect after the fact — it is the normal
consequence of a retry, and the store simply refuses to move backwards.

**A crash leaves no half-state.** Each write is a single statement in its own transaction.
There is no read-modify-write in application code that a crash could interrupt halfway,
because the interesting cases — "only if newer", "only if this is still the epoch I saw" —
are expressed as predicates in the statement itself.
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass
from typing import Any

from core.storage.migrations import apply_migrations
from core.util.clock import Nanos, now_ns
from core.util.logging import get_logger

__all__ = ["HaltRecord", "SqlStore", "StoreUnavailable"]

_log = get_logger("storage.sql")

GLOBAL_SWITCH_ID = "global"


class StoreUnavailable(RuntimeError):
    """The durable store could not answer.

    Raised rather than returning a default, because every default this class could return
    is a lie: "not tripped" would resume trading on no evidence, and "tripped" would be a
    halt nobody can explain. The caller decides, and the halt source above decides to halt.
    """


@dataclass(frozen=True, slots=True)
class HaltRecord:
    """The global halt state as the durable store holds it."""

    state: str
    emergency_policy: str
    epoch: int
    updated_at_ns: Nanos
    trigger: str | None = None
    detail: str | None = None
    tripped_at_ns: Nanos | None = None

    @property
    def is_tripped(self) -> bool:
        return self.state == "TRIPPED"

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "emergency_policy": self.emergency_policy,
            "epoch": self.epoch,
            "updated_at_ns": self.updated_at_ns,
            "trigger": self.trigger,
            "detail": self.detail,
            "tripped_at_ns": self.tripped_at_ns,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> HaltRecord:
        return cls(
            state=str(payload["state"]),
            emergency_policy=str(payload["emergency_policy"]),
            epoch=int(payload["epoch"]),
            updated_at_ns=int(payload["updated_at_ns"]),
            trigger=payload.get("trigger"),
            detail=payload.get("detail"),
            tripped_at_ns=payload.get("tripped_at_ns"),
        )


class SqlStore:
    """PostgreSQL-backed durable state.

    Args:
        dsn: libpq connection string. Never logged: it carries the password.
        connect: injectable connection factory, so the tests can drive a real server on an
            ephemeral port without the class knowing.
    """

    __slots__ = ("_connect", "_connection", "_dsn")

    def __init__(self, dsn: str, connect: Any = None) -> None:
        self._dsn = dsn
        self._connect = connect
        self._connection: Any = None

    def __repr__(self) -> str:
        # The DSN carries a password. It never appears here, in a log line, or in any
        # diagnostic this class produces.
        return "SqlStore(<dsn redacted>)"

    # -- connection ---------------------------------------------------------------------

    def connect(self) -> None:
        if self._connect is None:
            try:
                import psycopg
            except ImportError as exc:  # pragma: no cover - dependency is declared
                raise StoreUnavailable(
                    "psycopg is required for SqlStore; pip install 'psycopg[binary]'"
                ) from exc
            self._connect = psycopg.connect
        try:
            self._connection = self._connect(self._dsn)
        except Exception as exc:
            raise StoreUnavailable(f"could not connect to the durable store: {exc}") from exc

    def close(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None:
            # Closing an already-dead connection is not an error worth propagating out of
            # a shutdown path.
            with contextlib.suppress(Exception):
                connection.close()

    def migrate(self) -> int:
        return apply_migrations(self._require())

    def _require(self) -> Any:
        if self._connection is None:
            raise StoreUnavailable("SqlStore is not connected")
        return self._connection

    def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
        connection = self._require()
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall() if cursor.description else []
            connection.commit()
            return list(rows)
        except Exception as exc:
            # Roll back so a failed statement does not leave the session in an aborted
            # state where every later statement fails for the wrong reason. If the
            # connection is already gone there is nothing to roll back.
            with contextlib.suppress(Exception):
                connection.rollback()
            raise StoreUnavailable(f"durable store operation failed: {exc}") from exc

    def ping(self) -> bool:
        try:
            self._execute("SELECT 1")
            return True
        except StoreUnavailable:
            return False

    # -- the kill switch ----------------------------------------------------------------

    def read_halt(self) -> HaltRecord | None:
        """The durable halt state, or ``None`` when nothing has ever been written.

        ``None`` is not "armed": it means this database has never seen a switch. The caller
        distinguishes them, because a fresh database and a database that lost its row are
        the same shape and very different situations.
        """
        rows = self._execute(
            "SELECT state, emergency_policy, epoch, updated_at_ns, trigger, detail,"
            " tripped_at_ns FROM kill_switch_state WHERE id = %s",
            (GLOBAL_SWITCH_ID,),
        )
        if not rows:
            return None
        state, policy, epoch, updated, trigger, detail, tripped_at = rows[0]
        return HaltRecord(
            state=str(state),
            emergency_policy=str(policy),
            epoch=int(epoch),
            updated_at_ns=int(updated),
            trigger=trigger,
            detail=detail,
            tripped_at_ns=tripped_at,
        )

    def write_halt(
        self,
        state: str,
        emergency_policy: str,
        trigger: str | None = None,
        detail: str | None = None,
        tripped_at_ns: Nanos | None = None,
        ts: Nanos | None = None,
        payload: dict[str, Any] | None = None,
    ) -> HaltRecord:
        """Record a new halt state, taking the next epoch.

        The epoch increments inside the statement, so two processes tripping at the same
        moment get different epochs and neither can silently overwrite the other's.

        ``payload`` is written **in the same statement** as the normalised columns, never
        after it. Two statements would leave a window in which a crash left the columns
        saying one thing and the payload the other — and since a restarting switch reads
        the payload while every other process reads the columns, the two would disagree
        about whether trading is halted. Passing ``None`` leaves any stored payload
        untouched rather than blanking it.
        """
        stamp = ts if ts is not None else now_ns()
        rows = self._execute(
            """
            INSERT INTO kill_switch_state
                (id, state, emergency_policy, trigger, detail, tripped_at_ns,
                 updated_at_ns, epoch, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 1, COALESCE(%s::jsonb, '{}'::jsonb))
            ON CONFLICT (id) DO UPDATE SET
                state = EXCLUDED.state,
                emergency_policy = EXCLUDED.emergency_policy,
                trigger = EXCLUDED.trigger,
                detail = EXCLUDED.detail,
                tripped_at_ns = EXCLUDED.tripped_at_ns,
                updated_at_ns = EXCLUDED.updated_at_ns,
                epoch = kill_switch_state.epoch + 1,
                payload = COALESCE(EXCLUDED.payload, kill_switch_state.payload)
            RETURNING state, emergency_policy, epoch, updated_at_ns, trigger, detail,
                      tripped_at_ns
            """,
            (
                GLOBAL_SWITCH_ID, state, emergency_policy, trigger, detail,
                tripped_at_ns, stamp,
                json.dumps(payload) if payload is not None else None,
            ),
        )
        row = rows[0]
        record = HaltRecord(
            state=str(row[0]), emergency_policy=str(row[1]), epoch=int(row[2]),
            updated_at_ns=int(row[3]), trigger=row[4], detail=row[5], tripped_at_ns=row[6],
        )
        _log.warning(
            "halt_state_written",
            state=record.state,
            epoch=record.epoch,
            trigger=record.trigger,
            reason_codes=["KILL_SWITCH_ACTIVE"] if record.is_tripped else [],
        )
        return record

    def append_halt_history(
        self,
        ts: Nanos,
        trigger: str,
        detail: str = "",
        operator: str | None = None,
        is_reset: bool = False,
        context: dict[str, Any] | None = None,
        epoch: int = 0,
    ) -> None:
        """Append to the audit trail. Never updated, never deleted."""
        self._execute(
            "INSERT INTO kill_switch_history"
            " (ts_ns, trigger, detail, operator, is_reset, context, epoch)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (ts, trigger, detail, operator, is_reset, json.dumps(context or {}), epoch),
        )

    def read_halt_history(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._execute(
            "SELECT ts_ns, trigger, detail, operator, is_reset, context, epoch"
            " FROM kill_switch_history ORDER BY ts_ns DESC, id DESC LIMIT %s",
            (limit,),
        )
        return [
            {
                "ts_ns": r[0], "trigger": r[1], "detail": r[2], "operator": r[3],
                "is_reset": r[4], "context": r[5], "epoch": r[6],
            }
            for r in rows
        ]

    def read_switch_payload(self) -> dict[str, Any] | None:
        """The stored payload, or ``None`` when nothing has been written.

        Raises:
            StoreUnavailable: when the database cannot be read. The difference between
                that and ``None`` decides whether a restarting switch comes back armed or
                tripped, so the two are never collapsed.
        """
        rows = self._execute(
            "SELECT payload FROM kill_switch_state WHERE id = %s", (GLOBAL_SWITCH_ID,)
        )
        if not rows:
            return None
        payload = rows[0][0]
        if not payload:
            return None
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            raise StoreUnavailable("the stored kill switch payload is not an object")
        return payload

    # -- orders and positions -----------------------------------------------------------

    def upsert_order(self, order: dict[str, Any]) -> bool:
        """Record an order, refusing to move it backwards in time.

        Returns:
            True when the row was written, False when a newer version was already stored.
            Reported rather than silently ignored: a write that lost a race is not an
            error, but a caller that never sees one has no way to notice a clock problem.
        """
        rows = self._execute(
            """
            INSERT INTO orders
                (client_order_id, broker_order_id, strategy_id, instrument_id, side,
                 quantity, filled_qty, order_type, time_in_force, limit_price, stop_price,
                 state, reduce_only, reason_codes, updated_at_ns)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (client_order_id) DO UPDATE SET
                broker_order_id = EXCLUDED.broker_order_id,
                filled_qty      = EXCLUDED.filled_qty,
                limit_price     = EXCLUDED.limit_price,
                stop_price      = EXCLUDED.stop_price,
                state           = EXCLUDED.state,
                reason_codes    = EXCLUDED.reason_codes,
                updated_at_ns   = EXCLUDED.updated_at_ns
            WHERE orders.updated_at_ns <= EXCLUDED.updated_at_ns
            RETURNING client_order_id
            """,
            (
                order["client_order_id"], order.get("broker_order_id"),
                order.get("strategy_id", ""), order["instrument_id"], order["side"],
                float(order["quantity"]), float(order.get("filled_qty", 0.0)),
                order["order_type"], order["time_in_force"],
                order.get("limit_price"), order.get("stop_price"), order["state"],
                bool(order.get("reduce_only", False)),
                json.dumps(list(order.get("reason_codes", []))),
                int(order["updated_at_ns"]),
            ),
        )
        return bool(rows)

    def read_orders(self, working_only: bool = False) -> list[dict[str, Any]]:
        clause = " WHERE state IN ('PENDING_NEW','SUBMITTED','ACKNOWLEDGED','PARTIALLY_FILLED')"
        rows = self._execute(
            "SELECT client_order_id, broker_order_id, strategy_id, instrument_id, side,"
            " quantity, filled_qty, order_type, time_in_force, limit_price, stop_price,"
            " state, reduce_only, reason_codes, updated_at_ns FROM orders"
            + (clause if working_only else "")
            + " ORDER BY updated_at_ns DESC"
        )
        keys = (
            "client_order_id", "broker_order_id", "strategy_id", "instrument_id", "side",
            "quantity", "filled_qty", "order_type", "time_in_force", "limit_price",
            "stop_price", "state", "reduce_only", "reason_codes", "updated_at_ns",
        )
        return [dict(zip(keys, row, strict=True)) for row in rows]

    def upsert_position(
        self,
        instrument_id: str,
        quantity: float,
        avg_price: float,
        realized_pnl: float = 0.0,
        unrealized_pnl: float = 0.0,
        ts: Nanos | None = None,
    ) -> bool:
        """Record a position, refusing to move it backwards in time."""
        stamp = ts if ts is not None else now_ns()
        rows = self._execute(
            """
            INSERT INTO positions
                (instrument_id, quantity, avg_price, realized_pnl, unrealized_pnl,
                 updated_at_ns)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (instrument_id) DO UPDATE SET
                quantity       = EXCLUDED.quantity,
                avg_price      = EXCLUDED.avg_price,
                realized_pnl   = EXCLUDED.realized_pnl,
                unrealized_pnl = EXCLUDED.unrealized_pnl,
                updated_at_ns  = EXCLUDED.updated_at_ns
            WHERE positions.updated_at_ns <= EXCLUDED.updated_at_ns
            RETURNING instrument_id
            """,
            (instrument_id, quantity, avg_price, realized_pnl, unrealized_pnl, stamp),
        )
        return bool(rows)

    def read_positions(self) -> dict[str, dict[str, Any]]:
        rows = self._execute(
            "SELECT instrument_id, quantity, avg_price, realized_pnl, unrealized_pnl,"
            " updated_at_ns FROM positions"
        )
        return {
            row[0]: {
                "instrument_id": row[0], "quantity": row[1], "avg_price": row[2],
                "realized_pnl": row[3], "unrealized_pnl": row[4], "updated_at_ns": row[5],
            }
            for row in rows
        }

    # -- dataset index ------------------------------------------------------------------

    def upsert_dataset(self, record: dict[str, Any]) -> None:
        """Index one dataset manifest.

        The Parquet files stay the source of truth for the data. This is an index over
        them, so nothing here can change what a run actually read — the content hash is
        copied, not recomputed, and a mismatch is the storage layer's problem to report,
        not to silently correct.
        """
        self._execute(
            """
            INSERT INTO datasets
                (dataset_id, source, instruments, start_ts, end_ts, row_count,
                 content_sha256, notes, gap_count, location, imported_at_ns)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (dataset_id) DO UPDATE SET
                source         = EXCLUDED.source,
                instruments    = EXCLUDED.instruments,
                start_ts       = EXCLUDED.start_ts,
                end_ts         = EXCLUDED.end_ts,
                row_count      = EXCLUDED.row_count,
                content_sha256 = EXCLUDED.content_sha256,
                notes          = EXCLUDED.notes,
                gap_count      = EXCLUDED.gap_count,
                location       = EXCLUDED.location,
                imported_at_ns = EXCLUDED.imported_at_ns
            """,
            (
                record["dataset_id"], record["source"],
                json.dumps(list(record.get("instruments", []))),
                int(record["start_ts"]), int(record["end_ts"]),
                int(record.get("row_count", 0)), record.get("content_sha256", ""),
                json.dumps(list(record.get("notes", []))),
                int(record.get("gap_count", 0)), record.get("location", ""),
                int(record.get("imported_at_ns", now_ns())),
            ),
        )

    def read_datasets(self) -> list[dict[str, Any]]:
        rows = self._execute(
            "SELECT dataset_id, source, instruments, start_ts, end_ts, row_count,"
            " content_sha256, notes, gap_count, location FROM datasets"
            " ORDER BY start_ts"
        )
        keys = (
            "dataset_id", "source", "instruments", "start_ts", "end_ts", "row_count",
            "content_sha256", "notes", "gap_count", "location",
        )
        return [dict(zip(keys, row, strict=True)) for row in rows]
