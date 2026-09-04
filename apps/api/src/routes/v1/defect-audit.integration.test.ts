import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys, endpoints, paymentRequests, projects } from '@meter402/database';
import {
  call,
  callPaid,
  createHarness,
  createTestApiKey,
  createTestEndpoint,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  type Harness,
} from '../../test-support/harness.js';

/**
 * Phase 4 adversarial audit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Written to break the system, not to demonstrate it. Each test targets one
 * of the defect classes Phase 4 names — resource-ID substitution, scope
 * bypass, principal confusion, revoked credentials, TEST reaching LIVE — and
 * is phrased as the attack rather than as the feature.
 *
 * A test here passing means the attack failed. That is the only useful
 * reading: these are not regression tests for behaviour we implemented, they
 * are attempts to find behaviour we did not intend.
 * ─────────────────────────────────────────────────────────────────────────
 */

describe.skipIf(!hasDatabase)('audit: resource ID substitution', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('cannot read another organization payment request by guessing its ID', async () => {
    const app = harness.app;

    // Victim: a real payment request, created through the real flow.
    const victimOrg = await createTestOrganization(app, 'victim-pr');
    const victimProject = await createTestProject(
      app,
      victimOrg.organizationId,
      victimOrg.owner.token,
      'victim-pr',
    );
    const victimEndpoint = await createTestEndpoint(app, victimProject, victimOrg.owner.token, {});
    const victimKey = await createTestApiKey(app, victimProject, victimOrg.owner.token, {
      scopes: ['payments:read', 'payments:write'],
    });
    const challenge = await callPaid(app, victimKey.secret, victimEndpoint);
    expect(challenge.status).toBe(402);
    const victimRequestId = (challenge.body['payment'] as { paymentRequestId: string })
      .paymentRequestId;
    expect(victimRequestId).toMatch(/^preq_/);

    // Attacker: a fully valid identity in a different organization.
    const attackerOrg = await createTestOrganization(app, 'attacker-pr');
    const attackerProject = await createTestProject(
      app,
      attackerOrg.organizationId,
      attackerOrg.owner.token,
      'attacker-pr',
    );
    const attackerKey = await createTestApiKey(app, attackerProject, attackerOrg.owner.token, {
      scopes: ['payments:read'],
    });

    for (const token of [attackerOrg.owner.token, attackerKey.secret]) {
      const response = await call(app, {
        method: 'GET',
        url: `/v1/payment-requests/${victimRequestId}`,
        token,
      });
      // 404, not 403: existence is itself information.
      expect(response.status).toBe(404);
      expect(response.raw).not.toContain(victimProject);
    }
  });

  it('cannot mutate another organization endpoint by guessing its ID', async () => {
    const app = harness.app;

    const victimOrg = await createTestOrganization(app, 'victim-ep');
    const victimProject = await createTestProject(
      app,
      victimOrg.organizationId,
      victimOrg.owner.token,
      'victim-ep',
    );
    const victimEndpoint = await createTestEndpoint(app, victimProject, victimOrg.owner.token, {});

    const attackerOrg = await createTestOrganization(app, 'attacker-ep');

    const response = await call(app, {
      method: 'PATCH',
      url: `/v1/endpoints/${victimEndpoint.id}`,
      token: attackerOrg.owner.token,
      payload: { status: 'DISABLED' },
    });
    expect(response.status).toBe(404);

    // And the endpoint is genuinely untouched, not merely reported as missing.
    const [row] = await harness.handle.db
      .select({ status: endpoints.status })
      .from(endpoints)
      .where(eq(endpoints.id, victimEndpoint.id));
    expect(row?.status).toBe('ACTIVE');
  });

  it('cannot revoke another organization API key by guessing its ID', async () => {
    const app = harness.app;

    const victimOrg = await createTestOrganization(app, 'victim-key');
    const victimProject = await createTestProject(
      app,
      victimOrg.organizationId,
      victimOrg.owner.token,
      'victim-key',
    );
    const victimKey = await createTestApiKey(app, victimProject, victimOrg.owner.token, {});

    const attackerOrg = await createTestOrganization(app, 'attacker-key');
    const attackerProject = await createTestProject(
      app,
      attackerOrg.organizationId,
      attackerOrg.owner.token,
      'attacker-key',
    );

    // Attacker's own project path, victim's key ID: the classic substitution.
    const response = await call(app, {
      method: 'DELETE',
      url: `/v1/projects/${attackerProject}/api-keys/${victimKey.id}`,
      token: attackerOrg.owner.token,
    });
    expect(response.status).toBe(404);

    const [row] = await harness.handle.db
      .select({ status: apiKeys.status })
      .from(apiKeys)
      .where(eq(apiKeys.id, victimKey.id));
    expect(row?.status).toBe('ACTIVE');
  });
});

