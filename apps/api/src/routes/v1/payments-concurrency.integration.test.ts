import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { payments, paymentReceipts, usageEvents } from '@meter402/database';
import {
  callPaid,
  createHarness,
  createTestApiKey,
  createTestEndpoint,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  paymentRequirement,
  call,
  type Harness,
} from '../../test-support/harness.js';

/**
 * Exactly-once, under real concurrency.
 *
 * Every other test in this suite runs one request at a time, which is exactly
 * the condition under which a check-then-insert race looks correct. These
 * tests fire simultaneous requests at the same payment request and count rows
 * in the database afterwards.
 *
 * The guarantee is not implemented by the row lock — it is implemented by
 * `UNIQUE (payments.payment_request_id)` and `UNIQUE (payment_receipts.payment_id)`.
 * If those constraints were dropped, these tests are what would notice.
 */

const CONCURRENCY = 20;

describe.skipIf(!hasDatabase)('concurrent payment completion', () => {
  let harness: Harness;
  let ownerToken: string;
  let endpoint: Awaited<ReturnType<typeof createTestEndpoint>>;
  let keySecret: string;

  beforeAll(async () => {
    harness = await createHarness();
    const org = await createTestOrganization(harness.app, 'race');
    ownerToken = org.owner.token;
    const projectId = await createTestProject(harness.app, org.organizationId, ownerToken, 'race');
    endpoint = await createTestEndpoint(harness.app, projectId, ownerToken, { path: '/race' });
    const key = await createTestApiKey(harness.app, projectId, ownerToken, {
      environment: 'TEST',
      scopes: ['payments:read', 'payments:write'],
    });
    keySecret = key.secret;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('produces exactly one payment and one receipt from 20 simultaneous completions', async () => {
    const app = harness.app;
    const db = harness.handle.db;

    const refused = await callPaid(app, keySecret, endpoint);
    const requirement = paymentRequirement(refused.body);

    /*
     * Fired without awaiting in between, so they genuinely overlap inside the
     * database rather than queueing behind one another in the test.
     */
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        call(app, {
          method: 'POST',
          url: `/v1/test/payment-requests/${requirement.paymentRequestId}/complete`,
          token: ownerToken,
        }),
      ),
    );

    // Every caller gets a success. A loser in the race is not an error: it
    // reads the winner's rows and returns them.
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    // Exactly one of them actually created the payment.
    const created = responses.filter(
      (response) => (response.body['data'] as { created: boolean }).created,
    );
    expect(created).toHaveLength(1);

    // All twenty describe the same payment and the same receipt.
    const paymentIds = new Set(
      responses.map(
        (response) => (response.body['data'] as { payment: { id: string } }).payment.id,
      ),
    );
    const receiptIds = new Set(
      responses.map(
        (response) => (response.body['data'] as { receipt: { id: string } }).receipt.id,
      ),
    );
    expect(paymentIds.size).toBe(1);
    expect(receiptIds.size).toBe(1);

    // And the database agrees, which is the assertion that actually matters.
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, requirement.paymentRequestId));
    expect(paymentRows).toHaveLength(1);

    const paymentId = paymentRows[0]?.id;
    expect(paymentId).toBeDefined();
    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, paymentId as string));
    expect(receiptRows).toHaveLength(1);
  });

  it('spends a payment exactly once across 20 simultaneous retries', async () => {
    const app = harness.app;
    const db = harness.handle.db;

    const refused = await callPaid(app, keySecret, endpoint);
    const requirement = paymentRequirement(refused.body);
    const completed = await call(app, {
      method: 'POST',
      url: `/v1/test/payment-requests/${requirement.paymentRequestId}/complete`,
      token: ownerToken,
    });
    const data = completed.body['data'] as { reference: string; payment: { id: string } };

    /* Twenty agents present the same valid proof at the same instant. */
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        callPaid(app, keySecret, endpoint, {
          paymentRequestId: requirement.paymentRequestId,
          reference: data.reference,
        }),
      ),
    );

    // One is served; the rest are told the payment is already spent.
    const served = responses.filter((response) => response.status === 200);
    const rejected = responses.filter((response) => response.status === 409);
    expect(served).toHaveLength(1);
    expect(rejected).toHaveLength(CONCURRENCY - 1);
    for (const response of rejected) {
      expect(response.body['error']).toMatchObject({ code: 'PAYMENT_ALREADY_USED' });
    }

    // One payment bought one request. Not twenty.
    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, data.payment.id));
    expect(usageRows).toHaveLength(1);
  });

  it('issues a distinct payment request to each of 20 simultaneous unpaid callers', async () => {
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => callPaid(harness.app, keySecret, endpoint)),
    );

    for (const response of responses) {
      expect(response.status).toBe(402);
    }

    /*
     * Each caller must get its own request. Sharing one would mean a single
     * payment silently authorized every concurrent caller.
     */
    const ids = new Set(
      responses.map((response) => paymentRequirement(response.body).paymentRequestId),
    );
    expect(ids.size).toBe(CONCURRENCY);
  });
});
