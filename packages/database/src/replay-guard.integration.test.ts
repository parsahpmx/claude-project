import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { createDatabase, type DatabaseHandle } from './client.js';
import { DrizzleReplayGuard } from './replay-guard.js';
import { organizations, projects } from './schema/identity.js';
import { paymentRequests } from './schema/payments.js';

/**
 * Replay protection, proven against a real PostgreSQL instance.
 *
 * The unit tests elsewhere verify that the authorization pipeline *calls* the
 * replay guard correctly. They cannot prove the property that actually
 * protects us, which is that the database refuses a second claim under
 * genuine concurrency. That requires a real database and real parallel
 * transactions, so it lives here.
 *
 * Skipped automatically when DATABASE_URL is unset, so `pnpm test` still works
 * without infrastructure. CI sets it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const CHAIN_ID = 84532;

describe.skipIf(!DATABASE_URL)('DrizzleReplayGuard against PostgreSQL', () => {
  let handle: DatabaseHandle;
  let organizationId: string;
  let projectId: string;

  async function createRequest(): Promise<string> {
    const id = newId('paymentRequest');
    await handle.db.insert(paymentRequests).values({
      id,
      organizationId,
      projectId,
      environment: 'TEST',
      amountMinorUnits: '30000',
      assetSymbol: 'USDC',
      assetAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      assetDecimals: 6,
      chainId: CHAIN_ID,
      recipientAddress: '0x1111111111111111111111111111111111111111',
      nonce: newId('paymentRequest'),
      reference: id.slice(-12),
      expiresAt: new Date(Date.now() + 300_000),
    });
    return id;
  }

  function txHash(seed: string): string {
    return `0x${seed.repeat(64).slice(0, 64)}`;
  }

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL!, { maxConnections: 20 });

    organizationId = newId('organization');
    projectId = newId('project');
    await handle.db
      .insert(organizations)
      .values({ id: organizationId, name: 'Replay Test Org', slug: organizationId.toLowerCase() });
    await handle.db
      .insert(projects)
      .values({ id: projectId, organizationId, name: 'Replay Test', slug: 'replay-test' });
  });

  afterAll(async () => {
    if (handle) {
      // Cascades through payment_requests and blockchain_transactions.
      await handle.db.delete(organizations).where(eq(organizations.id, organizationId));
      await handle.close();
    }
  });

  it('claims an unseen transaction', async () => {
    const requestId = await createRequest();
    const guard = new DrizzleReplayGuard(handle.db, organizationId);
    expect(
      await guard.claim({
        chainId: CHAIN_ID,
        transactionHash: txHash('a'),
        paymentRequestId: requestId,
      }),
    ).toEqual({ claimed: true });
  });

  it('refuses a transaction already bound to a different request', async () => {
    const first = await createRequest();
    const second = await createRequest();
    const guard = new DrizzleReplayGuard(handle.db, organizationId);
    const hash = txHash('b');

    expect(
      await guard.claim({ chainId: CHAIN_ID, transactionHash: hash, paymentRequestId: first }),
    ).toEqual({ claimed: true });

    // This is the double-spend attempt: one payment, two requests.
    expect(
      await guard.claim({ chainId: CHAIN_ID, transactionHash: hash, paymentRequestId: second }),
    ).toEqual({ claimed: false, existingPaymentRequestId: first });
  });

  it('reports the same request back for an idempotent retry', async () => {
    const requestId = await createRequest();
    const guard = new DrizzleReplayGuard(handle.db, organizationId);
    const hash = txHash('c');

    await guard.claim({ chainId: CHAIN_ID, transactionHash: hash, paymentRequestId: requestId });
    expect(
      await guard.claim({ chainId: CHAIN_ID, transactionHash: hash, paymentRequestId: requestId }),
    ).toEqual({ claimed: false, existingPaymentRequestId: requestId });
  });

  it('is not defeated by hex casing', async () => {
    // Without normalisation, 0xAB… and 0xab… would occupy two rows and the
    // unique constraint would never fire.
    const first = await createRequest();
    const second = await createRequest();
    const guard = new DrizzleReplayGuard(handle.db, organizationId);
    const hash = txHash('d');

    await guard.claim({ chainId: CHAIN_ID, transactionHash: hash, paymentRequestId: first });
    const result = await guard.claim({
      chainId: CHAIN_ID,
      transactionHash: hash.toUpperCase().replace('0X', '0x'),
      paymentRequestId: second,
    });
    expect(result).toEqual({ claimed: false, existingPaymentRequestId: first });
  });

  it('treats the same hash on a different chain as a different transaction', async () => {
    const requestId = await createRequest();
    const guard = new DrizzleReplayGuard(handle.db, organizationId);
    const hash = txHash('e');

    await guard.claim({ chainId: CHAIN_ID, transactionHash: hash, paymentRequestId: requestId });
    expect(
      await guard.claim({ chainId: 8453, transactionHash: hash, paymentRequestId: requestId }),
    ).toEqual({ claimed: true });
  });

  /**
   * The test this file exists for.
   *
   * Twenty concurrent claims of one transaction hash, each for a different
   * payment request, issued in parallel on separate connections. Exactly one
   * must win. An application-level check-then-insert would let several through
   * here — that race is the entire reason the constraint lives in the database.
   */
  it('admits exactly one winner under concurrent claims of the same transaction', async () => {
    const concurrency = 20;
    const requestIds = await Promise.all(
      Array.from({ length: concurrency }, () => createRequest()),
    );
    const hash = txHash('f');

    const results = await Promise.all(
      requestIds.map((paymentRequestId) =>
        new DrizzleReplayGuard(handle.db, organizationId).claim({
          chainId: CHAIN_ID,
          transactionHash: hash,
          paymentRequestId,
        }),
      ),
    );

    const winners = results.filter((result) => result.claimed);
    expect(winners).toHaveLength(1);

    // Every loser must agree on who won, and it must be a real request.
    const losers = results.filter((result) => !result.claimed);
    expect(losers).toHaveLength(concurrency - 1);
    const reportedOwners = new Set(
      losers.map((result) => (result.claimed ? null : result.existingPaymentRequestId)),
    );
    expect(reportedOwners.size).toBe(1);
    expect(requestIds).toContain([...reportedOwners][0]);
  });
});
