import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { paymentRequests, payments } from '@meter402/database';
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
 * Economic integrity under mutation and concurrency.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The races in `payments-concurrency` cover simultaneous *payment*. These
 * cover something different and less obvious: what happens when the merchant
 * changes the rules while a payment is already in flight.
 *
 * A price is a promise. An agent that was quoted 0.03 and pays 0.03 must be
 * served, even if the merchant raised the price to 0.50 in between — and must
 * not be charged 0.50 for a quote of 0.03. Both directions of that are money
 * moving without agreement.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function merchant(harness: Harness, label: string) {
  const app = harness.app;
  const org = await createTestOrganization(app, label);
  const projectId = await createTestProject(app, org.organizationId, org.owner.token, label);
  const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
    path: `/${label}`,
    amount: '0.03',
  });
  const key = await createTestApiKey(app, projectId, org.owner.token, {
    scopes: ['payments:read', 'payments:write'],
  });
  return { org, projectId, endpoint, key };
}

/**
 * Complete a TEST payment, exactly as an agent's own TEST key would.
 *
 * The simulator authenticates with the ordinary principal chain — a TEST key
 * holding `payments:write`, or a human member. There is no separate simulator
 * credential to present.
 */
async function completeTestPayment(
  harness: Harness,
  token: string,
  paymentRequestId: string,
): Promise<{ status: number; reference: string }> {
  const response = await call(harness.app, {
    method: 'POST',
    url: `/v1/test/payment-requests/${paymentRequestId}/complete`,
    token,
    payload: {},
  });
  const reference = ((response.body['data'] as { reference?: string })?.reference ?? '') as string;
  return { status: response.status, reference };
}

describe.skipIf(!hasDatabase)('economic integrity: pricing changes mid-flight', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('honours the quoted price after the merchant raises it', async () => {
    const { org, endpoint, key } = await merchant(harness, 'raise');

    // Quoted at 0.03.
    const challenge = await callPaid(harness.app, key.secret, endpoint);
    expect(challenge.status).toBe(402);
    const quoted = challenge.body['payment'] as { paymentRequestId: string; amount: string };
    expect(quoted.amount).toBe('30000');

    // Merchant raises the price while the agent is deciding.
    const repriced = await call(harness.app, {
      method: 'PATCH',
      url: `/v1/endpoints/${endpoint.id}`,
      token: org.owner.token,
      payload: { price: { amount: '0.50', asset: 'USDC' } },
    });
    expect(repriced.status).toBeLessThan(300);

    /*
     * The snapshot is immutable, so the in-flight request still owes 0.03.
     * Re-reading the price at settlement time would let a merchant charge an
     * agent more than the amount it agreed to.
     */
    const [row] = await harness.handle.db
      .select({ amount: paymentRequests.amountMinorUnits })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, quoted.paymentRequestId));
    expect(row?.amount).toBe('30000');

    // And paying the quoted amount is still served.
    const completed = await completeTestPayment(harness, key.secret, quoted.paymentRequestId);
    expect(completed.status).toBeLessThan(300);

    const served = await callPaid(harness.app, key.secret, endpoint, {
      paymentRequestId: quoted.paymentRequestId,
      reference: completed.reference,
    });
    expect(served.status).toBe(200);
  });

  it('quotes the new price to the next caller', async () => {
    const { org, endpoint, key } = await merchant(harness, 'nextquote');

    const before = await callPaid(harness.app, key.secret, endpoint);
    expect((before.body['payment'] as { amount: string }).amount).toBe('30000');

    await call(harness.app, {
      method: 'PATCH',
      url: `/v1/endpoints/${endpoint.id}`,
      token: org.owner.token,
      payload: { price: { amount: '0.50', asset: 'USDC' } },
    });

    const after = await callPaid(harness.app, key.secret, endpoint);
    expect((after.body['payment'] as { amount: string }).amount).toBe('500000');
  });

  it('refuses to serve a request whose endpoint was disabled after quoting', async () => {
    const { org, endpoint, key } = await merchant(harness, 'disabled');

    const challenge = await callPaid(harness.app, key.secret, endpoint);
    const quoted = challenge.body['payment'] as { paymentRequestId: string };

    await call(harness.app, {
      method: 'PATCH',
      url: `/v1/endpoints/${endpoint.id}`,
      token: org.owner.token,
      payload: { status: 'DISABLED' },
    });

    const completed = await completeTestPayment(harness, key.secret, quoted.paymentRequestId);
    expect(completed.status).toBeLessThan(300);

    /*
     * The endpoint is closed. The agent must be told so plainly rather than
     * served — and this is the case worth watching: it has paid, so a merchant
     * disabling an endpoint has created a refund obligation. The system must
     * at least not compound it by silently serving or silently dropping.
     */
    const served = await callPaid(harness.app, key.secret, endpoint, {
      paymentRequestId: quoted.paymentRequestId,
      reference: completed.reference,
    });
    expect(served.status).toBeGreaterThanOrEqual(400);
    expect(served.status).toBeLessThan(500);
    expect((served.body['error'] as { code: string }).code).toBe('ENDPOINT_DISABLED');
  });
});

