import { Meter402Error, findAsset } from '@meter402/shared';
import type { AppConfig } from '@meter402/config';
import type { Database } from '@meter402/database';
import { DrizzleAuthorizationGuard, DrizzleReplayGuard } from '@meter402/database';
import {
  PaymentStatus,
  assertTransition,
  type PaymentRequest,
  type VerificationFailure,
} from '@meter402/payments';
import {
  SCHEME_EXACT,
  X402_PROTOCOL,
  X402_VERSION,
  bindAuthorizationToRequest,
  parseExactEvmPayload,
  verifyAuthorizationSignature,
  type FacilitatorClient,
  type X402V2PaymentProtocolAdapter,
  type X402ExactEvmPayload,
  type X402PaymentPayload,
  type X402SettleResponse,
} from '@meter402/x402';
import type { TenantScope } from '../../lib/tenant.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import {
  findPaymentByRequest,
  findReceiptByPayment,
  insertPaymentIfAbsent,
  insertReceiptIfAbsent,
  recordPaymentAttempt,
  updatePaymentRequestStatus,
  type PaymentRecord,
  type ReceiptRecord,
} from './payment.repository.js';
import { FacilitatorSettlementVerifier } from './x402-settlement-verifier.js';
import { countVerificationFailure, paymentMetrics } from '../../lib/metrics.js';

/**
 * The x402 v2 payment flow.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Ordering is not a choice we made. The x402 `exact` scheme on EVM uses the
 * `authorization` payment flow, whose phases the reference implementation
 * defines as:
 *
 *     verifyBeforeHandler: true
 *     settleBeforeHandler: false
 *     settleAfterHandler:  true
 *
 * which is: **verify → merchant handler → settle**. Two consequences follow
 * directly, and neither is a special case we invented:
 *
 *  - A payer is not charged for a request the merchant could not serve. If the
 *    handler fails, settlement simply never runs.
 *  - A merchant is not asked to serve a request that was never going to pay.
 *    Verification happens first.
 *
 * Where this rejoins the rest of Meter402: once settlement produces a
 * transaction hash, `authorizePayment` — the same function the TEST protocol
 * uses — decides the payment. The x402-specific work is everything before
 * that point; the money, the state machine, and the exactly-once guarantees
 * are shared.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface X402PaymentActor {
  readonly actorType: 'user' | 'api_key';
  readonly actorId: string;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
}

/** Outcome of the pre-handler half of the flow. */
export type X402VerifyOutcome =
  | {
      readonly outcome: 'VERIFIED';
      readonly payload: X402PaymentPayload;
      readonly exact: X402ExactEvmPayload;
      readonly payer: string;
      /**
       * Whether *this* caller won the authorization claim.
       *
       * Only the winner may settle. A concurrent caller presenting the same
       * authorization has verified it correctly but does not own the right to
       * submit it, because `settle` is the call that may move money.
       */
      readonly ownsAuthorizationClaim: boolean;
    }
  | { readonly outcome: 'REJECTED'; readonly failure: VerificationFailure }
  /** The facilitator could not be reached. Nothing has been charged. */
  | { readonly outcome: 'UNAVAILABLE'; readonly message: string };

export interface SettleOutcome {
  readonly payment: PaymentRecord;
  readonly receipt: ReceiptRecord;
  readonly settlement: X402SettleResponse;
}

function failure(reason: VerificationFailure['reason'], message: string): VerificationFailure {
  return { reason, message, details: {} } as VerificationFailure;
}

/**
 * Everything that must be true before the merchant handler runs.
 *
 * The ordering inside this function matters as much as the flow ordering
 * around it: local checks first, facilitator last. A forged signature or a
 * tampered amount is rejected without any outbound request, which keeps the
 * cost of an attack on the attacker and stops Meter402 being used to amplify
 * traffic at a facilitator.
 */
