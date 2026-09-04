import { Meter402Error, findAsset, ok } from '@meter402/shared';
import type { AppConfig } from '@meter402/config';
import type { Database } from '@meter402/database';
import { DrizzleReplayGuard } from '@meter402/database';
import { determineSettlement, type SettlementOracle } from '@meter402/blockchain';
import {
  PaymentStatus,
  assertTransition,
  authorizePayment,
  type SettlementVerifier,
  type TransferVerificationRequest,
  type VerifiedTransfer,
} from '@meter402/payments';
import { X402_PROTOCOL, X402V2PaymentProtocolAdapter } from '@meter402/x402';
import type { Result } from '@meter402/shared';
import type { TenantScope } from '../../lib/tenant.js';
import { paymentMetrics } from '../../lib/metrics.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import {
  claimReconciliationJobs,
  requeueStalledReconciliations,
  rescheduleReconciliation,
  resolveReconciliation,
  type ReconciliationRecord,
} from './reconciliation.repository.js';
import {
  findPaymentByRequest,
  findPaymentRequestInOrganization,
  findReceiptByPayment,
  insertPaymentIfAbsent,
  insertReceiptIfAbsent,
  recordPaymentAttempt,
  recordUsageEventIfAbsent,
  updatePaymentRequestStatus,
} from './payment.repository.js';

/**
 * The reconciliation worker.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Its job is to answer a question, not to perform an action. When a `/settle`
 * response is lost we do not know whether money moved; this worker finds out
 * from the chain and then records what already happened.
 *
 * It never calls `/settle`. That is the single most important property here:
 * re-settling is how a payer gets charged twice, and a reconciler that could
 * do it would be a machine for producing exactly the failure it exists to
 * repair.
 *
 * Idempotency comes from reusing the same constraints the live path uses —
 * `UNIQUE (payment_request_id)` on payments, `UNIQUE (payment_id)` on
 * receipts, the usage-event key, and the transaction-hash replay claim. So
 * running one job twenty times converges rather than accumulating.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Presents an already-observed on-chain settlement to `authorizePayment`.
 *
 * The transfer is not asserted by us: `authorizationState` on the token
 * contract said the authorization was consumed, which is the chain's own
 * record that the transfer occurred. This adapter carries that fact into the
 * shared pipeline so a reconciled payment goes through the identical amount,
 * recipient, expiry, replay and state-machine checks as a live one.
 */
class ReconciledSettlementVerifier implements SettlementVerifier {
  constructor(
    private readonly transactionHash: string,
    private readonly payer: string,
  ) {}

  async verifyTransfer(
    request: TransferVerificationRequest,
  ): Promise<Result<VerifiedTransfer, never>> {
    return ok({
      transactionHash: this.transactionHash.toLowerCase(),
      chainId: request.chainId,
      tokenAddress: request.tokenAddress,
      from: this.payer.toLowerCase(),
      to: request.expectedRecipient.toLowerCase(),
      minorUnits: request.expectedMinorUnits,
      blockNumber: 0n,
      blockHash: `0x${'0'.repeat(64)}`,
      confirmations: request.requiredConfirmations,
      logIndex: 0,
      observedAt: new Date(),
    });
  }
}

export interface ReconciliationOutcome {
  readonly claimed: number;
  readonly confirmed: number;
  readonly failed: number;
  readonly retried: number;
  readonly exhausted: number;
}

export interface ReconciliationDeps {
  readonly db: Database;
  readonly config: AppConfig;
  /** Keyed by chain id. A chain with no oracle cannot be reconciled. */
  readonly oracles: ReadonlyMap<number, SettlementOracle>;
  readonly resourceBaseUrl?: string;
}

/**
 * Run one pass of the queue.
 *
 * Returns counts rather than throwing on individual failures: one job that
 * cannot be resolved must not stop the others, because the whole point is to
 * drain a backlog.
 */
