import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  payments,
  paymentReceipts,
  paymentRequests,
  settlementReconciliations,
  usageEvents,
} from '@meter402/database';
import type { SettlementOracle } from '@meter402/blockchain';
import { createHarness, hasDatabase, type Harness } from '../../test-support/harness.js';
import { createUncertainSettlement, fakeSettlementTx } from '../../test-support/uncertainty.js';
import { FakeSettlementOracle } from '../../test-support/fake-oracle.js';
import {
  runReconciliationPass,
  type ReconciliationDeps,
} from '../../modules/payments/reconciliation.service.js';
import { findReconciliationByRequest } from '../../modules/payments/reconciliation.repository.js';

/**
 * Reconciliation of uncertain settlements.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The scenario these tests exist for is the nastiest one in the system: the
 * facilitator settled, the money moved, and Meter402 never saw the response.
 * The payer is out of pocket and has been served nothing. Every other
 * guarantee in the product is downstream of getting this right.
 *
 * The uncertainty is produced genuinely — the facilitator double reports a
 * timeout *after* recording that it settled — rather than by writing a PENDING
 * row by hand. That matters: it exercises the real enqueue path, in the real
 * transaction, from the real code that handles the failure.
 * ─────────────────────────────────────────────────────────────────────────
 */

const CONCURRENCY = 20;

/**
 * Empty the queue before each scenario.
 *
 * A reconciliation pass deliberately drains the *whole* queue — that is what a
 * worker does. These tests share a database, so without this each pass would
 * also pick up jobs left by earlier tests and the counts would describe the
 * whole file rather than the case under test. (It would also make several
 * jobs share one fake transaction hash, which the transaction-replay guard
 * correctly refuses — a true rejection, but not the one being tested.)
 */
async function clearQueue(harness: Harness): Promise<void> {
  await harness.handle.db.delete(settlementReconciliations);
}

function deps(harness: Harness, oracle: SettlementOracle): ReconciliationDeps {
  return {
    db: harness.handle.db,
    config: harness.config,
    oracles: new Map([[84532, oracle]]),
  };
}

describe.skipIf(!hasDatabase)('reconciliation: the lost settlement response', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  beforeEach(async () => {
    await clearQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('schedules reconciliation in the same transaction that records uncertainty', async () => {
    const { paymentRequestId } = await createUncertainSettlement(harness, 'sched');

    const job = await findReconciliationByRequest(harness.handle.db, paymentRequestId);
    expect(job).not.toBeNull();
    expect(job?.status).toBe('PENDING');
    // Enough to ask the chain, and nothing that could spend the authorization.
    expect(job?.authorizationNonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(job?.chainId).toBe(84532);
  });

  it('confirms the payment when the chain shows the authorization was used', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'recover');

    // Before reconciliation: no payment exists at all.
    const before = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(before).toHaveLength(0);

    /* The chain says the transfer happened, at this exact transaction. */
    const queued = await findReconciliationByRequest(db, paymentRequestId);
    const settlementTx = fakeSettlementTx();
    const oracle = new FakeSettlementOracle();
    oracle.settledAt(queued!.authorizationNonce, settlementTx);

    const outcome = await runReconciliationPass(deps(harness, oracle));
    expect(outcome.confirmed).toBeGreaterThanOrEqual(1);

    /* The payment is now CONFIRMED, and there is exactly one. */
    const paymentRows = await db
      .select({
        id: payments.id,
        status: payments.status,
        reference: payments.externalTransactionReference,
      })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]!.status).toBe('CONFIRMED');
    expect(paymentRows[0]!.reference).toBe(settlementTx);

    /* Exactly one Receipt. */
    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, paymentRows[0]!.id));
    expect(receiptRows).toHaveLength(1);

    /* Exactly one usage event: the resource was served once. */
    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, paymentRows[0]!.id));
    expect(usageRows).toHaveLength(1);

    /* And the request itself reached CONFIRMED through the state machine. */
    const requestRows = await db
      .select({ status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentRequestId));
    expect(requestRows[0]!.status).toBe('CONFIRMED');

    /* The job is resolved and will not be claimed again. */
    const job = await findReconciliationByRequest(db, paymentRequestId);
    expect(job?.status).toBe('RESOLVED_CONFIRMED');
  });

  it('is idempotent across 20 repeated passes', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'idem');

    const oracle = new FakeSettlementOracle();
    oracle.settled(fakeSettlementTx());

    for (let i = 0; i < CONCURRENCY; i += 1) {
      await runReconciliationPass(deps(harness, oracle));
    }

    /*
     * Twenty runs, one of everything. The guarantee comes from the same
     * constraints the live path uses, so reconciliation cannot produce
     * duplicates that the live path could not.
     */
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(1);

    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, paymentRows[0]!.id));
    expect(receiptRows).toHaveLength(1);

    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, paymentRows[0]!.id));
    expect(usageRows).toHaveLength(1);
  });

  it('never calls the facilitator to settle again', async () => {
    const { paymentRequestId } = await createUncertainSettlement(harness, 'nosettle');
    const settleCallsBefore = harness.facilitator!.settleCalls.length;

    const oracle = new FakeSettlementOracle();
    oracle.settled(fakeSettlementTx());
    await runReconciliationPass(deps(harness, oracle));

    /*
     * The decisive property. Reconciliation determines what already happened;
     * a reconciler that could re-settle would be a machine for producing
     * exactly the double-charge it exists to repair.
     */
    expect(harness.facilitator!.settleCalls).toHaveLength(settleCallsBefore);

    const job = await findReconciliationByRequest(harness.handle.db, paymentRequestId);
    expect(job?.status).toBe('RESOLVED_CONFIRMED');
  });
});