export async function verifyX402Payment(
  db: Database,
  scope: TenantScope,
  config: AppConfig,
  facilitator: FacilitatorClient,
  adapter: X402V2PaymentProtocolAdapter,
  request: PaymentRequest,
  payload: X402PaymentPayload,
  actor: X402PaymentActor,
): Promise<X402VerifyOutcome> {
  // 1. The kill switch. Checked before anything else touches a payment.
  if (!config.settlement.liveSettlementEnabled) {
    return {
      outcome: 'REJECTED',
      failure: failure('MALFORMED_PROOF', 'Real settlement is disabled on this server.'),
    };
  }
  if (!config.settlement.enabledChainIds.includes(request.chainId)) {
    return {
      outcome: 'REJECTED',
      failure: failure(
        'WRONG_NETWORK',
        `Settlement on chain ${request.chainId} is not enabled on this server.`,
      ),
    };
  }

  paymentMetrics.increment('authorizations_received', {
    network: `eip155:${request.chainId}`,
  });

  // 2. Scheme payload shape.
  const exact = parseExactEvmPayload(payload.payload);
  if (!exact.ok) {
    paymentMetrics.increment('authorization_parse_failures');
    return { outcome: 'REJECTED', failure: exact.error };
  }

  // 3. Binding: amount, asset, recipient, network, expiry. Zero tolerance.
  const bound = bindAuthorizationToRequest({
    request,
    payload,
    exact: exact.value,
    now: new Date(),
  });
  if (!bound.ok) {
    countVerificationFailure(bound.error.reason);
    return { outcome: 'REJECTED', failure: bound.error };
  }

  // 4. The signature. Local cryptography, no network, no trust in anyone.
  const asset = findAsset(request.assetSymbol, request.chainId);
  /* istanbul ignore next -- the request was priced from this registry. */
  if (!asset) {
    return {
      outcome: 'REJECTED',
      failure: failure('MALFORMED_PROOF', 'Payment request references an unknown asset.'),
    };
  }

  const signer = await verifyAuthorizationSignature({
    exact: exact.value,
    asset,
    chainId: request.chainId,
  });
  if (!signer.ok) {
    paymentMetrics.increment('authorization_signature_failures');
    return { outcome: 'REJECTED', failure: signer.error };
  }

  /*
   * 5. Claim the authorization.
   *
   * Before the facilitator, not after. A signed EIP-3009 authorization is a
   * bearer instrument, and this atomic INSERT is what stops the same one being
   * presented against several payment requests concurrently — each passing
   * verification and each going on to settle.
   */
  const guard = new DrizzleAuthorizationGuard(db, scope.organizationId);
  const claim = await guard.claim({
    paymentRequestId: request.id,
    protocol: X402_PROTOCOL,
    protocolVersion: X402_VERSION,
    scheme: SCHEME_EXACT,
    chainId: request.chainId,
    assetAddress: asset.address,
    payerAddress: signer.value,
    authorizationNonce: exact.value.authorization.nonce,
    validAfter: new Date(Number(exact.value.authorization.validAfter) * 1000),
    validBefore: new Date(Number(exact.value.authorization.validBefore) * 1000),
    facilitator: config.settlement.facilitator.url,
  });

  if (!claim.claimed && claim.existingPaymentRequestId !== request.id) {
    /*
     * The authorization is already bound to a *different* payment request.
     * That is the replay: the EIP-3009 signature does not cover which request
     * it pays, so an observed authorization can be pointed at another one.
     */
    paymentMetrics.increment('authorization_replay_attempts');
    return {
      outcome: 'REJECTED',
      failure: failure(
        'TRANSACTION_ALREADY_USED',
        'This payment authorization has already been used.',
      ),
    };
  }

  // 6. The facilitator. External, untrusted, and consulted last.
  const requirements = adapter.requirementsFor(request);
  const verified = await paymentMetrics.time('facilitator_verify', () =>
    facilitator.verify({ paymentPayload: payload, paymentRequirements: requirements }),
  );

  if (!verified.ok) {
    if (verified.error.kind === 'UNAVAILABLE') {
      /*
       * Infrastructure failure is not payment failure. Nothing has settled,
       * so the caller is told to retry rather than being told they failed to
       * pay — and no Payment row is written either way.
       */
      paymentMetrics.increment('verify_unavailable');
      return { outcome: 'UNAVAILABLE', message: verified.error.message };
    }
    paymentMetrics.increment('verify_rejected');
    return {
      outcome: 'REJECTED',
      failure: failure('MALFORMED_PROOF', verified.error.message),
    };
  }

  if (!verified.value.isValid) {
    paymentMetrics.increment('verify_rejected', {
      reason: verified.value.invalidReason ?? 'unknown',
    });
    await db.transaction(async (tx) => {
      await recordPaymentAttempt(tx, scope, {
        paymentRequestId: request.id,
        transactionHash: null,
        succeeded: false,
        failureReason: verified.value.invalidReason ?? 'invalid_payment',
        requestId: actor.requestId ?? null,
        sourceIp: actor.ipAddress ?? null,
      });
    });
    return {
      outcome: 'REJECTED',
      failure: failure(
        'MALFORMED_PROOF',
        verified.value.invalidMessage ?? 'The facilitator rejected this authorization.',
      ),
    };
  }

  /*
   * The facilitator may report the payer it recovered. If it disagrees with
   * the payer we recovered ourselves, something is wrong with one of us and
   * the safe answer is to refuse rather than pick a winner.
   */
  const facilitatorPayer = verified.value.payer;
  if (facilitatorPayer && facilitatorPayer.toLowerCase() !== signer.value.toLowerCase()) {
    return {
      outcome: 'REJECTED',
      failure: failure(
        'MALFORMED_PROOF',
        'The facilitator recovered a different payer than the signature does.',
      ),
    };
  }

  paymentMetrics.increment('verify_success', { network: `eip155:${request.chainId}` });
  await db.transaction(async (tx) => {
    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'x402_payment.verified',
      resourceType: 'payment_request',
      resourceId: request.id,
      requestId: actor.requestId ?? null,
      metadata: {
        protocol: X402_PROTOCOL,
        x402Version: X402_VERSION,
        scheme: SCHEME_EXACT,
        network: `eip155:${request.chainId}`,
        payer: signer.value,
        // The nonce identifies the authorization; the signature does not
        // appear here or in any log. See docs/SECURITY.md.
        authorizationNonce: exact.value.authorization.nonce,
        amountMinorUnits: request.amountMinorUnits.toString(),
      },
    });
  });

  return {
    outcome: 'VERIFIED',
    payload,
    exact: exact.value,
    payer: signer.value,
    ownsAuthorizationClaim: claim.claimed,
  };
}

