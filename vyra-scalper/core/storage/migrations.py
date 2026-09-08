"""Schema, and an idempotent way to apply it.

Migrations are plain SQL applied in order and recorded in ``schema_version``. There is no
migration framework because there is one deployment and a handful of tables, and a
framework whose behaviour nobody on the team can predict is worse than twenty lines that
can be read in full.

Every migration is written to be safe to run twice: applying the schema to a database that
already has it must be a no-op, because that is what happens on every service start.
"""

from __future__ import annotations

from typing import Any

__all__ = ["MIGRATIONS", "SCHEMA_VERSION", "apply_migrations"]

SCHEMA_VERSION = 3

# Nanosecond integers, not timestamps: the engine's internal clock is UTC nanoseconds, and
# a column that silently rounded to microseconds would make a replayed run disagree with
# the run it replays. `bigint` holds nanoseconds until the year 2262.
MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version     integer PRIMARY KEY,
            applied_at  timestamptz NOT NULL DEFAULT now()
        );

        -- One row, id = 'global'. The kill switch is global by definition: a per-account
        -- or per-strategy switch is a limit, not a halt.
        CREATE TABLE IF NOT EXISTS kill_switch_state (
            id                text PRIMARY KEY,
            state             text        NOT NULL,
            emergency_policy  text        NOT NULL,
            trigger           text,
            detail            text,
            tripped_at_ns     bigint,
            updated_at_ns     bigint      NOT NULL,
            -- Monotonic. A reader that has seen epoch N must never accept a value
            -- carrying a lower one: that is how a stale cached copy un-halts a system.
            epoch             bigint      NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS kill_switch_history (
            id          bigserial PRIMARY KEY,
            ts_ns       bigint  NOT NULL,
            trigger     text    NOT NULL,
            detail      text    NOT NULL DEFAULT '',
            operator    text,
            is_reset    boolean NOT NULL DEFAULT false,
            context     jsonb   NOT NULL DEFAULT '{}'::jsonb,
            epoch       bigint  NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS kill_switch_history_ts ON kill_switch_history (ts_ns);

        CREATE TABLE IF NOT EXISTS orders (
            client_order_id  text PRIMARY KEY,
            broker_order_id  text,
            strategy_id      text    NOT NULL DEFAULT '',
            instrument_id    text    NOT NULL,
            side             text    NOT NULL,
            quantity         double precision NOT NULL,
            filled_qty       double precision NOT NULL DEFAULT 0,
            order_type       text    NOT NULL,
            time_in_force    text    NOT NULL,
            limit_price      double precision,
            stop_price       double precision,
            state            text    NOT NULL,
            reduce_only      boolean NOT NULL DEFAULT false,
            reason_codes     jsonb   NOT NULL DEFAULT '[]'::jsonb,
            updated_at_ns    bigint  NOT NULL
        );
        CREATE INDEX IF NOT EXISTS orders_instrument ON orders (instrument_id);
        CREATE INDEX IF NOT EXISTS orders_state ON orders (state);

        CREATE TABLE IF NOT EXISTS positions (
            instrument_id  text PRIMARY KEY,
            quantity       double precision NOT NULL,
            avg_price      double precision NOT NULL DEFAULT 0,
            realized_pnl   double precision NOT NULL DEFAULT 0,
            unrealized_pnl double precision NOT NULL DEFAULT 0,
            updated_at_ns  bigint NOT NULL
        );

        -- Dataset manifests, back-filled from the Parquet layer. The Parquet files stay
        -- the source of truth for the data itself; this is an index over them, so a run
        -- can be traced to a fingerprint without walking a directory tree.
        CREATE TABLE IF NOT EXISTS datasets (
            dataset_id      text PRIMARY KEY,
            source          text   NOT NULL,
            instruments     jsonb  NOT NULL DEFAULT '[]'::jsonb,
            start_ts        bigint NOT NULL,
            end_ts          bigint NOT NULL,
            row_count       bigint NOT NULL DEFAULT 0,
            content_sha256  text   NOT NULL DEFAULT '',
            notes           jsonb  NOT NULL DEFAULT '[]'::jsonb,
            gap_count       integer NOT NULL DEFAULT 0,
            location        text   NOT NULL DEFAULT '',
            imported_at_ns  bigint NOT NULL
        );
        """,
    ),
    (
        2,
        """
        -- The kill switch's own serialised state, alongside the normalised columns.
        --
        -- The switch owns rules the columns do not express — the minimum trip duration,
        -- the refusal to reset without an operator, the full audit trail — and flattening
        -- them into columns would put those rules in two places. The columns stay for
        -- querying and for cross-process propagation; this holds what the switch needs to
        -- come back as exactly the object it was.
        ALTER TABLE kill_switch_state
            ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
        """,
    ),
    (
        3,
        """
        -- Promotion decisions. Append-only: a promotion is never edited into a demotion,
        -- it is followed by a separate demotion record. Keyed by strategy, version *and*
        -- config hash, because a strategy whose parameters changed is not the strategy the
        -- evidence was gathered about.
        CREATE TABLE IF NOT EXISTS promotions (
            id                bigserial PRIMARY KEY,
            strategy_id       text   NOT NULL,
            strategy_version  text   NOT NULL,
            config_hash       text   NOT NULL,
            action            text   NOT NULL,
            approver          text   NOT NULL,
            reason            text   NOT NULL,
            ts_ns             bigint NOT NULL,
            evidence          jsonb  NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE INDEX IF NOT EXISTS promotions_strategy
            ON promotions (strategy_id, strategy_version, config_hash);
        """,
    ),
]


def apply_migrations(connection: Any) -> int:
    """Bring ``connection``'s database up to :data:`SCHEMA_VERSION`.

    Returns:
        The number of migrations applied. Zero on an already-current database, which is
        the normal case on every service start.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            " version integer PRIMARY KEY,"
            " applied_at timestamptz NOT NULL DEFAULT now())"
        )
        cursor.execute("SELECT version FROM schema_version")
        applied = {row[0] for row in cursor.fetchall()}

        count = 0
        for version, statements in MIGRATIONS:
            if version in applied:
                continue
            cursor.execute(statements)
            cursor.execute(
                "INSERT INTO schema_version (version) VALUES (%s) ON CONFLICT DO NOTHING",
                (version,),
            )
            count += 1
    connection.commit()
    return count
