import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { payments, paymentReceipts, usageEvents } from '@meter402/database';
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
} from '../../test-support/harness.js';

/**
 * The Phase 2 release gate.
 *
 * One scenario, end to end, through the real HTTP surface and a real database:
 * a merchant publishes a paid endpoint, an agent is refused, a developer pays
 * in TEST mode, the agent retries and is served. If this test fails, the phase
 * does not ship.
 *
 * The assertion that matters most is not "the agent got a 200" — it is that
 * **exactly one Payment and exactly one Receipt exist**, counted directly in
 * the database rather than inferred from the API. A double-charged agent and a
 * duplicated receipt are the two failures a payments product cannot have.
 */

describe.skipIf(!hasDatabase)('Phase 2 end-to-end: 402 → pay → retry → served', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('runs the full paid-request lifecycle exactly once', async () => {
    const app = harness.app;
    const db = harness.handle.db;

    /* 1. A merchant exists and has a project. */
    const org = await createTestOrganization(app, 'e2e');
    const projectId = await createTestProject(app, org.organizationId, org.owner.token, 'e2e');

    /* 2. The merchant publishes POST /research at 0.03 USDC in TEST. */
    const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
      path: '/research',
      method: 'POST',
      environment: 'TEST',
      amount: '0.03',
      asset: 'USDC',
    });

    /* 3. An agent gets a TEST key that may pay. */
    const key = await createTestApiKey(app, projectId, org.owner.token, {
      environment: 'TEST',
      scopes: ['payments:read', 'payments:write'],
    });

    /* 4. The agent calls without paying and is refused with a 402. */
    const refused = await callPaid(app, key.secret, endpoint);
    expect(refused.status).toBe(402);

    /* 5. The 402 carries a machine-readable requirement. */
    const requirement = paymentRequirement(refused.body);
    expect(requirement.paymentRequestId).toMatch(/^preq_/);
    // 0.03 USDC at 6 decimals is 30000 minor units, as a string — never a
    // JSON number, which would be a double.
    expect(requirement.amount).toBe('30000');
    expect(requirement.asset.symbol).toBe('USDC');
    expect(requirement.asset.decimals).toBe(6);
    expect(requirement.chain.id).toBe(84532);
    expect(typeof requirement.recipient).toBe('string');
    expect(Date.parse(requirement.expiresAt)).toBeGreaterThan(Date.now());

    /* 6. A 402 must never be cached: it is a payment instruction. */
    expect(refused.headers['cache-control']).toContain('no-store');

    /* 7. The agent retries with a made-up reference and is still refused. */
    const forged = await callPaid(app, key.secret, endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference: `0x${'a'.repeat(64)}`,
    });
    expect(forged.status).toBe(402);

    /* 8. The developer completes the payment in the TEST simulator. */
    const completed = await completePayment(app, org.owner.token, requirement.paymentRequestId);
    expect(completed.status).toBe(200);
    const completedData = completed.body['data'] as {
      reference: string;
      created: boolean;
      payment: { id: string; status: string; simulated: boolean; amountMinorUnits: string };
      receipt: { id: string; simulated: boolean; amountMinorUnits: string };
      paymentRequest: { status: string };
    };

    /* 9. The payment is CONFIRMED, simulated, and for the snapshot amount. */
    expect(completedData.created).toBe(true);
    expect(completedData.payment.status).toBe('CONFIRMED');
    expect(completedData.payment.simulated).toBe(true);
    expect(completedData.payment.amountMinorUnits).toBe('30000');
    expect(completedData.paymentRequest.status).toBe('CONFIRMED');

    /* 10. A receipt exists and says plainly that it is simulated. */
    expect(completedData.receipt.id).toMatch(/^rcpt_/);
    expect(completedData.receipt.simulated).toBe(true);
    expect(completedData.receipt.amountMinorUnits).toBe('30000');

    /* 11. The agent retries with the real reference and is served. */
    const served = await callPaid(app, key.secret, endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference: completedData.reference,
    });
    expect(served.status).toBe(200);

    /* 12. The merchant handler actually ran. */
    const servedData = served.body['data'] as {
      result: { served: boolean; simulated: boolean };
      endpoint: { id: string };
      payment: { id: string; receiptId: string; amountMinorUnits: string };
    };
    expect(servedData.result.served).toBe(true);
    expect(servedData.endpoint.id).toBe(endpoint.id);
    expect(servedData.payment.amountMinorUnits).toBe('30000');
    expect(servedData.payment.receiptId).toBe(completedData.receipt.id);

    /* 13. The response identifies the receipt, so an agent can reconcile. */
    expect(served.headers['meter402-receipt-id']).toBe(completedData.receipt.id);

    /* 14. Exactly one Payment exists for this request. Counted in the DB. */
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, requirement.paymentRequestId));
    expect(paymentRows).toHaveLength(1);

    /* 15. Exactly one Receipt exists for that payment. */
    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, completedData.payment.id));
    expect(receiptRows).toHaveLength(1);

    /* 16. Exactly one usage event: the payment bought exactly one request. */
    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, completedData.payment.id));
    expect(usageRows).toHaveLength(1);

    /* 17. Replaying the same proof buys nothing. */
    const replayed = await callPaid(app, key.secret, endpoint, {
      paymentRequestId: requirement.paymentRequestId,
      reference: completedData.reference,
    });
    expect(replayed.status).toBe(409);
    expect(replayed.body['error']).toMatchObject({ code: 'PAYMENT_ALREADY_USED' });

    /* 18. And it created no second usage event. */
    const usageAfterReplay = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, completedData.payment.id));
    expect(usageAfterReplay).toHaveLength(1);

    /* 19. Completing again is idempotent, not a second payment. */
    const recompleted = await completePayment(app, org.owner.token, requirement.paymentRequestId);
    expect(recompleted.status).toBe(200);
    const recompletedData = recompleted.body['data'] as {
      created: boolean;
      payment: { id: string };
      receipt: { id: string };
    };
    expect(recompletedData.created).toBe(false);
    expect(recompletedData.payment.id).toBe(completedData.payment.id);
    expect(recompletedData.receipt.id).toBe(completedData.receipt.id);

    /* 20. Still exactly one payment and one receipt. */
    const paymentsAfter = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, requirement.paymentRequestId));
    expect(paymentsAfter).toHaveLength(1);
    const receiptsAfter = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, completedData.payment.id));
    expect(receiptsAfter).toHaveLength(1);

    /* 21. The receipt is readable by ID and reports the same money. */
    const receiptRead = await call(app, {
      method: 'GET',
      url: `/v1/receipts/${completedData.receipt.id}`,
      token: org.owner.token,
    });
    expect(receiptRead.status).toBe(200);
    expect(receiptRead.body['data']).toMatchObject({
      amountMinorUnits: '30000',
      simulated: true,
      environment: 'TEST',
    });

    /* 22. A fresh call starts a new payment request: access is per payment. */
    const secondRefusal = await callPaid(app, key.secret, endpoint);
    expect(secondRefusal.status).toBe(402);
    const secondRequirement = paymentRequirement(secondRefusal.body);
    expect(secondRequirement.paymentRequestId).not.toBe(requirement.paymentRequestId);
    expect(secondRequirement.amount).toBe('30000');

    /* 23. And paying it authorizes exactly one further request. */
    const secondCompletion = await completePayment(
      app,
      org.owner.token,
      secondRequirement.paymentRequestId,
    );
    expect(secondCompletion.status).toBe(200);
    const secondReference = (secondCompletion.body['data'] as { reference: string }).reference;
    // A reference is bound to its own request: each derivation is distinct.
    expect(secondReference).not.toBe(completedData.reference);

    const secondServed = await callPaid(app, key.secret, endpoint, {
      paymentRequestId: secondRequirement.paymentRequestId,
      reference: secondReference,
    });
    expect(secondServed.status).toBe(200);
  });
});
