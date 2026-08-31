import { MerchantEnvironment, Meter402Error } from '@meter402/shared';
import type { AppConfig } from '@meter402/config';
import type { Database } from '@meter402/database';
import { DrizzleReplayGuard } from '@meter402/database';
import {
  PaymentStatus,
  TEST_PROTOCOL,
  TestPaymentProtocolAdapter,
  SimulatedSettlementVerifier,
  assertSimulatableRequest,
  assertTransition,
  deriveSimulatedReference,
  type PaymentRequest,
} from '@meter402/payments';
import type { TenantScope } from '../../lib/tenant.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import {
  findPaymentByRequest,
  findPaymentRequestForUpdate,
  findReceiptByPayment,
  insertPaymentIfAbsent,
  insertReceiptIfAbsent,
  updatePaymentRequestStatus,
  type PaymentRecord,
  type ReceiptRecord,
} from './payment.repository.js';

/**
 * Completing a TEST payment.
 *
 * This is the write path that turns a PaymentRequest into a Payment and a
 * Receipt, and the guarantee it exists to provide is **exactly one of each**:
 * one logical payment per request and one receipt per payment, no matter how
 * many callers race or how many times a caller retries.
 *
 * That guarantee is not implemented by checking first and inserting after —
 * that pattern has a window between the two, and the window is the bug. It is
 * implemented by two database constraints:
 *
 *   UNIQUE (payments.payment_request_id)
 *   UNIQUE (payment_receipts.payment_id)
 *
 * The inserts are `ON CONFLICT DO NOTHING`. A conflict is not an error here;
 * it is the answer "someone else already did this", and the loser reads the
 * winner's row and returns it. Both callers see the same successful result and
 * the merchant is paid once.
 *
 * The row lock taken by `findPaymentRequestForUpdate` is a serialisation
 * convenience layered on top, not the correctness mechanism. If it were
 * removed the constraints would still hold; what would degrade is the error
 * experience, not the money.
 */

const adapter = new TestPaymentProtocolAdapter();

/**
 * The payer recorded for a simulated payment: the zero address.
 *
 * A valid address, so it flows through the same normalisation and comparison
 * code a real payer would, but the one address every EVM reader already
 * understands to mean "nobody". Anyone auditing a TEST receipt, or a script
 * reconciling them, sees at a glance that no counterparty existed.
 */
const SIMULATED_PAYER = `0x${'0'.repeat(40)}`;

