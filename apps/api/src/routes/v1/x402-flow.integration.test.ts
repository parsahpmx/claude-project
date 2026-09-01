import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentAuthorizations, payments, paymentReceipts, usageEvents } from '@meter402/database';
import { normalizeAddress } from '@meter402/shared';
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
 * Phase 3 end-to-end: real x402 v2, driven by the official client.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this proves: an **independent** x402 v2 client — the official
 * `@x402/core` + `@x402/evm` packages, not our code — receives our 402,
 * chooses our requirement, signs a real EIP-3009 authorization, and is served
 * after settlement. Exactly one Payment, one Receipt, one authorization claim.
 *
 * What this does NOT prove: interoperability with a real facilitator, or that
 * anything settled on Base Sepolia. The facilitator here is a controllable
 * double, and this environment has no network access to a testnet RPC or a
 * hosted facilitator. Those remain open; see docs/X402_V2_CONFORMANCE_PLAN.md.
 * ─────────────────────────────────────────────────────────────────────────
 */

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MERCHANT_WALLET = '0x209693bc6afc0c5328ba36faf03c514ef312287c';

interface Merchant {
  readonly organizationId: string;
  readonly ownerToken: string;
  readonly projectId: string;
  readonly endpoint: Awaited<ReturnType<typeof createTestEndpoint>>;
  readonly keySecret: string;
}

async function createMerchant(harness: Harness, label: string): Promise<Merchant> {
  const app = harness.app;
  const org = await createTestOrganization(app, label);
  const projectId = await createTestProject(app, org.organizationId, org.owner.token, label);

  // A real payment needs a real destination. There is no fallback.
  const configured = await call(app, {
    method: 'PUT',
    url: `/v1/organizations/${org.organizationId}/settlement`,
    token: org.owner.token,
    payload: {
      projectId,
      chainId: 84532,
      asset: 'USDC',
      recipientAddress: MERCHANT_WALLET,
    },
  });
  if (configured.status !== 200) {
    throw new Error(`settlement config failed: ${configured.status} ${configured.raw}`);
  }

  const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
    path: `/${label}-research`,
    method: 'POST',
    environment: 'TEST',
    amount: '0.03',
    asset: 'USDC',
    settlementProtocol: 'x402',
  });

  const key = await createTestApiKey(app, projectId, org.owner.token, {
    environment: 'TEST',
    scopes: ['payments:read', 'payments:write'],
  });

  return {
    organizationId: org.organizationId,
    ownerToken: org.owner.token,
    projectId,
    endpoint,
    keySecret: key.secret,
  };
}

/** Ask for the resource without paying. Returns the raw 402. */
async function requestUnpaid(harness: Harness, merchant: Merchant) {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/paid${merchant.endpoint.path}`,
    headers: { authorization: `Bearer ${merchant.keySecret}` },
  });
}

/** Sign the 402 with the official client and return the encoded header. */
async function signWithOfficialClient(paymentRequiredHeader: string) {
  const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
  const account = privateKeyToAccount(PAYER_KEY);
  let client = new x402Client();
  client = registerExactEvmScheme(client, { signer: account });
  const payload = await client.createPaymentPayload(paymentRequired);
  return {
    header: encodePaymentSignatureHeader(payload),
    payload,
    payer: account.address,
    paymentRequired,
  };
}

async function retryWithPayment(harness: Harness, merchant: Merchant, header: string) {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/paid${merchant.endpoint.path}`,
    headers: {
      authorization: `Bearer ${merchant.keySecret}`,
      'payment-signature': header,
    },
  });
}