export async function runReconciliationPass(
  deps: ReconciliationDeps,
  options: { limit?: number; now?: Date } = {},
): Promise<ReconciliationOutcome> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;

  // Recover anything a crashed worker left claimed.
  await requeueStalledReconciliations(deps.db, 300_000, now);

  const jobs = await claimReconciliationJobs(deps.db, limit, now);
  const outcome = { claimed: jobs.length, confirmed: 0, failed: 0, retried: 0, exhausted: 0 };

  for (const job of jobs) {
    paymentMetrics.increment('reconciliation_started');
    try {
      const result = await reconcileOne(deps, job, now);
      if (result === 'CONFIRMED') outcome.confirmed += 1;
      else if (result === 'FAILED') outcome.failed += 1;
      else if (result === 'EXHAUSTED') outcome.exhausted += 1;
      else outcome.retried += 1;
    } catch (error) {
      /*
       * An unexpected error is not evidence about the payment. Reschedule and
       * try again rather than resolving it in either direction.
       */
      const message = error instanceof Error ? error.message : 'reconciliation error';
      await rescheduleReconciliation(deps.db, job, `error: ${message}`, now);
      paymentMetrics.increment('reconciliation_retry', { reason: 'error' });
      outcome.retried += 1;
    }
  }

  return outcome;
}

type JobResult = 'CONFIRMED' | 'FAILED' | 'RETRY' | 'EXHAUSTED';

async function reconcileOne(
  deps: ReconciliationDeps,
  job: ReconciliationRecord,
  now: Date,
): Promise<JobResult> {
  const scope = { organizationId: job.organizationId } as TenantScope;

  /*
   * Already settled by the live path? Then the response was not lost after
   * all, or another worker got here first. Resolve and stop — this is the
   * cheap idempotency check, before any network call.
   */
  const existingPayment = await findPaymentByRequest(deps.db, scope, job.paymentRequestId);
  if (existingPayment) {
    await resolveReconciliation(
      deps.db,
      job.id,
      'RESOLVED_CONFIRMED',
      'Payment already recorded; nothing to reconcile.',
      existingPayment.externalTransactionReference,
    );
    return 'CONFIRMED';
  }

  const oracle = deps.oracles.get(job.chainId);
  if (!oracle) {
    /*
     * No oracle for this chain. A configuration problem, not a payment
     * problem — retried so that fixing the configuration resolves the backlog
     * without anyone having to touch the rows.
     */
    await rescheduleReconciliation(
      deps.db,
      job,
      `No settlement oracle configured for chain ${job.chainId}.`,
      now,
    );
    paymentMetrics.increment('reconciliation_retry', { reason: 'no_oracle' });
    return 'RETRY';
  }

  const determination = await determineSettlement(oracle, {
    query: {
      chainId: job.chainId,
      assetAddress: job.assetAddress,
      payerAddress: job.payerAddress,
      authorizationNonce: job.authorizationNonce,
    },
    recipientAddress: job.recipientAddress,
    amountMinorUnits: BigInt(job.amountMinorUnits),
    validBefore: job.validBefore,
    now,
  });

  if (!determination.ok) {
    // Could not reach the chain. Not evidence. Back off and try again.
    paymentMetrics.increment('rpc_error');
    paymentMetrics.increment('reconciliation_retry', { reason: 'oracle_unavailable' });
    const before = job.attempts;
    await rescheduleReconciliation(deps.db, job, determination.error.message, now);
    return before + 1 >= job.maxAttempts ? 'EXHAUSTED' : 'RETRY';
  }

  switch (determination.value.outcome) {
    case 'SETTLED':
      return confirmReconciledPayment(deps, job, determination.value.transactionHash, now);

    case 'NEVER_SETTLED':
      return failReconciledPayment(deps, job);

    case 'UNDETERMINED': {
      paymentMetrics.increment('reconciliation_retry', { reason: 'undetermined' });
      const before = job.attempts;
      await rescheduleReconciliation(deps.db, job, determination.value.reason, now);
      if (before + 1 >= job.maxAttempts) {
        paymentMetrics.increment('reconciliation_stuck');
        return 'EXHAUSTED';
      }
      return 'RETRY';
    }
  }
}