export interface TestPaymentActor {
  readonly actorType: 'user' | 'api_key';
  readonly actorId: string;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface TestPaymentResult {
  readonly request: PaymentRequest;
  readonly payment: PaymentRecord;
  readonly receipt: ReceiptRecord;
  readonly reference: string;
  /** False when this call found the payment already complete. */
  readonly created: boolean;
}

/**
 * Complete a TEST payment for a payment request.
 *
 * Takes no environment, mode, or override argument. There is deliberately no
 * parameter a caller could supply to reach a LIVE request through this
 * function: the environment is read from the stored request and checked by
 * `assertSimulatableRequest`, which is the single place that decision is made.
 */
export async function completeTestPayment(
  db: Database,
  scope: TenantScope,
  config: AppConfig,
  actor: TestPaymentActor,
  paymentRequestId: string,
): Promise<TestPaymentResult> {
  return db.transaction(async (tx) => {
    const request = await findPaymentRequestForUpdate(tx, scope, paymentRequestId);
    if (!request) {
      // 404 rather than 403: a request belonging to another organization is
      // indistinguishable from one that does not exist.
      throw new Meter402Error('PAYMENT_REQUEST_NOT_FOUND');
    }

    /*
     * Guard one of four. The simulator refuses LIVE, always, before anything
     * else happens. `assertSimulatableRequest` lives in @meter402/payments
     * beside the adapter so there is exactly one implementation of this rule.
     */
    assertSimulatableRequest(request);

    /*
     * Already paid? Return what exists.
     *
     * Checked under the row lock, so a concurrent completion has either not
     * started or has already committed. The conflict paths below cover the
     * case this check cannot: two transactions that both passed it.
     */
    /*
     * Derived before the idempotency check, not after, so a call that finds
     * the payment already complete still returns the reference. It is a pure
     * function of the request, so recomputing it is free and cannot disagree
     * with what was stored.
     */
    const reference = deriveSimulatedReference(
      config.secrets.testSimulatorSecret,
      request.id,
      request.nonce,
    );

    const existingPayment = await findPaymentByRequest(tx, scope, request.id);
    if (existingPayment) {
      const existingReceipt = await findReceiptByPayment(tx, scope, existingPayment.id);
      /* istanbul ignore next -- payment and receipt are written together. */
      if (!existingReceipt) {
        throw new Meter402Error(
          'INTERNAL_ERROR',
          'A payment exists without a receipt, which should be impossible.',
        );
      }
      return {
        request,
        payment: existingPayment,
        receipt: existingReceipt,
        reference,
        created: false,
      };
    }

    /*
     * From here the TEST path is the real path. The proof is parsed by the
     * real adapter, verified by the real authorization pipeline, and claimed
     * against the real UNIQUE (chain_id, transaction_hash) index. The only
     * simulated component is the settlement evidence itself.
     */
    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: TEST_PROTOCOL,
        transactionHash: reference,
        payer: SIMULATED_PAYER,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference },
      },
      verifier: new SimulatedSettlementVerifier(reference, SIMULATED_PAYER),
      replayGuard: new DrizzleReplayGuard(tx, scope.organizationId, true),
      requiredConfirmations: config.chain.confirmationsRequired,
    });

    if (authorization.decision !== 'AUTHORIZED' || !authorization.transfer) {
      /*
       * Record the rejection on the request before surfacing it, so a failed
       * simulation leaves the same trail a failed real payment would.
       */
      await updatePaymentRequestStatus(tx, scope, request.id, authorization.nextStatus);
      throw new Meter402Error(
        authorization.nextStatus === PaymentStatus.Expired ? 'PAYMENT_EXPIRED' : 'PAYMENT_INVALID',
        authorization.failure?.message ?? 'The simulated payment could not be authorized.',
        { details: { reason: authorization.failure?.reason ?? 'UNKNOWN' } },
      );
    }

    /*
     * Walk the state machine rather than jumping to CONFIRMED. Each hop is
     * checked against the frozen transition table, so this path cannot invent
     * a sequence the domain forbids.
     */
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
      protocol: TEST_PROTOCOL,
      payerReference: authorization.transfer.from,
      externalTransactionReference: authorization.transfer.transactionHash,
      simulated: true,
      blockchainTransactionId: null,
    });

    // Null means UNIQUE (payment_request_id) rejected the insert: a concurrent
    // completion won. Read its row rather than failing the caller.
    const payment = inserted ?? (await findPaymentByRequest(tx, scope, request.id));
    /* istanbul ignore next -- the conflict proves a row exists. */
    if (!payment) {
      throw new Meter402Error('INTERNAL_ERROR', 'Payment insert conflicted but no row was found.');
    }

    const receiptMetadata = adapter.createReceiptMetadata({
      request,
      transfer: authorization.transfer,
    });

    const insertedReceipt = await insertReceiptIfAbsent(tx, scope, {
      payment,
      request,
      metadata: receiptMetadata,
    });
    const receipt = insertedReceipt ?? (await findReceiptByPayment(tx, scope, payment.id));
    /* istanbul ignore next -- the conflict proves a row exists. */
    if (!receipt) {
      throw new Meter402Error('INTERNAL_ERROR', 'Receipt insert conflicted but no row was found.');
    }

    await updatePaymentRequestStatus(tx, scope, request.id, PaymentStatus.Confirmed);

    /*
     * Audit only when this call is the one that created the payment. A losing
     * concurrent caller returning the winner's row did not confirm anything,
     * and recording that it did would make the audit log overcount payments.
     */
    if (inserted) {
      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'test_payment.completed',
        resourceType: 'payment',
        resourceId: payment.id,
        requestId: actor.requestId ?? null,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        metadata: {
          paymentRequestId: request.id,
          receiptId: receipt.id,
          environment: MerchantEnvironment.Test,
          // A string: a JSON number is a double, and money is not a double.
          amountMinorUnits: request.amountMinorUnits.toString(),
          asset: request.assetSymbol,
          simulated: true,
          /*
           * The settlement reference is recorded, deliberately. It is not a
           * secret once the payment is complete — it is the identifier a
           * merchant reconciles against, the TEST analogue of a transaction
           * hash. The *derivation key* is the secret, and it is never logged.
           */
          reference: authorization.transfer.transactionHash,
        },
      });
    }

    return {
      request: { ...request, status: PaymentStatus.Confirmed },
      payment,
      receipt,
      reference,
      created: inserted !== null,
    };
  });
}
