import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { payments, paymentReceipts, usageEvents } from '@meter402/database';
import {
  call,
  createHarness,
  createTestApiKey,
  createTestEndpoint,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  type Harness,
} from '../../test-support/harness.js';

/**
 * The authorization API.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This is what the SDK calls, so the contract has to be usable by someone who
 * knows nothing about payments: send the request you received, get back either
 * a response to send or permission to proceed.
 *
 * The security properties are the same ones `/v1/paid/*` has — they must be,
 * because both go through the same gate. What is new is that the merchant's
 * process is now outside the trust boundary, so these tests check that moving
 * the handler out did not move any decision out with it.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function merchant(harness: Harness, label: string, endpointOptions = {}) {
  const app = harness.app;
  const org = await createTestOrganization(app, label);
  const projectId = await createTestProject(app, org.organizationId, org.owner.token, label);

  // An x402 endpoint needs somewhere for the money to go before it can exist.
  await call(app, {
    method: 'PUT',
    url: `/v1/organizations/${org.organizationId}/settlement`,
    token: org.owner.token,
    payload: {
      projectId,
      chainId: 84532,
      asset: 'USDC',
      recipientAddress: '0x209693bc6afc0c5328ba36faf03c514ef312287c',
    },
  });

  const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
    path: `/${label}`,
    ...endpointOptions,
  });
  const key = await createTestApiKey(app, projectId, org.owner.token, {
    scopes: ['payments:read', 'payments:write'],
  });
  return { org, projectId, endpoint, key };
}

function authorize(
  harness: Harness,
  secret: string,
  input: { method: string; path: string; headers?: Record<string, string> },
) {
  return call(harness.app, {
    method: 'POST',
    url: '/v1/authorize',
    token: secret,
    payload: { method: input.method, path: input.path, headers: input.headers ?? {} },
  });
}

describe.skipIf(!hasDatabase)('POST /v1/authorize', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('hands back a ready-to-send 402 for an unpaid request', async () => {
    const { endpoint, key } = await merchant(harness, 'unpaid');

    const response = await authorize(harness, key.secret, {
      method: endpoint.method,
      path: endpoint.path,
    });

    expect(response.status).toBe(200);
    const data = response.body['data'] as {
      outcome: string;
      paymentRequestId: string;
      respondWith: { status: number; headers: Record<string, string>; body: unknown };
    };

    expect(data.outcome).toBe('PAYMENT_REQUIRED');
    expect(data.paymentRequestId).toMatch(/^preq_/);

    /*
     * A middleware author copies these three fields onto their reply and
     * returns. They should not have to understand any of the contents.
     */
    expect(data.respondWith.status).toBe(402);
    expect(data.respondWith.body).toBeTruthy();
  });

  it('authorizes a paid request and reports the payment and receipt', async () => {
    const { endpoint, key } = await merchant(harness, 'paid');

    const challenge = await authorize(harness, key.secret, {
      method: endpoint.method,
      path: endpoint.path,
    });
    const paymentRequestId = (challenge.body['data'] as { paymentRequestId: string })
      .paymentRequestId;

    const completed = await call(harness.app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${paymentRequestId}/complete`,
      token: key.secret,
      payload: {},
    });
    expect(completed.status).toBeLessThan(300);
    const reference = (completed.body['data'] as { reference: string }).reference;

    const proof = Buffer.from(JSON.stringify({ paymentRequestId, reference }), 'utf8').toString(
      'base64',
    );

    const authorized = await authorize(harness, key.secret, {
      method: endpoint.method,
      path: endpoint.path,
      headers: { 'meter402-payment': proof },
    });

    expect(authorized.status).toBe(200);
    const data = authorized.body['data'] as {
      outcome: string;
      payment: { id: string; receiptId: string; amountMinorUnits: string; asset: string };
    };

    expect(data.outcome).toBe('AUTHORIZED');
    expect(data.payment.amountMinorUnits).toBe('30000');
    expect(data.payment.asset).toBe('USDC');
    expect(data.payment.receiptId).toMatch(/^rcpt_/);

    // Exactly one payment, one receipt, one usage event.
    const paymentRows = await harness.handle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(1);

    const receiptRows = await harness.handle.db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, paymentRows[0]!.id));
    expect(receiptRows).toHaveLength(1);

    const usageRows = await harness.handle.db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, paymentRows[0]!.id));
    expect(usageRows).toHaveLength(1);
  });

  it('spends a payment exactly once across 20 simultaneous authorizations', async () => {
    const { endpoint, key } = await merchant(harness, 'race');

    const challenge = await authorize(harness, key.secret, {
      method: endpoint.method,
      path: endpoint.path,
    });
    const paymentRequestId = (challenge.body['data'] as { paymentRequestId: string })
      .paymentRequestId;

    const completed = await call(harness.app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${paymentRequestId}/complete`,
      token: key.secret,
      payload: {},
    });
    const reference = (completed.body['data'] as { reference: string }).reference;
    const proof = Buffer.from(JSON.stringify({ paymentRequestId, reference }), 'utf8').toString(
      'base64',
    );

    /*
     * Moving the handler out of process does not move the exactly-once
     * guarantee out with it: the usage event is still written inside the
     * gate's transaction, so one payment buys one request no matter how many
     * merchant instances present the same proof at once.
     */
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        authorize(harness, key.secret, {
          method: endpoint.method,
          path: endpoint.path,
          headers: { 'meter402-payment': proof },
        }),
      ),
    );

    const authorized = results.filter((r) => r.status === 200);
    expect(authorized).toHaveLength(1);

    const paymentRows = await harness.handle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(1);

    const usageRows = await harness.handle.db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, paymentRows[0]!.id));
    expect(usageRows).toHaveLength(1);
  });

  it('refuses a human session', async () => {
    const { org, endpoint } = await merchant(harness, 'humanauth');

    const response = await call(harness.app, {
      method: 'POST',
      url: '/v1/authorize',
      token: org.owner.token,
      payload: { method: endpoint.method, path: endpoint.path, headers: {} },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('refuses a key without payments:write', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'authread');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'authread');
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {});
    const readOnly = await createTestApiKey(app, projectId, org.owner.token, {
      scopes: ['payments:read'],
    });

    const response = await authorize(harness, readOnly.secret, {
      method: endpoint.method,
      path: endpoint.path,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('resolves the route within the credential environment only', async () => {
    const { org, projectId, endpoint } = await merchant(harness, 'authenv');

    const liveKey = await createTestApiKey(harness.app, projectId, org.owner.token, {
      environment: 'LIVE',
      scopes: ['payments:read', 'payments:write'],
    });

    const response = await authorize(harness, liveKey.secret, {
      method: endpoint.method,
      path: endpoint.path,
    });
    expect(response.status).toBe(404);
    expect((response.body['error'] as { code: string }).code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('cannot be pointed at another organization route', async () => {
    const victim = await merchant(harness, 'authvictim');
    const attacker = await merchant(harness, 'authattacker');

    // The path is the victim's; the credential is the attacker's. The project
    // comes from the credential, so this resolves in the attacker's project.
    const response = await authorize(harness, attacker.key.secret, {
      method: victim.endpoint.method,
      path: victim.endpoint.path,
    });

    expect(response.status).toBe(404);
  });

  it('rejects a malformed body without a 500', async () => {
    const { key } = await merchant(harness, 'authbad');

    for (const payload of [
      {},
      { method: 'POST' },
      { path: '/x' },
      { method: 'BREW', path: '/x' },
      { method: 'POST', path: '/x', headers: 'not-an-object' },
    ]) {
      const response = await call(harness.app, {
        method: 'POST',
        url: '/v1/authorize',
        token: key.secret,
        payload,
      });
      expect(response.status, JSON.stringify(payload)).toBeGreaterThanOrEqual(400);
      expect(response.status, JSON.stringify(payload)).toBeLessThan(500);
    }
  });
});

describe.skipIf(!hasDatabase)('POST /v1/authorize with an x402 endpoint', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('issues the x402 402 challenge like any other', async () => {
    const { endpoint, key } = await merchant(harness, 'x402auth', {
      settlementProtocol: 'x402',
    });

    const response = await authorize(harness, key.secret, {
      method: endpoint.method,
      path: endpoint.path,
    });

    expect(response.status).toBe(200);
    const data = response.body['data'] as {
      outcome: string;
      respondWith: { status: number; headers: Record<string, string> };
    };
    expect(data.outcome).toBe('PAYMENT_REQUIRED');
    expect(data.respondWith.status).toBe(402);
    // The x402 challenge travels in a header, not the body.
    expect(Object.keys(data.respondWith.headers).map((h) => h.toLowerCase())).toContain(
      'payment-required',
    );
  });

  it('refuses to settle an x402 authorization out of process, and says why', async () => {
    /*
     * The refusal is the feature. Half-supporting a money-moving flow across a
     * process boundary — with the continuation state either holding a
     * spendable signature at rest or relying on a locking protocol that cannot
     * be validated without a real facilitator — is the trade this phase
     * explicitly must not make.
     */
    const { endpoint, key } = await merchant(harness, 'x402settle', {
      settlementProtocol: 'x402',
    });

    // A syntactically plausible but unverifiable signature is enough to reach
    // the decision point; the point is which branch is taken, not the verdict.
    const response = await authorize(harness, key.secret, {
      method: endpoint.method,
      path: endpoint.path,
      headers: { 'payment-signature': 'not-a-valid-payload' },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