/**
 * Settle, then record the payment through the shared pipeline.
 *
 * Runs only after the merchant handler has succeeded.
 */
export async function settleX402Payment(
  db: Database,
  scope: TenantScope,
  config: AppConfig,
  facilitator: FacilitatorClient,
  adapter: X402V2PaymentProtocolAdapter,
  request: PaymentRequest,
  verifiedPayload: X402PaymentPayload,
  payer: string,
  actor: X402PaymentActor,
  ownsAuthorizationClaim: boolean,
): Promise<SettleOutcome> {
  /*
   * Idempotency. If this request already has a payment, settlement already
   * happened — a retry must return the same payment and receipt rather than
   * submitting a second transaction. Checked before calling the facilitator,
   * because `settle` is the one call that may move money.
   */
  const existing = await findPaymentByRequest(db, scope, request.id);
  if (existing) {
    const receipt = await findReceiptByPayment(db, scope, existing.id);
    /* istanbul ignore next -- payment and receipt are written together. */
    if (!receipt) {
      throw new Meter402Error(
        'INTERNAL_ERROR',
        'A payment exists without a receipt, which should be impossible.',
      );
    }
    return {
      payment: existing,
      receipt,
      settlement: {
        success: true,
        transaction: existing.externalTransactionReference ?? '',
        network: `eip155:${request.chainId}`,
        payer,
      },
    };
  }

  /*
   * Only the caller that won the authorization claim may settle.
   *
   * Without this, N concurrent submissions of one authorization would each
   * find no payment (none has committed yet), each call `settle`, and each
   * potentially broadcast a transaction — the exact double-charge this system
   * exists to prevent. The claim is already atomic, so it is also the right
   * thing to gate on: exactly one caller can hold it.
   *
   * A loser is told the settlement is in flight and to retry. It is a 409 with
   * a retryable code rather than an error, because the payment is very
   * probably about to succeed — and retrying will then find it and return it
   * idempotently.
   */
  if (!ownsAuthorizationClaim) {
    throw new Meter402Error(
      'IDEMPOTENCY_REQUEST_IN_FLIGHT',
      'This payment is already being settled. Retry shortly; do not pay again.',
      { details: { paymentRequestId: request.id } },
    );
  }

  const requirements = adapter.requirementsFor(request);
  const settled = await paymentMetrics.time('facilitator_settle', () =>
    facilitator.settle({ paymentPayload: verifiedPayload, paymentRequirements: requirements }),
  );

  if (!settled.ok) {
    if (settled.error.kind === 'UNAVAILABLE') {
      /*
       * The critical uncertainty case. A settle call that timed out may
       * already have broadcast a transaction, so we know nothing about
       * whether money moved.
       *
       * The request is moved to PENDING — not FAILED — and left for
       * reconciliation. Marking it failed would be a lie in the dangerous
       * direction: the payer could be out of pocket while we told them the
       * payment did not happen. And it is emphatically not retried here; a
       * blind retry is how a payer gets charged twice.
       */
      paymentMetrics.increment('settle_uncertain');
      await db.transaction(async (tx) => {
        assertTransition(request.status, PaymentStatus.Pending, request.id);
        await updatePaymentRequestStatus(tx, scope, request.id, PaymentStatus.Pending);
        await recordPaymentAttempt(tx, scope, {
          paymentRequestId: request.id,
          transactionHash: null,
          succeeded: false,
          failureReason: 'settlement_uncertain',
          requestId: actor.requestId ?? null,
          sourceIp: actor.ipAddress ?? null,
        });
        await recordAuditEvent(tx, {
          organizationId: scope.organizationId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'x402_payment.settlement_uncertain',
          resourceType: 'payment_request',
          resourceId: request.id,
          requestId: actor.requestId ?? null,
          metadata: { reason: settled.error.message, payer },
        });
      });

      throw new Meter402Error(
        'PAYMENT_NOT_CONFIRMED',
        'Settlement was submitted but its outcome is not yet known. Do not pay again; this payment will be reconciled.',
        { details: { paymentRequestId: request.id } },
      );
    }

    throw new Meter402Error('PAYMENT_INVALID', settled.error.message);
  }

  const settlement = settled.value;
  if (!settlement.success) {
    paymentMetrics.increment('settle_failed', {
      reason: settlement.errorReason ?? 'unknown',
    });
    await db.transaction(async (tx) => {
      await recordPaymentAttempt(tx, scope, {
        paymentRequestId: request.id,
        transactionHash: null,
        succeeded: false,
        failureReason: settlement.errorReason ?? 'settlement_failed',
        requestId: actor.requestId ?? null,
        sourceIp: actor.ipAddress ?? null,
      });
    });
    throw new Meter402Error('PAYMENT_INVALID', settlement.errorMessage ?? 'Settlement failed.', {
      details: { reason: settlement.errorReason ?? 'unknown' },
    });
  }

  /*
   * Settlement produced a transaction. From here the x402 path and the TEST
   * path are the same code: `authorizePayment` performs the amount and
   * recipient comparisons, claims the transaction hash against
   * UNIQUE (chain_id, transaction_hash), and returns a decision that the
   * state machine validates.
   */
  return db.transaction(async (tx) => {
    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: X402_PROTOCOL,
        transactionHash: settlement.transaction,
        payer,
        nonce: null,
        raw: { settlement: { transaction: settlement.transaction, network: settlement.network } },
      },
      verifier: new FacilitatorSettlementVerifier(settlement, payer),
      replayGuard: new DrizzleReplayGuard(tx, scope.organizationId, false),
      requiredConfirmations: config.chain.confirmationsRequired,
    });

    if (authorization.decision !== 'AUTHORIZED' || !authorization.transfer) {
      await updatePaymentRequestStatus(tx, scope, request.id, authorization.nextStatus);
      throw new Meter402Error(
        'PAYMENT_INVALID',
        authorization.failure?.message ?? 'The settled payment could not be authorized.',
        { details: { reason: authorization.failure?.reason ?? 'UNKNOWN' } },
      );
    }

    // Walk the state machine rather than jumping to CONFIRMED.
    let status = request.status;
    for (const next of [
      PaymentStatus.Submitted,
      PaymentStatus.Confirming,
      PaymentStatus.Confirmed,
    ]) {
      assertTransition(status, next, request.id);
      status = next;
    }

    const inserted = await insertPaymentIfAbsent(tx, scope, {
      request,
      status: PaymentStatus.Confirmed,
      protocol: X402_PROTOCOL,
      payerReference: authorization.transfer.from,
      externalTransactionReference: authorization.transfer.transactionHash,
      // Real settlement. The receipt must never claim otherwise.
      simulated: false,
      blockchainTransactionId: null,
    });

    const payment = inserted ?? (await findPaymentByRequest(tx, scope, request.id));
    /* istanbul ignore next -- the conflict proves a row exists. */
    if (!payment) {
      throw new Meter402Error('INTERNAL_ERROR', 'Payment insert conflicted but no row was found.');
    }

    const insertedReceipt = await insertReceiptIfAbsent(tx, scope, {
      payment,
      request,
      metadata: adapter.createReceiptMetadata({ request, transfer: authorization.transfer }),
    });
    const receipt = insertedReceipt ?? (await findReceiptByPayment(tx, scope, payment.id));
    /* istanbul ignore next -- the conflict proves a row exists. */
    if (!receipt) {
      throw new Meter402Error('INTERNAL_ERROR', 'Receipt insert conflicted but no row was found.');
    }

    await updatePaymentRequestStatus(tx, scope, request.id, PaymentStatus.Confirmed);
    await recordPaymentAttempt(tx, scope, {
      paymentRequestId: request.id,
      transactionHash: authorization.transfer.transactionHash,
      succeeded: true,
      failureReason: null,
      requestId: actor.requestId ?? null,
      sourceIp: actor.ipAddress ?? null,
    });

    if (inserted) {
      paymentMetrics.increment('settle_success', { network: `eip155:${request.chainId}` });
      paymentMetrics.increment('payments_confirmed');
      paymentMetrics.increment('receipts_issued');
      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'x402_payment.settled',
        resourceType: 'payment',
        resourceId: payment.id,
        requestId: actor.requestId ?? null,
        metadata: {
          paymentRequestId: request.id,
          receiptId: receipt.id,
          protocol: X402_PROTOCOL,
          network: `eip155:${request.chainId}`,
          transactionHash: authorization.transfer.transactionHash,
          payer: authorization.transfer.from,
          amountMinorUnits: request.amountMinorUnits.toString(),
          simulated: false,
        },
      });
    }

    return { payment, receipt, settlement };
  });
}
