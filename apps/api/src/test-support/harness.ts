import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig, type AppConfig } from '@meter402/config';
import { createDatabase, type DatabaseHandle } from '@meter402/database';
import type { Role } from '@meter402/auth';
import { buildApp } from '../app.js';
import { DevelopmentSessionIssuer } from '../auth/session.js';
import { paymentMetrics } from '../lib/metrics.js';
import { settlementBacklog } from '../modules/payments/settlement-backlog.js';
import { FakeFacilitator } from './fake-facilitator.js';

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
    TEST_SIMULATOR_SECRET: 'd'.repeat(64),
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
  /** Present only when the harness was built with real settlement enabled. */
  readonly facilitator: FakeFacilitator | null;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly env?: Record<string, string>;
  /**
   * Turn on real settlement and attach a controllable facilitator.
   *
   * Off by default, mirroring production: a harness that enabled settlement
   * implicitly would make it impossible to test that it is off by default.
   */
  readonly settlement?: boolean;
}

export async function createHarness(
  options: HarnessOptions | Record<string, string> = {},
): Promise<Harness> {
  // Accept the Phase 2 shape (a bare env override map) as well as the new one.
  const opts: HarnessOptions =
    'env' in options || 'settlement' in options
      ? (options as HarnessOptions)
      : { env: options as Record<string, string> };

  const settlementEnv: Record<string, string> = opts.settlement
    ? {
        LIVE_SETTLEMENT_ENABLED: 'true',
        X402_FACILITATOR_URL: 'https://facilitator.example.test',
      }
    : {};

  const config = testConfig({ ...settlementEnv, ...(opts.env ?? {}) });
  const handle = createDatabase(config.database.url, { maxConnections: 15 });
  const facilitator = opts.settlement ? new FakeFacilitator() : null;

  const app = await buildApp({
    config,
    silent: true,
    probes: { database: () => handle.ping() },
    routes: {
      db: handle.db,
      config,
      sessionIssuer: new DevelopmentSessionIssuer(config.secrets.authSecret),
      ...(facilitator ? { facilitator } : {}),
    },
    /*
     * Wired the same way the composition root wires it, so the operational
     * endpoint is exercised by tests rather than only existing in production.
     */
    paymentHealth: {
      settlementEnabled: config.settlement.liveSettlementEnabled,
      enabledNetworks: config.settlement.enabledChainIds.map((id) => `eip155:${id}`),
      probes: {
        ...(facilitator ? { facilitator: () => facilitator.health() } : {}),
      },
      metrics: () => paymentMetrics.snapshot(),
      backlog: () => settlementBacklog(handle.db),
    },
  });
  await app.ready();

  return {
    app,
    handle,
    config,
    facilitator,
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

export interface TestEndpoint {
  readonly id: string;
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly pricingRuleId: string;
}

/** Create a paid endpoint. Defaults to the Phase 2 demo: POST /research @ 0.03 USDC. */
export async function createTestEndpoint(
  app: FastifyInstance,
  projectId: string,
  token: string,
  options: {
    path?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    environment?: 'TEST' | 'LIVE';
    amount?: string;
    asset?: string;
    name?: string;
    settlementProtocol?: 'test' | 'x402';
  } = {},
): Promise<TestEndpoint> {
  const path = options.path ?? `/research-${Math.random().toString(36).slice(2, 8)}`;
  const method = options.method ?? 'POST';
  const created = await call(app, {
    method: 'POST',
    url: '/v1/endpoints',
    token,
    payload: {
      projectId,
      name: options.name ?? 'Research',
      path,
      method,
      environment: options.environment ?? 'TEST',
      price: { amount: options.amount ?? '0.03', asset: options.asset ?? 'USDC' },
      settlementProtocol: options.settlementProtocol ?? 'test',
    },
  });
  if (created.status !== 201) {
    throw new Error(`Failed to create endpoint: ${created.status} ${created.raw}`);
  }
  const data = created.body['data'] as { id: string; price: { pricingRuleId: string } };
  return { id: data.id, path, method, pricingRuleId: data.price.pricingRuleId };
}

/** Call a paid endpoint with an API key, optionally presenting a payment proof. */
export async function callPaid(
  app: FastifyInstance,
  apiKeySecret: string,
  endpoint: { path: string; method: string },
  proof?: { paymentRequestId: string; reference: string },
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKeySecret}` };
  if (proof) {
    headers['meter402-payment'] = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64');
  }
  const response = await app.inject({
    method: endpoint.method as 'POST',
    url: `/v1/paid${endpoint.path}`,
    headers,
  });
  let body: Record<string, unknown> = {};
  try {
    body = response.json();
  } catch {
    body = {};
  }
  return { status: response.statusCode, body, headers: response.headers };
}

/** Complete a TEST payment through the simulator, returning the reference to retry with. */
export async function completePayment(
  app: FastifyInstance,
  token: string,
  paymentRequestId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await call(app, {
    method: 'POST',
    url: `/v1/test/payment-requests/${paymentRequestId}/complete`,
    token,
  });
  return { status: response.status, body: response.body };
}

/** Read the payment requirement out of a 402 body. */
export function paymentRequirement(body: Record<string, unknown>): {
  paymentRequestId: string;
  amount: string;
  asset: { symbol: string; decimals: number };
  chain: { id: number };
  recipient: string;
  expiresAt: string;
} {
  const payment = body['payment'] as Record<string, unknown> | undefined;
  if (!payment) {
    throw new Error(`Response carried no payment requirement: ${JSON.stringify(body)}`);
  }
  return payment as never;
}