describe.skipIf(!hasDatabase)('audit: credential confusion and scope bypass', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses a machine credential on a human-only settlement mutation', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'human-only');
    const projectId = await createTestProject(
      app,
      org.organizationId,
      org.owner.token,
      'human-only',
    );

    /*
     * Every scope the key can hold. If any of them reached this route, a
     * leaked server-side key could redirect a merchant's money — which is the
     * single worst outcome in the product.
     */
    const key = await createTestApiKey(app, projectId, org.owner.token, {
      scopes: ['payments:read', 'payments:write', 'endpoints:read', 'endpoints:write'],
    });

    const response = await call(app, {
      method: 'PUT',
      url: `/v1/organizations/${org.organizationId}/settlement`,
      token: key.secret,
      payload: {
        projectId,
        chainId: 84532,
        asset: 'USDC',
        recipientAddress: '0x209693bc6afc0c5328ba36faf03c514ef312287c',
      },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('refuses a human session on the machine-only paid surface', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'machine-only');
    const projectId = await createTestProject(
      app,
      org.organizationId,
      org.owner.token,
      'machine-only',
    );
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {});

    const response = await call(app, {
      method: endpoint.method as 'POST',
      url: `/v1/paid${endpoint.path}`,
      token: org.owner.token,
    });

    // A human session carries no project and no environment; inventing one
    // would mean guessing whether a dashboard click is TEST or LIVE money.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.status).not.toBe(402);
  });

  it('refuses a paid request from a key without payments:write', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'no-write');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'no-write');
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {});
    const readOnly = await createTestApiKey(app, projectId, org.owner.token, {
      scopes: ['payments:read'],
    });

    const response = await callPaid(app, readOnly.secret, endpoint);
    expect(response.status).not.toBe(402);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('stops accepting a key the instant it is revoked, mid-session', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'revoke-now');
    const projectId = await createTestProject(
      app,
      org.organizationId,
      org.owner.token,
      'revoke-now',
    );
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {});
    const key = await createTestApiKey(app, projectId, org.owner.token, {
      scopes: ['payments:read', 'payments:write'],
    });

    // Working before.
    expect((await callPaid(app, key.secret, endpoint)).status).toBe(402);

    const revoked = await call(app, {
      method: 'DELETE',
      url: `/v1/projects/${projectId}/api-keys/${key.id}`,
      token: org.owner.token,
    });
    expect(revoked.status).toBeLessThan(300);

    // Dead immediately — no cache, no grace period.
    const after = await callPaid(app, key.secret, endpoint);
    expect(after.status).toBe(401);
    expect((after.body['error'] as { code: string }).code).toBe('API_KEY_REVOKED');
  });

  it('does not let a rotated key secret keep working', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'rotate');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'rotate');
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {});
    const key = await createTestApiKey(app, projectId, org.owner.token, {
      scopes: ['payments:read', 'payments:write'],
    });

    expect((await callPaid(app, key.secret, endpoint)).status).toBe(402);

    const rotated = await call(app, {
      method: 'POST',
      url: `/v1/projects/${projectId}/api-keys/${key.id}/rotate`,
      token: org.owner.token,
    });
    expect(rotated.status).toBeLessThan(300);
    const next = (rotated.body['data'] as { secret: string }).secret;
    expect(next).not.toBe(key.secret);

    // The old secret is dead; the new one works.
    expect((await callPaid(app, key.secret, endpoint)).status).toBe(401);
    expect((await callPaid(app, next, endpoint)).status).toBe(402);
  });
});

