import type { FastifyInstance } from 'fastify';
import { createDatabase, runMigrations, seedDatabase, type DatabaseHandle } from '@forge/db';
import { buildApp } from '../app.js';

/**
 * One in-memory Postgres, migrated and seeded, shared across a test file.
 *
 * Tests run against the real schema and the real seed rather than fixtures, so
 * a constraint or a query that would fail in production fails here first.
 */
export const TEST_TODAY = '2026-09-04';

export interface Harness {
  app: FastifyInstance;
  handle: DatabaseHandle;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const handle = await createDatabase({ dataDir: `memory://forge-api-${Math.random().toString(36).slice(2)}` });
  await runMigrations(handle);
  await seedDatabase(handle, { today: TEST_TODAY });

  const app = await buildApp({
    handle,
    today: () => TEST_TODAY,
    config: { NODE_ENV: 'test', AUTO_SEED: false },
  });
  await app.ready();

  return {
    app,
    handle,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

/** Log in and return the session cookie header for subsequent requests. */
export async function login(app: FastifyInstance, email: string, password = 'ForgeDemo!2026'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${response.statusCode} ${response.body}`);
  }
  const cookie = response.cookies.find((c) => c.name === 'forge_session');
  if (!cookie) throw new Error('no session cookie issued');
  return `forge_session=${cookie.value}`;
}

export function json<T = Record<string, unknown>>(body: string): T {
  return JSON.parse(body) as T;
}