/**
 * The settlement happened. Record it through the normal pipeline.
 *
 * Every guarantee the live path provides is provided here by reusing the same
 * code: the transaction-replay claim, the state machine, the unique
 * constraints on Payment and Receipt, and the usage-event key.
 */
async function confirmReconciledPayment(
  deps: ReconciliationDeps,
  job: ReconciliationRecord,
  transactionHash: string | null,
  now: Date,
): Promise<JobResult> {
  const scope = { organizationId: job.organizationId } as TenantScope;

  const request = await findPaymentRequestInOrganization(deps.db, scope, job.paymentRequestId);
  if (!request) {
    /* istanbul ignore next -- the job references it with ON DELETE RESTRICT. */
    await resolveReconciliation(deps.db, job.id, 'EXHAUSTED', 'Payment request disappeared.');
    return 'EXHAUSTED';
  }

  /*
   * Without a transaction hash there is nothing for the replay guard to claim
   * and nothing to put on the receipt. The money moved — `authorizationState`
   * said so — but we cannot yet name the transaction. Retry rather than record
   * a payment with no provenance; a later pass will usually find it.
   */
  if (!transactionHash) {
    paymentMetrics.increment('reconciliation_retry', { reason: 'settled_without_hash' });
    const before = job.attempts;
    await rescheduleReconciliation(
      deps.db,
      job,
      'Authorization was consumed but the transaction could not be located yet.',
      now,
    );
    return before + 1 >= job.maxAttempts ? 'EXHAUSTED' : 'RETRY';
  }

  const adapter = new X402V2PaymentProtocolAdapter(
    deps.resourceBaseUrl ?? 'https://api.meter402.local',
  );

  const recorded = await deps.db.transaction(async (tx) => {
    // Re-check inside the transaction: another worker may have won the race
    // between our earlier read and this write.
    const already = await findPaymentByRequest(tx, scope, request.id);
    if (already) {
      const receipt = await findReceiptByPayment(tx, scope, already.id);
      return { payment: already, receipt, created: false, rejection: null };
    }

    /*
     * Move the request to SUBMITTED before authorizing, and authorize against
     * that.
     *
     * This is not bookkeeping — it is what makes reconciliation possible at
     * all. `authorizePayment` enforces the challenge deadline in CREATED,
     * CHALLENGE_ISSUED and PENDING, and deliberately stops enforcing it from
     * SUBMITTED onward, because (in Phase 0's words) "expiry is a deadline for
     * paying, not for confirming". A reconciliation necessarily runs *after*
     * the settle call went uncertain, so it will routinely arrive past a
     * five-minute TTL. Authorizing while still PENDING would therefore reject
     * a payment the chain has already told us succeeded — taking the payer's
     * money without serving their request, which is the exact failure the
     * expiry rule exists to prevent.
     *
     * SUBMITTED is the honest status here: `authorizationState` says the
     * token contract consumed the authorization, so the transfer was
     * submitted. The transition is legal from PENDING and goes through the
     * state machine like every other.
     */
    assertTransition(request.status, PaymentStatus.Submitted, request.id);
    await updatePaymentRequestStatus(tx, scope, request.id, PaymentStatus.Submitted);
    const submitted = { ...request, status: PaymentStatus.Submitted };

    const authorization = await authorizePayment({
      request: submitted,
      proof: {
        protocol: X402_PROTOCOL,
        transactionHash,
        payer: job.payerAddress,
        nonce: null,
        raw: { reconciled: true },
      },
      verifier: new ReconciledSettlementVerifier(transactionHash, job.payerAddress),
      replayGuard: new DrizzleReplayGuard(tx, scope.organizationId, false),
      requiredConfirmations: deps.config.chain.confirmationsRequired,
    });

    if (authorization.decision !== 'AUTHORIZED' || !authorization.transfer) {
      /*
       * Carry the reason out. A row that only says "not accepted" tells an
       * operator nothing about whether to wait, re-run, or intervene, and
       * these are exactly the payments where someone will be reading the row
       * to decide what to do about real money.
       */
      return {
        payment: null,
        receipt: null,
        created: false,
        rejection: authorization.failure?.reason ?? authorization.decision,
      };
    }

    // Continue through the machine from SUBMITTED rather than jumping.
    let status = PaymentStatus.Submitted;
    for (const next of [PaymentStatus.Confirming, PaymentStatus.Confirmed]) {
      assertTransition(status, next, request.id);
      status = next;
    }

    const inserted = await insertPaymentIfAbsent(tx, scope, {
      request,
      status: PaymentStatus.Confirmed,
      protocol: X402_PROTOCOL,
      payerReference: authorization.transfer.from,
      externalTransactionReference: authorization.transfer.transactionHash,
      simulated: false,
      blockchainTransactionId: null,
    });

    const payment = inserted ?? (await findPaymentByRequest(tx, scope, request.id));
    /* istanbul ignore next */
    if (!payment)
      return { payment: null, receipt: null, created: false, rejection: 'PAYMENT_LOST' };

    const insertedReceipt = await insertReceiptIfAbsent(tx, scope, {
      payment,
      request,
      metadata: {
        ...adapter.createReceiptMetadata({ request, transfer: authorization.transfer }),
        // Recorded so a receipt is honest about how it came to exist.
        reconciled: true,
      },
    });
    const receipt = insertedReceipt ?? (await findReceiptByPayment(tx, scope, payment.id));

    await updatePaymentRequestStatus(tx, scope, request.id, PaymentStatus.Confirmed);

    /*
     * The resource was already served — the merchant handler ran before the
     * settle call that went uncertain — so the usage event belongs to this
     * payment. Keyed on the payment, so a second pass cannot double-bill.
     */
    if (request.endpointId) {
      await recordUsageEventIfAbsent(tx, scope, {
        projectId: request.projectId,
        endpointId: request.endpointId,
        paymentId: payment.id,
        requestId: null,
      });
    }

    await recordPaymentAttempt(tx, scope, {
      paymentRequestId: request.id,
      transactionHash: authorization.transfer.transactionHash,
      succeeded: true,
      failureReason: null,
      requestId: null,
      sourceIp: null,
    });

    if (inserted) {
      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorType: 'system',
        actorId: null,
        action: 'x402_payment.settled',
        resourceType: 'payment',
        resourceId: payment.id,
        metadata: {
          paymentRequestId: request.id,
          reconciled: true,
          transactionHash: authorization.transfer.transactionHash,
          payer: job.payerAddress,
          amountMinorUnits: request.amountMinorUnits.toString(),
        },
      });
    }

    return { payment, receipt, created: inserted !== null, rejection: null };
  });

  if (!recorded.payment) {
    paymentMetrics.increment('reconciliation_retry', { reason: 'authorization_rejected' });
    const before = job.attempts;
    await rescheduleReconciliation(
      deps.db,
      job,
      `On-chain settlement found but authorization was not accepted (${recorded.rejection}).`,
      now,
    );
    return before + 1 >= job.maxAttempts ? 'EXHAUSTED' : 'RETRY';
  }

  await resolveReconciliation(
    deps.db,
    job.id,
    'RESOLVED_CONFIRMED',
    'On-chain settlement confirmed.',
    transactionHash,
  );
  paymentMetrics.increment('reconciliation_confirmed');
  if (recorded.created) {
    paymentMetrics.increment('payments_confirmed');
    paymentMetrics.increment('receipts_issued');
  }
  return 'CONFIRMED';
}