describe.skipIf(!hasDatabase)('reconciliation: the opposite case', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  beforeEach(async () => {
    await clearQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('does not conclude failure while the authorization could still be used', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'undet');

    // Unused, but still inside its validity window.
    const oracle = new FakeSettlementOracle();
    oracle.neverSettled();

    const outcome = await runReconciliationPass(deps(harness, oracle));
    expect(outcome.failed).toBe(0);
    expect(outcome.retried).toBeGreaterThanOrEqual(1);

    /*
     * Still PENDING, and no payment invented in either direction. Anyone
     * holding this authorization can still submit it, so calling it failed
     * would risk denying a payer a service they are about to pay for.
     */
    const job = await findReconciliationByRequest(db, paymentRequestId);
    expect(job?.status).toBe('PENDING');
    expect(job!.attempts).toBeGreaterThanOrEqual(1);

    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(0);
  });

  it('reaches a definitive failure once the authorization has expired unused', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'failed');

    const oracle = new FakeSettlementOracle();
    oracle.neverSettled();

    /*
     * Advance past the authorization deadline. Only now is "never settled" a
     * fact rather than a guess: an expired nonce can never be consumed.
     */
    const job = await findReconciliationByRequest(db, paymentRequestId);
    const afterDeadline = new Date((job!.validBefore?.getTime() ?? Date.now()) + 60_000);

    const outcome = await runReconciliationPass(deps(harness, oracle), { now: afterDeadline });
    expect(outcome.failed).toBe(1);

    const resolved = await findReconciliationByRequest(db, paymentRequestId);
    expect(resolved?.status).toBe('RESOLVED_FAILED');

    // No payment and no receipt were created for a settlement that never was.
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(0);

    // The request reached a legal terminal state through the state machine.
    const requestRows = await db
      .select({ status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentRequestId));
    expect(requestRows[0]!.status).toBe('EXPIRED');
  });

  it('retries rather than concluding anything when the chain is unreachable', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'rpcdown');

    const oracle = new FakeSettlementOracle();
    oracle.unavailable();

    // Past the deadline, so a careless implementation would call this failed.
    const job = await findReconciliationByRequest(db, paymentRequestId);
    const afterDeadline = new Date((job!.validBefore?.getTime() ?? Date.now()) + 60_000);

    const outcome = await runReconciliationPass(deps(harness, oracle), { now: afterDeadline });
    expect(outcome.failed).toBe(0);

    const stillPending = await findReconciliationByRequest(db, paymentRequestId);
    expect(stillPending?.status).toBe('PENDING');
  });

  it('gives up as EXHAUSTED rather than guessing a failure', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'exhaust');

    const oracle = new FakeSettlementOracle();
    oracle.unavailable();

    /*
     * Run until the attempt budget is spent. Each pass must be scheduled past
     * the previous backoff, so time is advanced deliberately.
     */
    let now = new Date();
    for (let i = 0; i < 15; i += 1) {
      now = new Date(now.getTime() + 4 * 3_600_000);
      await runReconciliationPass(deps(harness, oracle), { now });
    }

    const job = await findReconciliationByRequest(db, paymentRequestId);
    /*
     * EXHAUSTED, not RESOLVED_FAILED. We still do not know what happened, and
     * that distinction is the difference between "needs a human" and "we told
     * a payer their money vanished".
     */
    expect(job?.status).toBe('EXHAUSTED');

    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(0);
  });
});

