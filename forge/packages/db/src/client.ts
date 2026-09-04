import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

/**
 * Database connection.
 *
 * FORGE runs the same Postgres schema in every environment. In production that
 * is a real Postgres server; in development and tests it is PGlite, which is
 * Postgres compiled to WebAssembly running in-process. That choice is what
 * makes `pnpm test` work with no Docker and no service to start, while keeping
 * the SQL, the constraints and the migrations byte-identical to production —
 * an SQLite dev database would let a broken `text[]` column or a partial index
 * reach production untested.
 */

export type Database =
  | PgliteDatabase<typeof schema>
  | PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  driver: 'pglite' | 'postgres';
  close: () => Promise<void>;
  /** Where PGlite persisted its data, or null when in memory / remote. */
  dataDir: string | null;
}

export interface CreateDatabaseOptions {
  /** A `postgres://` URL selects the server driver. Anything else uses PGlite. */
  url?: string | undefined;
  /** PGlite storage. `memory://` for tests, a path for a persistent dev database. */
  dataDir?: string | undefined;
}

export async function createDatabase(options: CreateDatabaseOptions = {}): Promise<DatabaseHandle> {
  const url = options.url ?? process.env.DATABASE_URL;

  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import('postgres');
    const client = postgres(url, { max: 10, onnotice: () => {} });
    return {
      db: drizzlePostgres(client, { schema }),
      driver: 'postgres',
      dataDir: null,
      close: async () => {
        await client.end({ timeout: 5 });
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = options.dataDir ?? process.env.FORGE_DATA_DIR ?? 'memory://forge';
  const client = new PGlite(dataDir);
  await client.waitReady;
  return {
    db: drizzlePglite(client, { schema }),
    driver: 'pglite',
    dataDir: dataDir.startsWith('memory://') ? null : dataDir,
    close: async () => {
      await client.close();
    },
  };
}

export { schema };
