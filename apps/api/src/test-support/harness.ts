import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig, type AppConfig } from '@meter402/config';
import { createDatabase, type DatabaseHandle } from '@meter402/database';
import type { Role } from '@meter402/auth';
import { buildApp } from '../app.js';
import { DevelopmentSessionIssuer } from '../auth/session.js';

/**
 * Integration test harness.
 *
 * Builds the real application against a real PostgreSQL database and drives it
 * through `inject`, so these tests exercise the same routing, authentication
 * hook, error handler, and serialisation a live request would. Nothing is
 * mocked: a tenant-isolation test that stubbed the repository would prove
 * nothing about the isolation.
 */

export const DATABASE_URL = process.env['DATABASE_URL'];
export const hasDatabase = Boolean(DATABASE_URL);

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DEPLOY_ENV: 'local',
    LOG_LEVEL: 'error',
    DATABASE_URL: DATABASE_URL ?? 'postgresql://localhost:5432/meter402',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_SECRET: 'a'.repeat(64),
    API_KEY_HASH_PEPPER: 'b'.repeat(64),
    WEBHOOK_SIGNING_SECRET: 'c'.repeat(64),
    BASE_CHAIN_ID: '84532',
    BASE_RPC_URL: 'https://sepolia.base.org',
    USDC_CONTRACT_ADDRESS: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    DASHBOARD_ORIGIN: 'http://localhost:3000',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly handle: DatabaseHandle;
  readonly config: AppConfig;
  close(): Promise<void>;
}

export async function createHarness(
  configOverrides: Record<string, string> = {},
): Promise<Harness> {
  const config = testConfig(configOverrides);
  const handle = createDatabase(config.database.url, { maxConnections: 15 });
  const app = await buildApp({
    config,
    silent: true,
    probes: { database: () => handle.ping() },
    routes: {
      db: handle.db,
      config,
      sessionIssuer: new DevelopmentSessionIssuer(config.secrets.authSecret),
    },
  });
  await app.ready();

  return {
    app,
    handle,
    config,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

/** A unique email per call, so parallel test files never collide on the unique index. */
let emailCounter = 0;
export function uniqueEmail(label: string): string {
  emailCounter += 1;
  return `${label}-${Date.now()}-${emailCounter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export function uniqueSlug(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(
    0,
    48,
  );
}

export interface TestUser {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

export async function createTestUser(app: FastifyInstance, label = 'user'): Promise<TestUser> {
  const email = uniqueEmail(label);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/dev/sessions',
    payload: { email },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Failed to create test user: ${response.statusCode} ${response.body}`);
  }
  const body = response.json().data;
  return { userId: body.userId, email: body.email, token: body.token };
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Convenience wrapper so tests read as HTTP calls rather than inject boilerplate. */
export async function call(
  app: FastifyInstance,
  options: InjectOptions & { token?: string },
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const { token, headers, ...rest } = options;
  const response = await app.inject({
    ...rest,
    headers: { ...(token ? auth(token) : {}), ...(headers ?? {}) },
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = response.json();
  } catch {
    parsed = {};
  }
  return { status: response.statusCode, body: parsed, raw: response.body };
}

export interface TestOrganization {
  readonly organizationId: string;
  readonly owner: TestUser;
}

export async function createTestOrganization(
  app: FastifyInstance,
  label = 'org',
): Promise<TestOrganization> {
  const owner = await createTestUser(app, `${label}-owner`);
  const created = await call(app, {
    method: 'POST',
    url: '/v1/organizations',
    token: owner.token,
    payload: { name: `${label} Inc`, slug: uniqueSlug(label) },
  });
  if (created.status !== 201) {
    throw new Error(`Failed to create organization: ${created.status} ${created.raw}`);
  }
  const data = created.body['data'] as { id: string };
  return { organizationId: data.id, owner };
}

/** Add a member in a specific role, accepted and active. */
export async function addMember(
  app: FastifyInstance,
  organizationId: string,
  ownerToken: string,
  role: Role,
  label = 'member',
): Promise<TestUser & { membershipId: string }> {
  const user = await createTestUser(app, label);
  const invited = await call(app, {
    method: 'POST',
    url: `/v1/organizations/${organizationId}/members`,
    token: ownerToken,
    payload: { email: user.email, role },
  });
  if (invited.status !== 201) {
    throw new Error(`Failed to invite member: ${invited.status} ${invited.raw}`);
  }
  const membershipId = (invited.body['data'] as { id: string }).id;

  // Invitations start INVITED and grant nothing until accepted; activate so the
  // role matrix tests exercise real authority.
  const activated = await call(app, {
    method: 'PATCH',
    url: `/v1/organizations/${organizationId}/members/${membershipId}`,
    token: ownerToken,
    payload: { status: 'ACTIVE' },
  });
  if (activated.status !== 200) {
    throw new Error(`Failed to activate member: ${activated.status} ${activated.raw}`);
  }

  return { ...user, membershipId };
}

export async function createTestProject(
  app: FastifyInstance,
  organizationId: string,
  token: string,
  label = 'project',
): Promise<string> {
  const created = await call(app, {
    method: 'POST',
    url: '/v1/projects',
    token,
    payload: { organizationId, name: `${label} project`, slug: uniqueSlug(label) },
  });
  if (created.status !== 201) {
    throw new Error(`Failed to create project: ${created.status} ${created.raw}`);
  }
  return (created.body['data'] as { id: string }).id;
}

export async function createTestApiKey(
  app: FastifyInstance,
  projectId: string,
  token: string,
  options: { environment?: 'TEST' | 'LIVE'; scopes?: readonly string[]; name?: string } = {},
): Promise<{ id: string; secret: string }> {
  const created = await call(app, {
    method: 'POST',
    url: `/v1/projects/${projectId}/api-keys`,
    token,
    payload: {
      name: options.name ?? 'test key',
      environment: options.environment ?? 'TEST',
      scopes: options.scopes ?? ['payments:read'],
    },
  });
  if (created.status !== 201) {
    throw new Error(`Failed to create API key: ${created.status} ${created.raw}`);
  }
  const data = created.body['data'] as { id: string; secret: string };
  return { id: data.id, secret: data.secret };
}