/**
 * The settlement definitively never happened.
 *
 * Only reachable when the authorization is unused *and* past its deadline, so
 * it can never be used again. That is evidence, not an assumption — which is
 * the bar this transition has to clear before a payer is told their payment
 * failed.
 */
async function failReconciledPayment(
  deps: ReconciliationDeps,
  job: ReconciliationRecord,
): Promise<JobResult> {
  const scope = { organizationId: job.organizationId } as TenantScope;

  await deps.db.transaction(async (tx) => {
    const request = await findPaymentRequestInOrganization(tx, scope, job.paymentRequestId);
    if (!request) return;

    /*
     * Through the state machine. An expired-unused authorization means the
     * payment window closed without payment, which the domain already models
     * as EXPIRED — a legal transition from PENDING, unlike an invented one.
     */
    const target = PaymentStatus.Expired;
    try {
      assertTransition(request.status, target, request.id);
      await updatePaymentRequestStatus(tx, scope, request.id, target);
    } catch {
      /*
       * The request has moved on since the job was queued. Leave it alone:
       * reconciliation reports what happened, it does not force a status.
       */
    }

    await recordPaymentAttempt(tx, scope, {
      paymentRequestId: request.id,
      transactionHash: null,
      succeeded: false,
      failureReason: 'authorization_expired_unused',
      requestId: null,
      sourceIp: null,
    });
  });

  await resolveReconciliation(
    deps.db,
    job.id,
    'RESOLVED_FAILED',
    'Authorization expired without being used; no settlement occurred.',
  );
  paymentMetrics.increment('reconciliation_definitive_failure');
  return 'FAILED';
}

