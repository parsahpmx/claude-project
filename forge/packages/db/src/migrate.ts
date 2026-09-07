import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DatabaseHandle } from './client.js';

/**
 * Apply migrations.
 *
 * The same generated SQL runs against PGlite and a real Postgres server, so a
 * migration that works locally is the migration that runs in production.
 */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../drizzle',
);

export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  if (handle.driver === 'postgres') {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: MIGRATIONS_FOLDER });
    return;
  }
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(handle.db as any, { migrationsFolder: MIGRATIONS_FOLDER });
}
