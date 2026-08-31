import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export interface DatabaseOptions {
  /**
   * Connection pool size. Sized against the database's own `max_connections`
   * divided across every running task — an API scaled to 10 tasks with a pool
   * of 20 each needs 200 connections available, which is more than a small RDS
   * instance allows by default.
   */
  readonly maxConnections?: number;
  readonly connectTimeoutSeconds?: number;
  readonly idleTimeoutSeconds?: number;
  /** Required for RDS; harmless locally where the server does not offer TLS. */
  readonly ssl?: boolean;
}

export interface DatabaseHandle {
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  readonly sql: postgres.Sql;
  close(): Promise<void>;
  /** Cheap liveness probe for /ready. */
  ping(): Promise<boolean>;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.maxConnections ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    ...(options.ssl ? { ssl: 'require' as const } : {}),
    // Postgres NOTICE output is noise in structured logs and occasionally
    // echoes statement text we would rather not emit.
    onnotice: () => {},
  });

  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
    async ping() {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type Database = DatabaseHandle['db'];

/**
 * Anything that can run a query: the connection pool, or a transaction.
 *
 * Code that writes takes this rather than `Database`, so the same function
 * works inside and outside a transaction. That is not a convenience — several
 * invariants are only correct when every read and write in them runs in one
 * transaction, and a helper typed as `Database` silently forces its caller to
 * escape the surrounding one.
 *
 * Structural rather than nominal: Drizzle's transaction object is a different
 * class from the database handle but exposes the same query builders.
 */
export type QueryExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