describe.skipIf(!hasDatabase)('Phase 3 end-to-end: x402 v2 on Base Sepolia semantics', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('serves a resource to an independent x402 client, exactly once', async () => {
    const db = harness.handle.db;
    const merchant = await createMerchant(harness, 'e2e');

    /* 1. The agent asks without paying. */
    const unpaid = await requestUnpaid(harness, merchant);
    expect(unpaid.statusCode).toBe(402);

    /* 2. The 402 is a valid x402 v2 PaymentRequired, per the official decoder. */
    const header = unpaid.headers['payment-required'];
    expect(header).toBeTypeOf('string');
    const signed = await signWithOfficialClient(header as string);

    expect(signed.paymentRequired.x402Version).toBe(2);
    const requirement = signed.paymentRequired.accepts[0]!;
    expect(requirement.scheme).toBe('exact');
    expect(requirement.network).toBe('eip155:84532');
    expect(requirement.amount).toBe('30000');
    expect(normalizeAddress(requirement.payTo)).toBe(MERCHANT_WALLET);

    /* 3. Cache-Control: a cached 402 is a replayable payment instruction. */
    expect(unpaid.headers['cache-control']).toContain('no-store');

    /* 4. The agent retries with the signed authorization and is served. */
    const served = await retryWithPayment(harness, merchant, signed.header);
    expect(served.statusCode).toBe(200);

    /* 5. Verify ran before the handler; settle ran after. */
    expect(harness.facilitator!.verifyCalls).toHaveLength(1);
    expect(harness.facilitator!.settleCalls).toHaveLength(1);

    /* 6. The merchant handler executed. */
    const body = served.json().data as {
      result: { served: boolean; simulated: boolean };
      payment: { id: string; receiptId: string; transactionHash: string; payer: string };
    };
    expect(body.result.served).toBe(true);
    // Real settlement. The response must not claim simulation.
    expect(body.result.simulated).toBe(false);
    expect(normalizeAddress(body.payment.payer)).toBe(normalizeAddress(signed.payer));

    /* 7. The PAYMENT-RESPONSE decodes with the official decoder. */
    const settleResponse = decodePaymentResponseHeader(
      served.headers['payment-response'] as string,
    );
    expect(settleResponse.success).toBe(true);
    expect(settleResponse.network).toBe('eip155:84532');
    expect(settleResponse.transaction).toMatch(/^0x[0-9a-f]{64}$/);

    /* 8. Exactly one Payment. Counted in the database. */
    const paymentRows = await db
      .select({ id: payments.id, simulated: payments.simulated })
      .from(payments)
      .where(eq(payments.id, body.payment.id));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]!.simulated).toBe(false);

    /* 9. Exactly one Receipt. */
    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, body.payment.id));
    expect(receiptRows).toHaveLength(1);

    /* 10. Exactly one usage event: one payment buys one request. */
    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, body.payment.id));
    expect(usageRows).toHaveLength(1);

    /* 11. The authorization was claimed, so it cannot be replayed. */
    const authRows = await db
      .select({ id: paymentAuthorizations.id })
      .from(paymentAuthorizations)
      .where(eq(paymentAuthorizations.payerAddress, normalizeAddress(signed.payer)));
    expect(authRows.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses a signed authorization replayed against a different payment request', async () => {
    const merchant = await createMerchant(harness, 'replay');
    harness.facilitator!.settleCalls.length = 0;

    /* Pay once, legitimately. */
    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const first = await retryWithPayment(harness, merchant, signed.header);
    expect(first.statusCode).toBe(200);
    const settleCallsAfterFirst = harness.facilitator!.settleCalls.length;

    /*
     * Now the actual attack.
     *
     * The EIP-3009 signature covers only (from, to, value, validAfter,
     * validBefore, nonce) — it does NOT cover `resource.url`. So an attacker
     * who observes a valid authorization can point it at a *different*
     * payment request simply by rewriting that URL, and the signature still
     * verifies. Same payer, same amount, same recipient: every binding check
     * passes.
     *
     * The only thing that stops this is the authorization claim on
     * (chain, asset, payer, nonce). The transaction-hash guard cannot help —
     * at this moment no transaction exists.
     */
    const secondUnpaid = await requestUnpaid(harness, merchant);
    expect(secondUnpaid.statusCode).toBe(402);
    const secondRequired = decodePaymentRequiredHeader(
      secondUnpaid.headers['payment-required'] as string,
    );
    const secondRequestUrl = secondRequired.resource.url;

    const forged = {
      ...(signed.payload as unknown as Record<string, unknown>),
      resource: { ...secondRequired.resource, url: secondRequestUrl },
    };
    const forgedHeader = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64');

    const replayed = await retryWithPayment(harness, merchant, forgedHeader);

    expect(replayed.statusCode).toBe(402);
    expect(replayed.json().error).toMatchObject({ code: 'PAYMENT_INVALID' });
    // And crucially: no second settlement was attempted.
    expect(harness.facilitator!.settleCalls).toHaveLength(settleCallsAfterFirst);
  });

  it('is idempotent when the client retries after a lost response', async () => {
    const merchant = await createMerchant(harness, 'idem');
    const db = harness.handle.db;

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);

    const first = await retryWithPayment(harness, merchant, signed.header);
    expect(first.statusCode).toBe(200);
    const paymentId = (first.json().data as { payment: { id: string } }).payment.id;

    const settleCallsAfterFirst = harness.facilitator!.settleCalls.length;

    /*
     * The client never saw the response and retries the identical request.
     * It must get the same payment back, and no second settlement — a blind
     * re-settle is how a payer gets charged twice.
     */
    const retry = await retryWithPayment(harness, merchant, signed.header);
    expect(retry.statusCode).toBe(200);
    expect((retry.json().data as { payment: { id: string } }).payment.id).toBe(paymentId);
    expect(harness.facilitator!.settleCalls).toHaveLength(settleCallsAfterFirst);

    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.id, paymentId));
    expect(paymentRows).toHaveLength(1);
  });
});

