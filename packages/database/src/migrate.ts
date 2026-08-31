/**
 * Migration runner.
 *
 * Run with `pnpm db:migrate`. Applies every pending migration in
 * `drizzle/` and exits non-zero on failure so a deployment pipeline halts
 * rather than starting an application against a schema it does not expect.
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDatabase } from './client.js';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  // Migrations are resolved relative to this file so the runner behaves the
  // same from source (tsx) and from dist.
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '../drizzle');

  // A single connection: concurrent migration runners would race for the
  // advisory lock, and there is nothing to parallelise.
  const handle = createDatabase(url, { maxConnections: 1 });

  try {
    console.warn(`Applying migrations from ${migrationsFolder}`);
    await migrate(handle.db, { migrationsFolder });
    console.warn('Migrations applied.');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
