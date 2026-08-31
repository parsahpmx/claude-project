import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  callPaid,
  completePayment,
  createHarness,
  createTestApiKey,
  createTestEndpoint,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  paymentRequirement,
  type Harness,
  type TestEndpoint,
  type TestOrganization,
} from '../../test-support/harness.js';

/**
 * Phase 2 security properties.
 *
 * The Phase 1 rule still governs and is release-blocking: a valid identity
 * belonging to Organization A must never read or modify Organization B's
 * resources, however the IDs are guessed or the request is shaped. Phase 2
 * adds money to that surface, so the same matrix is re-run over endpoints,
 * payment requests, payments, and receipts — plus the properties that are new
 * here: payments bind to one endpoint, scopes gate machine access, and TEST
 * and LIVE never meet.
 */

interface Tenant {
  readonly org: TestOrganization;
  readonly projectId: string;
  readonly endpoint: TestEndpoint;
  readonly key: { id: string; secret: string };
}

async function createTenant(harness: Harness, label: string): Promise<Tenant> {
  const app = harness.app;
  const org = await createTestOrganization(app, label);
  const projectId = await createTestProject(app, org.organizationId, org.owner.token, label);
  const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
    path: `/${label}-research`,
  });
  const key = await createTestApiKey(app, projectId, org.owner.token, {
    environment: 'TEST',
    scopes: ['payments:read', 'payments:write'],
  });
  return { org, projectId, endpoint, key };
}

/** Drive a paid endpoint to a settled payment and return its identifiers. */
async function settleOnce(
  harness: Harness,
  tenant: Tenant,
): Promise<{ paymentRequestId: string; reference: string; paymentId: string; receiptId: string }> {
  const refused = await callPaid(harness.app, tenant.key.secret, tenant.endpoint);
  const requirement = paymentRequirement(refused.body);
  const completed = await completePayment(
    harness.app,
    tenant.org.owner.token,
    requirement.paymentRequestId,
  );
  const data = completed.body['data'] as {
    reference: string;
    payment: { id: string };
    receipt: { id: string };
  };
  return {
    paymentRequestId: requirement.paymentRequestId,
    reference: data.reference,
    paymentId: data.payment.id,
    receiptId: data.receipt.id,
  };
}

describe.skipIf(!hasDatabase)('Phase 2 tenant isolation', () => {
  let harness: Harness;
  let alpha: Tenant;
  let beta: Tenant;
  let alphaSettled: Awaited<ReturnType<typeof settleOnce>>;

  beforeAll(async () => {
    harness = await createHarness();
    alpha = await createTenant(harness, 'alpha');
    beta = await createTenant(harness, 'beta');
    alphaSettled = await settleOnce(harness, alpha);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("refuses to read another organization's endpoint", async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/endpoints/${alpha.endpoint.id}`,
      token: beta.org.owner.token,
    });
    // 404, never 403: a 403 would confirm the endpoint exists.
    expect(response.status).toBe(404);
    expect(response.body['error']).toMatchObject({ code: 'ENDPOINT_NOT_FOUND' });
  });

  it("refuses to modify another organization's endpoint", async () => {
    const response = await call(harness.app, {
      method: 'PATCH',
      url: `/v1/endpoints/${alpha.endpoint.id}`,
      token: beta.org.owner.token,
      payload: { price: { amount: '0.00001', asset: 'USDC' } },
    });
    expect(response.status).toBe(404);
  });

  it("refuses to read another organization's payment request", async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/payment-requests/${alphaSettled.paymentRequestId}`,
      token: beta.org.owner.token,
    });
    expect(response.status).toBe(404);
  });

  it("refuses to read another organization's payment", async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/payments/${alphaSettled.paymentId}`,
      token: beta.org.owner.token,
    });
    expect(response.status).toBe(404);
  });

  it("refuses to read another organization's receipt", async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/receipts/${alphaSettled.receiptId}`,
      token: beta.org.owner.token,
    });
    expect(response.status).toBe(404);
    expect(response.body['error']).toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
  });

  it("refuses an API key reading another organization's receipt", async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/receipts/${alphaSettled.receiptId}`,
      token: beta.key.secret,
    });
    expect(response.status).toBe(404);
  });

  it("refuses to complete another organization's payment request", async () => {
    const response = await call(harness.app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${alphaSettled.paymentRequestId}/complete`,
      token: beta.key.secret,
    });
    expect(response.status).toBe(404);
  });

  it("gives an unknown ID the same answer as another tenant's ID", async () => {
    const unknown = await call(harness.app, {
      method: 'GET',
      url: '/v1/receipts/rcpt_00000000000000000000000000',
      token: beta.org.owner.token,
    });
    const foreign = await call(harness.app, {
      method: 'GET',
      url: `/v1/receipts/${alphaSettled.receiptId}`,
      token: beta.org.owner.token,
    });
    // Indistinguishable responses: an attacker learns nothing by probing.
    expect(unknown.status).toBe(foreign.status);
    expect(unknown.body['error']).toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
    expect(foreign.body['error']).toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
  });

  it("cannot spend another organization's settled payment", async () => {
    const response = await callPaid(harness.app, beta.key.secret, beta.endpoint, {
      paymentRequestId: alphaSettled.paymentRequestId,
      reference: alphaSettled.reference,
    });
    // The payment request is not visible under beta's scope at all.
    expect(response.status).toBe(402);
    expect(response.body['error']).toMatchObject({ code: 'PAYMENT_INVALID' });
  });

  it("cannot reach another organization's paid endpoint with its own key", async () => {
    // The path exists, but only in alpha's project; beta's key resolves its
    // own project, where nothing matches.
    const response = await callPaid(harness.app, beta.key.secret, alpha.endpoint);
    expect(response.status).toBe(404);
  });
});