/**
 * A polling loop for a long-running process.
 *
 * Deliberately not started automatically by the API. Reconciliation is
 * operational work with its own failure modes and its own scaling
 * characteristics, and burying it inside a request-serving process is how it
 * ends up competing with payments for the connection pool.
 */
export interface ReconciliationWorkerOptions {
  /**
   * Whether the timer should hold the process open.
   *
   * `true` in a dedicated worker process, which exists to do exactly this and
   * should not exit the moment its event loop is otherwise idle. `false` when
   * embedded in something else — a test, or a process with its own reason to
   * be alive — where an unreffed timer keeps it from ever exiting.
   */
  readonly keepProcessAlive?: boolean;
}

export class ReconciliationWorker {
  private timer: NodeJS.Timeout | null = null;
  /** The pass currently running, so shutdown can wait for it. */
  private inFlight: Promise<unknown> | null = null;

  constructor(
    private readonly deps: ReconciliationDeps,
    private readonly intervalMs = 30_000,
    private readonly options: ReconciliationWorkerOptions = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    if (this.options.keepProcessAlive !== true) {
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Wait for any pass already running to finish.
   *
   * Called after `stop()` during shutdown. A pass is a sequence of
   * transactions, each safe to be interrupted between — the constraints do the
   * work, not the process — so this is not about correctness. It is about not
   * abandoning a job in IN_PROGRESS for the whole stall timeout when a second
   * or two would have let it resolve.
   */
  async drain(): Promise<void> {
    await this.inFlight;
  }

  /** One pass. Skips if the previous pass is still running — no pile-up. */
  async tick(): Promise<ReconciliationOutcome | null> {
    if (this.inFlight) return null;

    const pass = runReconciliationPass(this.deps).catch(() => {
      /* istanbul ignore next -- runReconciliationPass handles its own errors. */
      return null;
    });
    this.inFlight = pass;

    try {
      return await pass;
    } finally {
      this.inFlight = null;
    }
  }
}

/** Raised when reconciliation is asked for on a chain it cannot serve. */
export function assertReconcilable(config: AppConfig, chainId: number): void {
  if (!config.settlement.enabledChainIds.includes(chainId)) {
    throw new Meter402Error(
      'LIVE_SETTLEMENT_UNAVAILABLE',
      `Chain ${chainId} is not enabled for settlement on this server.`,
    );
  }
  if (!findAsset('USDC', chainId)) {
    /* istanbul ignore next -- enabled chains always carry a registered asset. */
    throw new Meter402Error('INTERNAL_ERROR', `No registered asset for chain ${chainId}.`);
  }
}
