import { and, asc, count, eq, lte, sql } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { paymentRequests, settlementReconciliations } from '@meter402/database';
import type { Database } from '@meter402/database';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

/**
 * The reconciliation queue.
 *
 * Two things here are load-bearing and worth reading closely: how a job is
 * enqueued exactly once, and how a job is claimed by exactly one worker.
 */

export type ReconciliationStatus =
  'PENDING' | 'IN_PROGRESS' | 'RESOLVED_CONFIRMED' | 'RESOLVED_FAILED' | 'EXHAUSTED';

export interface ReconciliationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly paymentRequestId: string;
  readonly status: ReconciliationStatus;
  readonly facilitator: string | null;
  readonly chainId: number;
  readonly assetAddress: string;
  readonly payerAddress: string;
  readonly authorizationNonce: string;
  readonly recipientAddress: string;
  readonly amountMinorUnits: string;
  readonly validBefore: Date | null;
  readonly transactionHash: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date;
  readonly lastAttemptAt: Date | null;
  readonly lastResult: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

const COLUMNS = {
  id: settlementReconciliations.id,
  organizationId: settlementReconciliations.organizationId,
  paymentRequestId: settlementReconciliations.paymentRequestId,
  status: settlementReconciliations.status,
  facilitator: settlementReconciliations.facilitator,
  chainId: settlementReconciliations.chainId,
  assetAddress: settlementReconciliations.assetAddress,
  payerAddress: settlementReconciliations.payerAddress,
  authorizationNonce: settlementReconciliations.authorizationNonce,
  recipientAddress: settlementReconciliations.recipientAddress,
  amountMinorUnits: settlementReconciliations.amountMinorUnits,
  validBefore: settlementReconciliations.validBefore,
  transactionHash: settlementReconciliations.transactionHash,
  attempts: settlementReconciliations.attempts,
  maxAttempts: settlementReconciliations.maxAttempts,
  nextAttemptAt: settlementReconciliations.nextAttemptAt,
  lastAttemptAt: settlementReconciliations.lastAttemptAt,
  lastResult: settlementReconciliations.lastResult,
  resolvedAt: settlementReconciliations.resolvedAt,
  createdAt: settlementReconciliations.createdAt,
} as const;

export interface EnqueueReconciliationInput {
  readonly paymentRequestId: string;
  readonly facilitator: string | null;
  readonly chainId: number;
  readonly assetAddress: string;
  readonly payerAddress: string;
  readonly authorizationNonce: string;
  readonly recipientAddress: string;
  readonly amountMinorUnits: bigint;
  readonly validBefore: Date | null;
}

/**
 * Schedule a payment for reconciliation.
 *
 * `ON CONFLICT DO NOTHING` against `UNIQUE (payment_request_id)`: enqueuing is
 * idempotent by construction. A retry storm, a duplicated event, or a worker
 * re-processing the same uncertainty all converge on one job — which is what
 * makes "run this 20 times" safe at the top of the pipeline rather than only
 * at the bottom.
 *
 * Called in the same transaction that records the uncertainty, so a payment
 * cannot become uncertain without simultaneously becoming scheduled. The
 * process that lost the response may be about to die; the row must not depend
 * on it surviving.
 */
export async function enqueueReconciliation(
  executor: Executor,
  scope: TenantScope,
  input: EnqueueReconciliationInput,
): Promise<void> {
  await executor
    .insert(settlementReconciliations)
    .values({
      id: newId('reconciliation'),
      organizationId: scope.organizationId,
      paymentRequestId: input.paymentRequestId,
      facilitator: input.facilitator,
      chainId: input.chainId,
      assetAddress: input.assetAddress.toLowerCase(),
      payerAddress: input.payerAddress.toLowerCase(),
      authorizationNonce: input.authorizationNonce.toLowerCase(),
      recipientAddress: input.recipientAddress.toLowerCase(),
      amountMinorUnits: input.amountMinorUnits.toString(),
      validBefore: input.validBefore,
    })
    .onConflictDoNothing({ target: settlementReconciliations.paymentRequestId });
}

/**
 * Claim due jobs for one worker.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole design. The subquery locks the rows it
 * selects and skips any another transaction already holds, so N workers
 * running this simultaneously partition the queue between them rather than
 * fighting over its head. Without SKIP LOCKED they would serialise on the
 * oldest row; without the lock they would all claim it.
 *
 * The status flip to IN_PROGRESS is part of the same statement, so a claimed
 * job is invisible to the next poller the instant it is claimed.
 */
export async function claimReconciliationJobs(
  db: Database,
  limit: number,
  now: Date = new Date(),
): Promise<readonly ReconciliationRecord[]> {
  const rows = await db
    .update(settlementReconciliations)
    .set({ status: 'IN_PROGRESS', lastAttemptAt: now, updatedAt: now })
    .where(
      /*
       * The timestamp is passed as an ISO string with an explicit cast, not as
       * a Date. A value interpolated into a raw `sql` template has no column
       * behind it, so it never reaches the type mapper that would serialise a
       * Date — the driver receives the object itself and fails. Casting the
       * string back to timestamptz keeps the comparison exact.
       *
       * `LIMIT` gets a cast for the related reason that Postgres cannot infer
       * a type for a bare placeholder there.
       */
      sql`${settlementReconciliations.id} IN (
        SELECT ${settlementReconciliations.id}
        FROM ${settlementReconciliations}
        WHERE ${settlementReconciliations.status} = 'PENDING'
          AND ${settlementReconciliations.nextAttemptAt} <= ${now.toISOString()}::timestamptz
        ORDER BY ${settlementReconciliations.nextAttemptAt} ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}::int
      )`,
    )
    .returning(COLUMNS);

  return rows as ReconciliationRecord[];
}