describe.skipIf(!hasDatabase)('payment binding', () => {
  let harness: Harness;
  let tenant: Tenant;

  beforeAll(async () => {
    harness = await createHarness();
    tenant = await createTenant(harness, 'binding');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses a payment made for a different endpoint', async () => {
    const app = harness.app;
    // A second, cheaper endpoint in the same project.
    const cheap = await createTestEndpoint(app, tenant.projectId, tenant.org.owner.token, {
      path: '/cheap',
      amount: '0.001',
    });

    const refused = await callPaid(app, tenant.key.secret, cheap);
    const requirement = paymentRequirement(refused.body);
    expect(requirement.amount).toBe('1000');

    const completed = await completePayment(
      app,
      tenant.org.owner.token,
      requirement.paymentRequestId,
    );
    const reference = (completed.body['data'] as { reference: string }).reference;

    // Present the cheap endpoint's settled payment at the expensive one.
    const response = await callPaid(app, tenant.key.secret, tenant.endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference,
    });
    /*
     * 403, not 402. The agent did pay — just for something else — so "payment
     * required" would misdescribe the situation and invite it to retry the
     * same proof. The proof simply does not authorize this resource.
     */
    expect(response.status).toBe(403);
    expect(response.body['error']).toMatchObject({ code: 'PAYMENT_ENDPOINT_MISMATCH' });
  });

  it('refuses a correct request ID with the wrong reference', async () => {
    const refused = await callPaid(harness.app, tenant.key.secret, tenant.endpoint);
    const requirement = paymentRequirement(refused.body);
    await completePayment(harness.app, tenant.org.owner.token, requirement.paymentRequestId);

    const response = await callPaid(harness.app, tenant.key.secret, tenant.endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference: `0x${'b'.repeat(64)}`,
    });
    expect(response.status).toBe(402);
    expect(response.body['error']).toMatchObject({ code: 'PAYMENT_INVALID' });
  });

  it('refuses an unpaid payment request', async () => {
    const refused = await callPaid(harness.app, tenant.key.secret, tenant.endpoint);
    const requirement = paymentRequirement(refused.body);

    const response = await callPaid(harness.app, tenant.key.secret, tenant.endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference: `0x${'c'.repeat(64)}`,
    });
    expect(response.status).toBe(402);
  });

  it('refuses a malformed payment header', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/paid${tenant.endpoint.path}`,
      headers: {
        authorization: `Bearer ${tenant.key.secret}`,
        'meter402-payment': 'not-base64-json',
      },
    });
    expect(response.statusCode).toBe(402);
  });
});

describe.skipIf(!hasDatabase)('API key scope enforcement', () => {
  let harness: Harness;
  let tenant: Tenant;

  beforeAll(async () => {
    harness = await createHarness();
    tenant = await createTenant(harness, 'scopes');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses a paid call from a key without payments:write', async () => {
    const readOnly = await createTestApiKey(harness.app, tenant.projectId, tenant.org.owner.token, {
      environment: 'TEST',
      scopes: ['payments:read'],
    });
    const response = await callPaid(harness.app, readOnly.secret, tenant.endpoint);
    expect(response.status).toBe(403);
    expect(response.body['error']).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses the simulator to a key without payments:write', async () => {
    const readOnly = await createTestApiKey(harness.app, tenant.projectId, tenant.org.owner.token, {
      environment: 'TEST',
      scopes: ['payments:read'],
    });
    const refused = await callPaid(harness.app, tenant.key.secret, tenant.endpoint);
    const requirement = paymentRequirement(refused.body);

    const response = await call(harness.app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${requirement.paymentRequestId}/complete`,
      token: readOnly.secret,
    });
    expect(response.status).toBe(403);
  });

  it('refuses a receipt read from a key without payments:read', async () => {
    const writeOnly = await createTestApiKey(
      harness.app,
      tenant.projectId,
      tenant.org.owner.token,
      { environment: 'TEST', scopes: ['payments:write'] },
    );
    const settled = await settleOnce(harness, tenant);
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/receipts/${settled.receiptId}`,
      token: writeOnly.secret,
    });
    expect(response.status).toBe(403);
  });

  it('refuses endpoint creation to a machine credential entirely', async () => {
    // Configuration is a human act. A key that could create or reprice the
    // endpoints it pays for would be a considerable design mistake.
    const response = await call(harness.app, {
      method: 'POST',
      url: '/v1/endpoints',
      token: tenant.key.secret,
      payload: {
        projectId: tenant.projectId,
        name: 'Sneaky',
        path: '/sneaky',
        method: 'POST',
        environment: 'TEST',
        price: { amount: '0.01', asset: 'USDC' },
      },
    });
    expect(response.status).toBe(403);
  });
});

describe.skipIf(!hasDatabase)('TEST and LIVE never meet', () => {
  let harness: Harness;
  let tenant: Tenant;

  beforeAll(async () => {
    harness = await createHarness();
    tenant = await createTenant(harness, 'envs');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses a LIVE endpoint on a project without LIVE mode enabled', async () => {
    const response = await call(harness.app, {
      method: 'POST',
      url: '/v1/endpoints',
      token: tenant.org.owner.token,
      payload: {
        projectId: tenant.projectId,
        name: 'Live research',
        path: '/live-research',
        method: 'POST',
        environment: 'LIVE',
        price: { amount: '0.03', asset: 'USDC' },
      },
    });
    expect(response.status).toBe(409);
  });

  it('refuses a LIVE key on the paid surface of a TEST endpoint', async () => {
    const liveKey = await createTestApiKey(harness.app, tenant.projectId, tenant.org.owner.token, {
      environment: 'LIVE',
      scopes: ['payments:read', 'payments:write'],
    });
    // Environment is part of the endpoint lookup key, so a LIVE credential
    // cannot resolve the TEST definition of this route at all.
    const response = await callPaid(harness.app, liveKey.secret, tenant.endpoint);
    expect(response.status).toBe(404);
  });

  it('refuses the TEST simulator to a LIVE key', async () => {
    const liveKey = await createTestApiKey(harness.app, tenant.projectId, tenant.org.owner.token, {
      environment: 'LIVE',
      scopes: ['payments:read', 'payments:write'],
    });
    const refused = await callPaid(harness.app, tenant.key.secret, tenant.endpoint);
    const requirement = paymentRequirement(refused.body);

    const response = await call(harness.app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${requirement.paymentRequestId}/complete`,
      token: liveKey.secret,
    });
    expect(response.status).toBe(403);
    expect(response.body['error']).toMatchObject({ code: 'ENVIRONMENT_MISMATCH' });
  });

  it('prices a TEST endpoint on the testnet chain, never mainnet', async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/endpoints/${tenant.endpoint.id}`,
      token: tenant.org.owner.token,
    });
    expect(response.status).toBe(200);
    const data = response.body['data'] as { price: { chainId: number } };
    expect(data.price.chainId).toBe(84532);
  });
});

describe.skipIf(!hasDatabase)('the price snapshot is immutable', () => {
  let harness: Harness;
  let tenant: Tenant;

  beforeAll(async () => {
    harness = await createHarness();
    tenant = await createTenant(harness, 'snapshot');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('does not reprice an issued payment request when the endpoint is repriced', async () => {
    const app = harness.app;

    /* An agent is quoted 0.03 USDC. */
    const refused = await callPaid(app, tenant.key.secret, tenant.endpoint);
    const requirement = paymentRequirement(refused.body);
    expect(requirement.amount).toBe('30000');

    /* The merchant raises the price tenfold before the agent pays. */
    const repriced = await call(app, {
      method: 'PATCH',
      url: `/v1/endpoints/${tenant.endpoint.id}`,
      token: tenant.org.owner.token,
      payload: { price: { amount: '0.30', asset: 'USDC' } },
    });
    expect(repriced.status).toBe(200);
    expect((repriced.body['data'] as { price: { amount: string } }).price.amount).toBe('0.30');

    /* The outstanding request still owes what it said it owed. */
    const read = await call(app, {
      method: 'GET',
      url: `/v1/payment-requests/${requirement.paymentRequestId}`,
      token: tenant.org.owner.token,
    });
    expect((read.body['data'] as { amountMinorUnits: string }).amountMinorUnits).toBe('30000');

    /* Paying it settles the quoted amount, not the new one. */
    const completed = await completePayment(
      app,
      tenant.org.owner.token,
      requirement.paymentRequestId,
    );
    const data = completed.body['data'] as {
      reference: string;
      payment: { amountMinorUnits: string };
      receipt: { amountMinorUnits: string };
    };
    expect(data.payment.amountMinorUnits).toBe('30000');
    expect(data.receipt.amountMinorUnits).toBe('30000');

    /* And it is honoured. */
    const served = await callPaid(app, tenant.key.secret, tenant.endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference: data.reference,
    });
    expect(served.status).toBe(200);

    /* New callers are quoted the new price. */
    const nextRefusal = await callPaid(app, tenant.key.secret, tenant.endpoint);
    expect(paymentRequirement(nextRefusal.body).amount).toBe('300000');
  });

  it('refuses a price with more precision than the asset can hold', async () => {
    const response = await call(harness.app, {
      method: 'POST',
      url: '/v1/endpoints',
      token: tenant.org.owner.token,
      payload: {
        projectId: tenant.projectId,
        name: 'Too precise',
        path: '/too-precise',
        method: 'POST',
        environment: 'TEST',
        // USDC has 6 decimals; this would have to be truncated to fit.
        price: { amount: '0.0000001', asset: 'USDC' },
      },
    });
    expect(response.status).toBe(422);
    expect(response.body['error']).toMatchObject({ code: 'INVALID_PRICE' });
  });

  it('refuses a zero price', async () => {
    const response = await call(harness.app, {
      method: 'POST',
      url: '/v1/endpoints',
      token: tenant.org.owner.token,
      payload: {
        projectId: tenant.projectId,
        name: 'Free',
        path: '/free',
        method: 'POST',
        environment: 'TEST',
        price: { amount: '0', asset: 'USDC' },
      },
    });
    expect(response.status).toBe(422);
  });

  it('refuses a disabled endpoint', async () => {
    const disabled = await createTestEndpoint(
      harness.app,
      tenant.projectId,
      tenant.org.owner.token,
      { path: '/disabled' },
    );
    await call(harness.app, {
      method: 'PATCH',
      url: `/v1/endpoints/${disabled.id}`,
      token: tenant.org.owner.token,
      payload: { status: 'DISABLED' },
    });

    const response = await callPaid(harness.app, tenant.key.secret, disabled);
    expect(response.status).toBe(409);
    expect(response.body['error']).toMatchObject({ code: 'ENDPOINT_DISABLED' });
  });
});