describe.skipIf(!hasDatabase)('economic integrity: credential changes mid-flight', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('does not let a revoked key redeem a payment it already made', async () => {
    const { org, projectId, endpoint, key } = await merchant(harness, 'revoke-mid');

    const challenge = await callPaid(harness.app, key.secret, endpoint);
    const quoted = challenge.body['payment'] as { paymentRequestId: string };
    const completed = await completeTestPayment(harness, key.secret, quoted.paymentRequestId);
    expect(completed.status).toBeLessThan(300);

    // The key is revoked between paying and redeeming.
    await call(harness.app, {
      method: 'DELETE',
      url: `/v1/projects/${projectId}/api-keys/${key.id}`,
      token: org.owner.token,
    });

    const served = await callPaid(harness.app, key.secret, endpoint, {
      paymentRequestId: quoted.paymentRequestId,
      reference: completed.reference,
    });

    // Authentication fails before anything else is considered.
    expect(served.status).toBe(401);

    // Nothing was served, and no second payment was invented.
    const rows = await harness.handle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, quoted.paymentRequestId));
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it('does not let one project key redeem another project payment', async () => {
    const a = await merchant(harness, 'proj-a');
    const b = await merchant(harness, 'proj-b');

    const challenge = await callPaid(harness.app, a.key.secret, a.endpoint);
    const quoted = challenge.body['payment'] as { paymentRequestId: string };
    const completed = await completeTestPayment(harness, a.key.secret, quoted.paymentRequestId);
    expect(completed.status).toBeLessThan(300);

    // B's key, A's paid request, at B's own endpoint.
    const stolen = await callPaid(harness.app, b.key.secret, b.endpoint, {
      paymentRequestId: quoted.paymentRequestId,
      reference: completed.reference,
    });

    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(stolen.status).toBeLessThan(500);
  });
});

describe.skipIf(!hasDatabase)('economic integrity: who may drive the simulator', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({});
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses an unauthenticated caller and a caller from another organization', async () => {
    const { key, endpoint } = await merchant(harness, 'simauth');
    const challenge = await callPaid(harness.app, key.secret, endpoint);
    const quoted = challenge.body['payment'] as { paymentRequestId: string };

    const outsider = await merchant(harness, 'simoutsider');

    const attempts: Array<{ name: string; headers: Record<string, string> }> = [
      { name: 'no credential', headers: {} },
      { name: 'garbage credential', headers: { authorization: 'Bearer not-a-key' } },
      {
        name: "another organization's key",
        headers: { authorization: `Bearer ${outsider.key.secret}` },
      },
    ];

    for (const attempt of attempts) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/v1/test/payment-requests/${quoted.paymentRequestId}/complete`,
        headers: { 'content-type': 'application/json', ...attempt.headers },
        payload: {},
      });
      expect(response.statusCode, attempt.name).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, attempt.name).toBeLessThan(500);
    }

    // Still unpaid after all of that.
    const rows = await harness.handle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, quoted.paymentRequestId));
    expect(rows).toHaveLength(0);
  });

  it('refuses a LIVE key even for a TEST payment request', async () => {
    const { org, projectId, key, endpoint } = await merchant(harness, 'simlive');
    const challenge = await callPaid(harness.app, key.secret, endpoint);
    const quoted = challenge.body['payment'] as { paymentRequestId: string };

    const liveKey = await createTestApiKey(harness.app, projectId, org.owner.token, {
      environment: 'LIVE',
      scopes: ['payments:read', 'payments:write'],
    });

    const response = await call(harness.app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${quoted.paymentRequestId}/complete`,
      token: liveKey.secret,
      payload: {},
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
