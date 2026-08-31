import { and, eq } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import type { ReplayClaimResult, ReplayGuard } from '@meter402/payments';
import type { Database } from './client.js';
import { blockchainTransactions } from './schema/payments.js';

/**
 * Replay protection backed by the database constraint.
 *
 * This is the concrete implementation of `ReplayGuard`, and it is the reason
 * the `UNIQUE (chain_id, transaction_hash)` index exists.
 *
 * The claim is a single `INSERT ... ON CONFLICT DO NOTHING`. That statement is
 * atomic: either this transaction inserted the row and owns the transaction
 * hash, or someone else already did. There is no window between checking and
 * claiming, which is exactly the window a concurrent double-spend attempt
 * would target. A `SELECT` followed by an `INSERT` would reintroduce it, so
 * the read below happens only *after* the insert has already lost the race,
 * purely to report who won.
 */
export class DrizzleReplayGuard implements ReplayGuard {
  constructor(
    private readonly db: Database,
    private readonly organizationId: string,
  ) {}

  async claim(input: {
    chainId: number;
    transactionHash: string;
    paymentRequestId: string;
  }): Promise<ReplayClaimResult> {
    // Normalised so that the same transaction submitted with different hex
    // casing cannot occupy two rows and defeat the constraint.
    const transactionHash = input.transactionHash.toLowerCase();

    const inserted = await this.db
      .insert(blockchainTransactions)
      .values({
        id: newId('blockchainTransaction'),
        organizationId: this.organizationId,
        paymentRequestId: input.paymentRequestId,
        chainId: input.chainId,
        transactionHash,
      })
      .onConflictDoNothing({
        target: [blockchainTransactions.chainId, blockchainTransactions.transactionHash],
      })
      .returning({ id: blockchainTransactions.id });

    if (inserted.length > 0) {
      return { claimed: true };
    }

    const existing = await this.db
      .select({ paymentRequestId: blockchainTransactions.paymentRequestId })
      .from(blockchainTransactions)
      .where(
        and(
          eq(blockchainTransactions.chainId, input.chainId),
          eq(blockchainTransactions.transactionHash, transactionHash),
        ),
      )
      .limit(1);

    const owner = existing[0]?.paymentRequestId;
    if (owner === undefined) {
      /*
       * The insert conflicted but the row is gone. This should be
       * unreachable — blockchain_transactions rows are never deleted while a
       * payment request references them (ON DELETE RESTRICT). Fail closed:
       * reporting an unknown owner makes the caller reject the payment, which
       * is the safe direction. Confirming it would mean settling a payment we
       * cannot account for.
       */
      return { claimed: false, existingPaymentRequestId: '<unknown>' };
    }

    return { claimed: false, existingPaymentRequestId: owner };
  }
}