/** Mark a job resolved. Terminal; a resolved job is never claimed again. */
export async function resolveReconciliation(
  executor: Executor,
  id: string,
  status: 'RESOLVED_CONFIRMED' | 'RESOLVED_FAILED' | 'EXHAUSTED',
  result: string,
  transactionHash: string | null = null,
): Promise<void> {
  const now = new Date();
  await executor
    .update(settlementReconciliations)
    .set({
      status,
      lastResult: result,
      resolvedAt: now,
      updatedAt: now,
      attempts: sql`${settlementReconciliations.attempts} + 1`,
      ...(transactionHash ? { transactionHash } : {}),
    })
    .where(eq(settlementReconciliations.id, id));
}

/**
 * Return a job to the queue with backoff.
 *
 * Exponential, capped. The cap matters: an unbounded backoff eventually
 * schedules a retry so far out that the job is effectively abandoned without
 * anyone deciding to abandon it.
 */
export async function rescheduleReconciliation(
  executor: Executor,
  record: ReconciliationRecord,
  result: string,
  now: Date = new Date(),
): Promise<void> {
  const attempts = record.attempts + 1;

  if (attempts >= record.maxAttempts) {
    /*
     * Out of attempts. EXHAUSTED, not FAILED — we still do not know what
     * happened, and saying "failed" would be a guess that could deny a payer
     * a service they paid for. This state exists to be alerted on.
     */
    await resolveReconciliation(
      executor,
      record.id,
      'EXHAUSTED',
      `${result} (gave up after ${attempts} attempts; needs a human)`,
    );
    return;
  }

  // 30s, 60s, 120s … capped at an hour.
  const backoffMs = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);

  await executor
    .update(settlementReconciliations)
    .set({
      status: 'PENDING',
      attempts,
      lastResult: result,
      nextAttemptAt: new Date(now.getTime() + backoffMs),
      updatedAt: now,
    })
    .where(eq(settlementReconciliations.id, record.id));
}

export async function findReconciliationByRequest(
  executor: Executor,
  paymentRequestId: string,
): Promise<ReconciliationRecord | null> {
  const [row] = await executor
    .select(COLUMNS)
    .from(settlementReconciliations)
    .where(eq(settlementReconciliations.paymentRequestId, paymentRequestId))
    .limit(1);
  return (row as ReconciliationRecord | undefined) ?? null;
}

export interface ReconciliationBacklog {
  readonly pending: number;
  readonly inProgress: number;
  readonly exhausted: number;
  /**
   * Payments whose outcome is genuinely unknown right now: queued or being
   * worked, plus the ones we gave up on. The number an operator watches.
   */
  readonly uncertain: number;
  /** Age in seconds of the oldest unresolved job, or null when none. */
  readonly oldestUnresolvedAgeSeconds: number | null;
}

/**
 * Operational summary for `/health/payments`.
 *
 * Counts and an age, nothing identifying. "How many payments are we unsure
 * about, and how long has the worst one been unsure" is the operator's
 * question; who they belong to is not.
 */
export async function reconciliationBacklog(db: Database): Promise<ReconciliationBacklog> {
  const rows = await db
    .select({ status: settlementReconciliations.status, total: count() })
    .from(settlementReconciliations)
    .groupBy(settlementReconciliations.status);

  const byStatus = new Map(rows.map((row) => [row.status, Number(row.total)]));

  const [oldest] = await db
    .select({ createdAt: settlementReconciliations.createdAt })
    .from(settlementReconciliations)
    .where(sql`${settlementReconciliations.status} IN ('PENDING', 'IN_PROGRESS', 'EXHAUSTED')`)
    .orderBy(asc(settlementReconciliations.createdAt))
    .limit(1);

  const pending = byStatus.get('PENDING') ?? 0;
  const inProgress = byStatus.get('IN_PROGRESS') ?? 0;
  const exhausted = byStatus.get('EXHAUSTED') ?? 0;

  return {
    pending,
    inProgress,
    exhausted,
    uncertain: pending + inProgress + exhausted,
    oldestUnresolvedAgeSeconds: oldest
      ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000)
      : null,
  };
}

/**
 * Recover jobs abandoned mid-flight.
 *
 * A worker that crashes between claiming and resolving leaves a row stuck in
 * IN_PROGRESS forever. This returns any that have sat there beyond a
 * generous timeout, so a crash costs a delay rather than a permanently stuck
 * payment.
 */
export async function requeueStalledReconciliations(
  db: Database,
  stalledAfterMs = 300_000,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - stalledAfterMs);
  const rows = await db
    .update(settlementReconciliations)
    .set({ status: 'PENDING', nextAttemptAt: now, updatedAt: now })
    .where(
      and(
        eq(settlementReconciliations.status, 'IN_PROGRESS'),
        lte(settlementReconciliations.lastAttemptAt, cutoff),
      ),
    )
    .returning({ id: settlementReconciliations.id });

  return rows.length;
}

/**
 * Payment requests that have been authorized but have not resolved either way.
 *
 * Deliberately organization-agnostic: this is an operator's number, not a
 * merchant's, and the operator's question is "how much of the system is in
 * flight right now" across all tenants. It carries no identifiers, so it
 * exposes a volume and nothing about whose payments make it up.
 *
 * SUBMITTED and CONFIRMING are the in-flight statuses — an authorization has
 * been accepted and the outcome is still open. PENDING is not among them: a
 * request can sit there simply because nobody paid it, which is not a backlog.
 */
export async function countPendingSettlements(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(paymentRequests)
    .where(sql`${paymentRequests.status} IN ('SUBMITTED', 'CONFIRMING')`);

  return Number(row?.total ?? 0);
}