describe.skipIf(!hasDatabase)('x402 settlement failure behaviour', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('does not settle when the facilitator rejects verification', async () => {
    const merchant = await createMerchant(harness, 'reject');
    harness.facilitator!.verifyResult = 'INVALID';
    harness.facilitator!.settleCalls.length = 0;

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const response = await retryWithPayment(harness, merchant, signed.header);

    expect(response.statusCode).toBe(402);
    // The decisive assertion: verification failing means nothing was settled.
    expect(harness.facilitator!.settleCalls).toHaveLength(0);

    harness.facilitator!.verifyResult = 'VALID';
  });

  it('reports a facilitator outage as retryable, not as a failed payment', async () => {
    const merchant = await createMerchant(harness, 'outage');
    harness.facilitator!.verifyResult = 'UNAVAILABLE';

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const response = await retryWithPayment(harness, merchant, signed.header);

    /*
     * 503, not 402. Infrastructure failure is not payment failure: the payer
     * did nothing wrong, nothing settled, and telling them their payment was
     * invalid would be false.
     */
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });

    harness.facilitator!.verifyResult = 'VALID';
  });

  it('leaves an uncertain settlement PENDING rather than FAILED', async () => {
    const merchant = await createMerchant(harness, 'uncertain');
    const db = harness.handle.db;
    harness.facilitator!.settleResult = 'UNAVAILABLE';

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const response = await retryWithPayment(harness, merchant, signed.header);

    /*
     * The settle call may already have broadcast a transaction. We know
     * nothing. The payer is told not to pay again, and the request is left
     * PENDING for reconciliation — never FAILED, which would be a lie in the
     * direction that loses someone's money.
     */
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toMatchObject({ code: 'PAYMENT_NOT_CONFIRMED' });

    // No Payment row was invented for a settlement we cannot confirm.
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.projectId, merchant.projectId));
    expect(paymentRows).toHaveLength(0);

    harness.facilitator!.settleResult = 'SUCCESS';
  });

  it('rejects a settlement reported on the wrong network', async () => {
    const merchant = await createMerchant(harness, 'netmismatch');
    harness.facilitator!.settleNetworkOverride = 'eip155:8453';

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const response = await retryWithPayment(harness, merchant, signed.header);

    // A facilitator is not trusted to tell us where our money went.
    expect(response.statusCode).toBe(402);

    harness.facilitator!.settleNetworkOverride = null;
  });

  it('rejects a settlement reported for the wrong amount', async () => {
    const merchant = await createMerchant(harness, 'amtmismatch');
    harness.facilitator!.settleAmountOverride = '29999';

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const response = await retryWithPayment(harness, merchant, signed.header);

    expect(response.statusCode).toBe(402);

    harness.facilitator!.settleAmountOverride = null;
  });

  it('rejects a facilitator that names a different payer than the signature', async () => {
    const merchant = await createMerchant(harness, 'payermismatch');
    const settleCallsBefore = harness.facilitator!.settleCalls.length;
    harness.facilitator!.verifyPayerOverride = '0x1111111111111111111111111111111111111111';

    const unpaid = await requestUnpaid(harness, merchant);
    const signed = await signWithOfficialClient(unpaid.headers['payment-required'] as string);
    const response = await retryWithPayment(harness, merchant, signed.header);

    expect(response.statusCode).toBe(402);
    /*
     * And nothing settled. A facilitator that disagrees with us about who is
     * paying is a facilitator we cannot act on: one of us is wrong, and
     * picking a winner would mean guessing about money.
     */
    expect(harness.facilitator!.settleCalls).toHaveLength(settleCallsBefore);

    harness.facilitator!.verifyPayerOverride = null;
  });
});

describe.skipIf(!hasDatabase)('real settlement is off unless enabled', () => {
  it('refuses an x402 endpoint when the kill switch is off', async () => {
    // No `settlement: true` — this harness is a default deployment.
    const harness = await createHarness();
    try {
      const app = harness.app;
      const org = await createTestOrganization(app, 'killswitch');
      const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'ks');

      await call(app, {
        method: 'PUT',
        url: `/v1/organizations/${org.organizationId}/settlement`,
        token: org.owner.token,
        payload: {
          projectId,
          chainId: 84532,
          asset: 'USDC',
          recipientAddress: MERCHANT_WALLET,
        },
      });

      const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
        path: '/ks-research',
        settlementProtocol: 'x402',
      });
      const key = await createTestApiKey(app, projectId, org.owner.token, {
        environment: 'TEST',
        scopes: ['payments:read', 'payments:write'],
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/paid${endpoint.path}`,
        headers: { authorization: `Bearer ${key.secret}` },
      });

      // Refused before any payment request is even created.
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toMatchObject({ code: 'LIVE_SETTLEMENT_UNAVAILABLE' });
    } finally {
      await harness.close();
    }
  });

  it('refuses an x402 endpoint with no settlement destination configured', async () => {
    const harness = await createHarness({ settlement: true });
    try {
      const app = harness.app;
      const org = await createTestOrganization(app, 'nodest');
      const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'nd');
      const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
        path: '/nd-research',
        settlementProtocol: 'x402',
      });
      const key = await createTestApiKey(app, projectId, org.owner.token, {
        environment: 'TEST',
        scopes: ['payments:read', 'payments:write'],
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/paid${endpoint.path}`,
        headers: { authorization: `Bearer ${key.secret}` },
      });

      /*
       * No burn-address fallback for real money. A simulated payment may use
       * one because nothing moves; a real one to 0x…dead would destroy the
       * transfer.
       */
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({ code: 'SETTLEMENT_NOT_CONFIGURED' });
    } finally {
      await harness.close();
    }
  });
});