describe.skipIf(!hasDatabase)('audit: TEST and LIVE separation', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('cannot create a LIVE endpoint on a project that was never enabled for LIVE', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'liveoff');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'liveoff');

    const response = await call(app, {
      method: 'POST',
      url: '/v1/endpoints',
      token: org.owner.token,
      payload: {
        projectId,
        name: 'Live research',
        path: '/live-research',
        method: 'POST',
        environment: 'LIVE',
        price: { amount: '0.03', asset: 'USDC' },
      },
    });

    expect(response.status).toBe(409);
    expect((response.body['error'] as { code: string }).code).toBe('CONFLICT');
  });

  it('has no route that can switch a project into LIVE mode', async () => {
    /*
     * `live_mode_enabled` gates LIVE endpoint creation and defaults to false,
     * and nothing in the API writes it — so no merchant can reach the LIVE
     * path at all. That is consistent with mainnet being disabled, but it is
     * currently true by omission rather than by decision.
     *
     * This test pins it. If someone later adds the field to the project
     * update schema, this fails and the LIVE path gets the review it needs
     * instead of opening silently. See docs/PHASE_4_IMPLEMENTATION_NOTE.md.
     */
    const app = harness.app;
    const org = await createTestOrganization(app, 'nolive');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'nolive');

    const attempt = await call(app, {
      method: 'PATCH',
      url: `/v1/projects/${projectId}`,
      token: org.owner.token,
      payload: { liveModeEnabled: true },
    });

    // Either rejected outright, or silently ignored — never applied.
    const [row] = await harness.handle.db
      .select({ liveModeEnabled: projects.liveModeEnabled })
      .from(projects)
      .where(eq(projects.id, projectId));

    expect(row?.liveModeEnabled).toBe(false);
    expect(attempt.status).toBeLessThan(500);
  });

  it('resolves a paid route within the credential environment, never across it', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'envsep');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'envsep');

    // A TEST endpoint exists at this path; the TEST key finds it.
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
      path: '/env-separated',
      environment: 'TEST',
    });
    const testKey = await createTestApiKey(app, projectId, org.owner.token, {
      environment: 'TEST',
      scopes: ['payments:read', 'payments:write'],
    });
    expect((await callPaid(app, testKey.secret, endpoint)).status).toBe(402);

    /*
     * A LIVE key on the same project and the same path finds nothing.
     * Environment is part of the endpoint lookup key rather than a filter
     * applied afterwards, so there is no row for it to reach.
     */
    const liveKey = await createTestApiKey(app, projectId, org.owner.token, {
      environment: 'LIVE',
      scopes: ['payments:read', 'payments:write'],
    });
    const crossed = await callPaid(app, liveKey.secret, endpoint);
    expect(crossed.status).toBe(404);
    expect((crossed.body['error'] as { code: string }).code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('never issues a payment request on a mainnet chain from a TEST key', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'testchain');
    const projectId = await createTestProject(
      app,
      org.organizationId,
      org.owner.token,
      'testchain',
    );
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {});
    const key = await createTestApiKey(app, projectId, org.owner.token, {
      scopes: ['payments:read', 'payments:write'],
    });

    const challenge = await callPaid(app, key.secret, endpoint);
    expect(challenge.status).toBe(402);

    const rows = await harness.handle.db
      .select({ chainId: paymentRequests.chainId })
      .from(paymentRequests)
      .where(eq(paymentRequests.projectId, projectId));

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.chainId).toBe(84532);
      expect(row.chainId).not.toBe(8453);
    }
  });
});

describe.skipIf(!hasDatabase)('audit: error mapping', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('never turns a client mistake into a 500', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'errmap');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'errmap');

    const attempts: Array<{ name: string; response: { statusCode: number; body: string } }> = [];

    // Malformed JSON.
    attempts.push({
      name: 'malformed json',
      response: await app.inject({
        method: 'POST',
        url: '/v1/endpoints',
        headers: {
          authorization: `Bearer ${org.owner.token}`,
          'content-type': 'application/json',
        },
        payload: '{"projectId": ',
      }),
    });

    // Wrong content type.
    attempts.push({
      name: 'wrong content type',
      response: await app.inject({
        method: 'POST',
        url: '/v1/endpoints',
        headers: { authorization: `Bearer ${org.owner.token}`, 'content-type': 'text/plain' },
        payload: 'projectId=x',
      }),
    });

    // Body over the limit.
    attempts.push({
      name: 'oversized body',
      response: await app.inject({
        method: 'POST',
        url: '/v1/endpoints',
        headers: {
          authorization: `Bearer ${org.owner.token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ projectId, name: 'x'.repeat(2_000_000) }),
      }),
    });

    // Unknown route.
    attempts.push({
      name: 'unknown route',
      response: await app.inject({ method: 'GET', url: '/v1/nope' }),
    });

    // Structurally valid but semantically wrong body.
    attempts.push({
      name: 'invalid body',
      response: await app.inject({
        method: 'POST',
        url: '/v1/endpoints',
        headers: {
          authorization: `Bearer ${org.owner.token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ projectId, price: { amount: 'not-a-number' } }),
      }),
    });

    // A price with more precision than USDC has.
    attempts.push({
      name: 'over-precise price',
      response: await app.inject({
        method: 'POST',
        url: '/v1/endpoints',
        headers: {
          authorization: `Bearer ${org.owner.token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({
          projectId,
          name: 'Precision',
          path: '/precision',
          method: 'POST',
          environment: 'TEST',
          price: { amount: '0.0000001', asset: 'USDC' },
        }),
      }),
    });

    for (const attempt of attempts) {
      expect(
        attempt.response.statusCode,
        `${attempt.name} produced ${attempt.response.statusCode}`,
      ).toBeLessThan(500);
      expect(attempt.response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('never leaks internals in an error body', async () => {
    const app = harness.app;

    const response = await app.inject({
      method: 'GET',
      url: '/v1/payments/pay_00000000000000000000000000',
      headers: { authorization: 'Bearer not-a-real-key' },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    for (const leak of ['postgresql://', 'password', 'at Object.', 'node_modules', 'select "']) {
      expect(response.body.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});
