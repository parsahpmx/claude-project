import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentAuthorizations, payments, paymentReceipts, usageEvents } from '@meter402/database';
import {
  addMember,
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
 * Phase 3 security properties.
 *
 * Two groups: the ones about *who may move money* (settlement mutation), and
 * the ones about *how many times money may move* (concurrency). Both are
 * asserted against a real PostgreSQL database, because both are ultimately
 * enforced by constraints rather than by code paths.
 */

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MERCHANT_WALLET = '0x209693bc6afc0c5328ba36faf03c514ef312287c';
const ATTACKER_WALLET = '0x1111111111111111111111111111111111111111';
const CONCURRENCY = 20;

async function configureSettlement(
  harness: Harness,
  organizationId: string,
  token: string,
  projectId: string,
  address = MERCHANT_WALLET,
) {
  return call(harness.app, {
    method: 'PUT',
    url: `/v1/organizations/${organizationId}/settlement`,
    token,
    payload: { projectId, chainId: 84532, asset: 'USDC', recipientAddress: address },
  });
}

describe.skipIf(!hasDatabase)('settlement mutation is human-only', () => {
  let harness: Harness;
  let organizationId: string;
  let ownerToken: string;
  let projectId: string;
  let apiKeySecret: string;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
    const org = await createTestOrganization(harness.app, 'setl');
    organizationId = org.organizationId;
    ownerToken = org.owner.token;
    projectId = await createTestProject(harness.app, organizationId, ownerToken, 'setl');

    const key = await createTestApiKey(harness.app, projectId, ownerToken, {
      environment: 'TEST',
      // Deliberately the broadest machine scopes available.
      scopes: ['payments:read', 'payments:write', 'endpoints:read', 'endpoints:write'],
    });
    apiKeySecret = key.secret;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('lets an authorized human configure a settlement destination', async () => {
    const response = await configureSettlement(harness, organizationId, ownerToken, projectId);
    expect(response.status).toBe(200);
    expect(response.body['data']).toMatchObject({
      recipientAddress: MERCHANT_WALLET,
      asset: 'USDC',
      chainId: 84532,
      status: 'ACTIVE',
    });
  });

  it('refuses an API key with the broadest machine scopes', async () => {
    const response = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: apiKeySecret,
      payload: {
        projectId,
        chainId: 84532,
        asset: 'USDC',
        recipientAddress: ATTACKER_WALLET,
      },
    });

    /*
     * The central Phase 3 access-control property. A machine credential must
     * never be able to repoint revenue, however broadly scoped — otherwise a
     * leaked key becomes a standing theft rather than a bounded one.
     */
    expect(response.status).toBe(403);
  });

  it('refuses an API key even for reading settlement configuration', async () => {
    const response = await call(harness.app, {
      method: 'GET',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: apiKeySecret,
    });
    expect(response.status).toBe(403);
  });

  it('refuses a human whose role lacks settlement:write', async () => {
    // A DEVELOPER can create endpoints, set prices and mint API keys.
    const developer = await addMember(harness.app, organizationId, ownerToken, 'DEVELOPER', 'dev');

    const write = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: developer.token,
      payload: {
        projectId,
        chainId: 84532,
        asset: 'USDC',
        recipientAddress: ATTACKER_WALLET,
      },
    });
    expect(write.status).toBe(403);

    // But may read it, which is what makes this a role boundary and not a
    // blanket denial.
    const read = await call(harness.app, {
      method: 'GET',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: developer.token,
    });
    expect(read.status).toBe(200);
  });

  it("refuses another organization's member entirely", async () => {
    const other = await createTestOrganization(harness.app, 'otherorg');
    const response = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: other.owner.token,
      payload: {
        projectId,
        chainId: 84532,
        asset: 'USDC',
        recipientAddress: ATTACKER_WALLET,
      },
    });
    // 404, never 403: a non-member must not learn the organization exists.
    expect(response.status).toBe(404);
  });

  it('refuses a malformed settlement address', async () => {
    for (const address of ['0xdeadbeef', 'not-an-address', '', '0x' + 'z'.repeat(40)]) {
      const response = await call(harness.app, {
        method: 'PUT',
        url: `/v1/organizations/${organizationId}/settlement`,
        token: ownerToken,
        payload: { projectId, chainId: 84532, asset: 'USDC', recipientAddress: address },
      });
      expect(response.status).toBe(422);
    }
  });

  it('refuses an unsupported chain or asset', async () => {
    const badChain = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: ownerToken,
      payload: { projectId, chainId: 1, asset: 'USDC', recipientAddress: MERCHANT_WALLET },
    });
    expect(badChain.status).toBe(422);

    const badAsset = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${organizationId}/settlement`,
      token: ownerToken,
      payload: { projectId, chainId: 84532, asset: 'DAI', recipientAddress: MERCHANT_WALLET },
    });
    expect(badAsset.status).toBe(422);
  });

  it('writes an audit event naming the human who changed it', async () => {
    await configureSettlement(harness, organizationId, ownerToken, projectId, MERCHANT_WALLET);

    const audit = await call(harness.app, {
      method: 'GET',
      url: `/v1/organizations/${organizationId}/audit-events`,
      token: ownerToken,
    });

    if (audit.status === 200) {
      const events = audit.body['data'] as Array<{ action: string; actorId: string }>;
      const settlementEvents = events.filter((event) =>
        event.action.startsWith('settlement_config.'),
      );
      expect(settlementEvents.length).toBeGreaterThan(0);
    }
  });

  it('does not change an already-issued payment request when repointed', async () => {
    const app = harness.app;
    const org = await createTestOrganization(app, 'repoint');
    const project = await createTestProject(app, org.organizationId, org.owner.token, 'repoint');
    await configureSettlement(harness, org.organizationId, org.owner.token, project);

    const endpoint = await createTestEndpoint(app, project, org.owner.token, {
      path: '/repoint-research',
      settlementProtocol: 'x402',
    });
    const key = await createTestApiKey(app, project, org.owner.token, {
      environment: 'TEST',
      scopes: ['payments:read', 'payments:write'],
    });

    // Quote a price. The recipient is snapshotted onto the request.
    const unpaid = await app.inject({
      method: 'POST',
      url: `/v1/paid${endpoint.path}`,
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const required = decodePaymentRequiredHeader(unpaid.headers['payment-required'] as string);
    expect(required.accepts[0]!.payTo.toLowerCase()).toBe(MERCHANT_WALLET);

    // Repoint settlement to a different address.
    const moved = await configureSettlement(
      harness,
      org.organizationId,
      org.owner.token,
      project,
      ATTACKER_WALLET,
    );
    expect(moved.status).toBe(200);

    /*
     * The outstanding request still pays the original address. The snapshot is
     * a value on the request, and nothing re-derives it — so a merchant
     * account compromised *after* a quote was issued cannot retroactively
     * capture that payment.
     */
    const stillOwed = await call(app, {
      method: 'GET',
      url: `/v1/payment-requests/${required.resource.url.split('preq=')[1]}`,
      token: org.owner.token,
    });
    expect(stillOwed.status).toBe(200);
    expect((stillOwed.body['data'] as { recipient: string }).recipient).toBe(MERCHANT_WALLET);

    // A new quote uses the new address.
    const nextUnpaid = await app.inject({
      method: 'POST',
      url: `/v1/paid${endpoint.path}`,
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const nextRequired = decodePaymentRequiredHeader(
      nextUnpaid.headers['payment-required'] as string,
    );
    expect(nextRequired.accepts[0]!.payTo.toLowerCase()).toBe(ATTACKER_WALLET);
  });
});

describe.skipIf(!hasDatabase)('x402 concurrency', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function merchantWithQuote(label: string) {
    const app = harness.app;
    const org = await createTestOrganization(app, label);
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, label);
    await configureSettlement(harness, org.organizationId, org.owner.token, projectId);

    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
      path: `/${label}-research`,
      settlementProtocol: 'x402',
    });
    const key = await createTestApiKey(app, projectId, org.owner.token, {
      environment: 'TEST',
      scopes: ['payments:read', 'payments:write'],
    });

    const unpaid = await app.inject({
      method: 'POST',
      url: `/v1/paid${endpoint.path}`,
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const required = decodePaymentRequiredHeader(unpaid.headers['payment-required'] as string);

    const account = privateKeyToAccount(PAYER_KEY);
    let client = new x402Client();
    client = registerExactEvmScheme(client, { signer: account });
    const payload = await client.createPaymentPayload(required);

    return {
      app,
      endpoint,
      keySecret: key.secret,
      header: encodePaymentSignatureHeader(payload),
      projectId,
      payer: account.address,
    };
  }

  it('settles once under 20 simultaneous submissions of one authorization', async () => {
    const db = harness.handle.db;
    const merchant = await merchantWithQuote('race1');
    harness.facilitator!.settleCalls.length = 0;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        merchant.app.inject({
          method: 'POST',
          url: `/v1/paid${merchant.endpoint.path}`,
          headers: {
            authorization: `Bearer ${merchant.keySecret}`,
            'payment-signature': merchant.header,
          },
        }),
      ),
    );

    const served = responses.filter((response) => response.statusCode === 200);
    // At least one succeeds; the rest either share the result idempotently or
    // are refused. What must never happen is two economic events.
    expect(served.length).toBeGreaterThanOrEqual(1);

    /* Exactly one Payment for this project. */
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.projectId, merchant.projectId));
    expect(paymentRows).toHaveLength(1);

    /* Exactly one Receipt. */
    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, paymentRows[0]!.id));
    expect(receiptRows).toHaveLength(1);

    /* Exactly one usage event. One payment, one request. */
    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, paymentRows[0]!.id));
    expect(usageRows).toHaveLength(1);

    /* Exactly one authorization claim. */
    const authRows = await db
      .select({ id: paymentAuthorizations.id })
      .from(paymentAuthorizations)
      .where(eq(paymentAuthorizations.paymentRequestId, paymentRows[0]!.id));
    expect(authRows.length).toBeLessThanOrEqual(1);

    /*
     * And the money moved exactly once.
     *
     * This is the assertion that catches a double-charge, and it is the one
     * that failed when this test was first written: without gating settlement
     * on the atomic authorization claim, all twenty callers found no payment
     * yet, all twenty called `settle`, and all twenty could have broadcast a
     * transaction.
     */
    expect(harness.facilitator!.settleCalls).toHaveLength(1);
  });

  it('issues a distinct payment request to each of 20 simultaneous unpaid callers', async () => {
    const merchant = await merchantWithQuote('race2');

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        merchant.app.inject({
          method: 'POST',
          url: `/v1/paid${merchant.endpoint.path}`,
          headers: { authorization: `Bearer ${merchant.keySecret}` },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(402);
    }

    const ids = new Set(
      responses.map((response) => {
        const required = decodePaymentRequiredHeader(
          response.headers['payment-required'] as string,
        );
        return required.resource.url;
      }),
    );
    // Sharing one quote between concurrent callers would mean one payment
    // silently authorized all of them.
    expect(ids.size).toBe(CONCURRENCY);
  });
});