describe.skipIf(!hasDatabase)('reconciliation concurrency', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
  });

  beforeEach(async () => {
    await clearQueue(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('produces one canonical outcome under 20 concurrent workers', async () => {
    const db = harness.handle.db;
    const { paymentRequestId } = await createUncertainSettlement(harness, 'race');
    const settleCallsBefore = harness.facilitator!.settleCalls.length;

    const oracle = new FakeSettlementOracle();
    oracle.settled(fakeSettlementTx());

    /*
     * Twenty workers, fired together at one uncertain payment. This is what
     * `FOR UPDATE SKIP LOCKED` is for: they partition the queue rather than
     * fighting over its head, and only one can hold this row.
     */
    const outcomes = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => runReconciliationPass(deps(harness, oracle))),
    );

    // Exactly one worker claimed the job.
    const totalClaimed = outcomes.reduce((sum, outcome) => sum + outcome.claimed, 0);
    expect(totalClaimed).toBe(1);

    /* One Payment. */
    const paymentRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, paymentRequestId));
    expect(paymentRows).toHaveLength(1);

    /* One Receipt. */
    const receiptRows = await db
      .select({ id: paymentReceipts.id })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, paymentRows[0]!.id));
    expect(receiptRows).toHaveLength(1);

    /* One usage event. */
    const usageRows = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.paymentId, paymentRows[0]!.id));
    expect(usageRows).toHaveLength(1);

    /* One reconciliation record, resolved once. */
    const jobRows = await db
      .select({ id: settlementReconciliations.id, status: settlementReconciliations.status })
      .from(settlementReconciliations)
      .where(eq(settlementReconciliations.paymentRequestId, paymentRequestId));
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]!.status).toBe('RESOLVED_CONFIRMED');

    /* And no settlement was attempted by any of them. */
    expect(harness.facilitator!.settleCalls).toHaveLength(settleCallsBefore);
  });

  it('partitions a backlog across concurrent workers without double-claiming', async () => {
    const db = harness.handle.db;

    const created = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(await createUncertainSettlement(harness, `batch${i}`));
    }

    const oracle = new FakeSettlementOracle();
    oracle.settled(fakeSettlementTx());

    const outcomes = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => runReconciliationPass(deps(harness, oracle))),
    );

    // Every job claimed exactly once in total, across all workers.
    const totalClaimed = outcomes.reduce((sum, outcome) => sum + outcome.claimed, 0);
    expect(totalClaimed).toBe(created.length);

    for (const { paymentRequestId } of created) {
      const paymentRows = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.paymentRequestId, paymentRequestId));
      expect(paymentRows).toHaveLength(1);
    }
  });
});
