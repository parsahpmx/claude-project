import { and, desc, eq } from 'drizzle-orm';
import { newId, parseMerchantEnvironment, type MerchantEnvironment } from '@meter402/shared';
import {
  paymentAttempts,
  payments,
  paymentReceipts,
  paymentRequests,
  usageEvents,
} from '@meter402/database';
import { parsePaymentStatus } from '@meter402/payments';
import type { PaymentRequest, PaymentStatus } from '@meter402/payments';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

/**
 * Payment requests, payments, and receipts.
 *
 * Two properties this module is responsible for preserving:
 *
 *  1. **Money never becomes a float.** Drizzle returns `numeric` as a string;
 *     it is converted straight to `bigint` here and never passes through
 *     `Number`.
 *  2. **The snapshot is read as values.** A PaymentRequest row carries its own
 *     amount, asset, decimals, chain, and recipient. Nothing in this module
 *     joins `pricing_rules` to reconstruct a price, which is what makes a
 *     merchant's repricing unable to alter an issued request.
 */

function toPaymentRequest(row: {
  id: string;
  organizationId: string;
  projectId: string;
  endpointId: string | null;
  agentId: string | null;
  customerId: string | null;
  environment: string;
  amountMinorUnits: string;
  assetSymbol: string;
  assetAddress: string;
  assetDecimals: number;
  chainId: number;
  recipientAddress: string;
  nonce: string;
  reference: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  metadata: unknown;
}): PaymentRequest {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    endpointId: row.endpointId,
    agentId: row.agentId,
    customerId: row.customerId,
    environment: parseMerchantEnvironment(row.environment),
    // String -> bigint directly. Never via Number.
    amountMinorUnits: BigInt(row.amountMinorUnits),
    assetSymbol: row.assetSymbol,
    assetAddress: row.assetAddress,
    assetDecimals: row.assetDecimals,
    chainId: row.chainId,
    recipientAddress: row.recipientAddress,
    nonce: row.nonce,
    reference: row.reference,
    status: parsePaymentStatus(row.status),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    metadata: (row.metadata ?? {}) as Readonly<Record<string, unknown>>,
  };
}

const PAYMENT_REQUEST_COLUMNS = {
  id: paymentRequests.id,
  organizationId: paymentRequests.organizationId,
  projectId: paymentRequests.projectId,
  endpointId: paymentRequests.endpointId,
  agentId: paymentRequests.agentId,
  customerId: paymentRequests.customerId,
  environment: paymentRequests.environment,
  amountMinorUnits: paymentRequests.amountMinorUnits,
  assetSymbol: paymentRequests.assetSymbol,
  assetAddress: paymentRequests.assetAddress,
  assetDecimals: paymentRequests.assetDecimals,
  chainId: paymentRequests.chainId,
  recipientAddress: paymentRequests.recipientAddress,
  nonce: paymentRequests.nonce,
  reference: paymentRequests.reference,
  status: paymentRequests.status,
  createdAt: paymentRequests.createdAt,
  expiresAt: paymentRequests.expiresAt,
  metadata: paymentRequests.metadata,
} as const;

export interface InsertPaymentRequestInput {
  readonly request: PaymentRequest;
  readonly protocol: string;
  readonly pricingRuleId: string | null;
}

export async function insertPaymentRequest(
  executor: Executor,
  scope: TenantScope,
  input: InsertPaymentRequestInput,
): Promise<PaymentRequest> {
  const request = input.request;
  const [row] = await executor
    .insert(paymentRequests)
    .values({
      id: request.id,
      organizationId: scope.organizationId,
      projectId: request.projectId,
      endpointId: request.endpointId,
      environment: request.environment,
      // bigint -> string for NUMERIC(78,0). Exact, no float in between.
      amountMinorUnits: request.amountMinorUnits.toString(),
      assetSymbol: request.assetSymbol,
      assetAddress: request.assetAddress,
      assetDecimals: request.assetDecimals,
      chainId: request.chainId,
      recipientAddress: request.recipientAddress,
      nonce: request.nonce,
      reference: request.reference,
      protocol: input.protocol,
      // Provenance only; never read back during authorization.
      pricingRuleId: input.pricingRuleId,
      status: request.status,
      expiresAt: request.expiresAt,
      metadata: request.metadata as Record<string, unknown>,
    })
    .returning(PAYMENT_REQUEST_COLUMNS);

  /* istanbul ignore next */
  if (!row) throw new Error('Payment request insert returned no row');
  return toPaymentRequest(row);
}

export async function findPaymentRequestInOrganization(
  executor: Executor,
  scope: TenantScope,
  paymentRequestId: string,
): Promise<PaymentRequest | null> {
  const [row] = await executor
    .select(PAYMENT_REQUEST_COLUMNS)
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.id, paymentRequestId),
        eq(paymentRequests.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  return row ? toPaymentRequest(row) : null;
}

/**
 * Read a payment request under a row lock.
 *
 * Used by completion, which must decide "is this already paid" and write the
 * payment atomically. Without the lock two concurrent completions could both
 * observe an unpaid request. The UNIQUE constraint on `payments.payment_request_id`
 * would still stop a duplicate, but the loser would surface a raw constraint
 * error rather than the idempotent success the caller deserves.
 */
export async function findPaymentRequestForUpdate(
  executor: Executor,
  scope: TenantScope,
  paymentRequestId: string,
): Promise<PaymentRequest | null> {
  const [row] = await executor
    .select(PAYMENT_REQUEST_COLUMNS)
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.id, paymentRequestId),
        eq(paymentRequests.organizationId, scope.organizationId),
      ),
    )
    .limit(1)
    .for('update');

  return row ? toPaymentRequest(row) : null;
}

export async function updatePaymentRequestStatus(
  executor: Executor,
  scope: TenantScope,
  paymentRequestId: string,
  status: PaymentStatus,
): Promise<void> {
  await executor
    .update(paymentRequests)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(paymentRequests.id, paymentRequestId),
        eq(paymentRequests.organizationId, scope.organizationId),
      ),
    );
}

/* --- Payments ----------------------------------------------------------- */

export interface PaymentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly paymentRequestId: string;
  readonly endpointId: string | null;
  readonly environment: MerchantEnvironment;
  readonly status: PaymentStatus;
  readonly protocol: string;
  readonly payerReference: string | null;
  readonly externalTransactionReference: string | null;
  readonly simulated: boolean;
  readonly grossAmountMinorUnits: string;
  readonly netAmountMinorUnits: string;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly chainId: number;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

const PAYMENT_COLUMNS = {
  id: payments.id,
  organizationId: payments.organizationId,
  projectId: payments.projectId,
  paymentRequestId: payments.paymentRequestId,
  endpointId: payments.endpointId,
  environment: payments.environment,
  status: payments.status,
  protocol: payments.protocol,
  payerReference: payments.payerReference,
  externalTransactionReference: payments.externalTransactionReference,
  simulated: payments.simulated,
  grossAmountMinorUnits: payments.grossAmountMinorUnits,
  netAmountMinorUnits: payments.netAmountMinorUnits,
  assetSymbol: payments.assetSymbol,
  assetDecimals: payments.assetDecimals,
  chainId: payments.chainId,
  confirmedAt: payments.confirmedAt,
  createdAt: payments.createdAt,
} as const;

export interface InsertPaymentInput {
  readonly request: PaymentRequest;
  readonly status: PaymentStatus;
  readonly protocol: string;
  readonly payerReference: string | null;
  readonly externalTransactionReference: string;
  readonly simulated: boolean;
  readonly blockchainTransactionId: string | null;
}

/**
 * Create the payment for a request.
 *
 * Every monetary and asset field is taken from `input.request` — the immutable
 * snapshot — and none from the caller. There is deliberately no `amount`
 * parameter: a signature that accepted one would make price tampering a
 * question of whether each call site remembered to ignore it.
 *
 * Returns null when `UNIQUE (payment_request_id)` rejects the insert, meaning
 * a payment already exists. The caller reads the existing row and returns it,
 * which is what makes completion idempotent.
 */
export async function insertPaymentIfAbsent(
  executor: Executor,
  scope: TenantScope,
  input: InsertPaymentInput,
): Promise<PaymentRecord | null> {
  const request = input.request;
  const amount = request.amountMinorUnits.toString();

  const rows = await executor
    .insert(payments)
    .values({
      id: newId('payment'),
      organizationId: scope.organizationId,
      projectId: request.projectId,
      paymentRequestId: request.id,
      endpointId: request.endpointId,
      environment: request.environment,
      status: input.status,
      protocol: input.protocol,
      payerReference: input.payerReference,
      externalTransactionReference: input.externalTransactionReference,
      simulated: input.simulated,
      blockchainTransactionId: input.blockchainTransactionId,
      grossAmountMinorUnits: amount,
      // Phase 2 charges no platform or network fee, so net equals gross. The
      // columns exist so the ledger identity gross = fee + net holds from the
      // first payment rather than being retrofitted.
      platformFeeMinorUnits: '0',
      networkFeeMinorUnits: '0',
      netAmountMinorUnits: amount,
      assetSymbol: request.assetSymbol,
      assetDecimals: request.assetDecimals,
      chainId: request.chainId,
      confirmedAt: new Date(),
    })
    .onConflictDoNothing({ target: payments.paymentRequestId })
    .returning(PAYMENT_COLUMNS);

  return (rows[0] as PaymentRecord | undefined) ?? null;
}

export async function findPaymentByRequest(
  executor: Executor,
  scope: TenantScope,
  paymentRequestId: string,
): Promise<PaymentRecord | null> {
  const [row] = await executor
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(
      and(
        eq(payments.paymentRequestId, paymentRequestId),
        eq(payments.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  return (row as PaymentRecord | undefined) ?? null;
}

export async function findPaymentInOrganization(
  executor: Executor,
  scope: TenantScope,
  paymentId: string,
): Promise<PaymentRecord | null> {
  const [row] = await executor
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.organizationId, scope.organizationId)))
    .limit(1);

  return (row as PaymentRecord | undefined) ?? null;
}

export async function listPaymentsInProject(
  executor: Executor,
  scope: TenantScope,
  projectId: string,
): Promise<readonly PaymentRecord[]> {
  const rows = await executor
    .select(PAYMENT_COLUMNS)
    .from(payments)
    .where(
      and(eq(payments.projectId, projectId), eq(payments.organizationId, scope.organizationId)),
    )
    .orderBy(desc(payments.createdAt));

  return rows as PaymentRecord[];
}

/* --- Receipts ----------------------------------------------------------- */

export interface ReceiptRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly endpointId: string | null;
  readonly paymentId: string;
  readonly paymentRequestId: string;
  readonly environment: MerchantEnvironment | null;
  readonly protocol: string | null;
  readonly amountMinorUnits: string | null;
  readonly assetSymbol: string | null;
  readonly assetDecimals: number | null;
  readonly chainId: number | null;
  readonly externalTransactionReference: string | null;
  readonly simulated: boolean;
  readonly issuedAt: Date;
  readonly metadata: Record<string, unknown>;
}

const RECEIPT_COLUMNS = {
  id: paymentReceipts.id,
  organizationId: paymentReceipts.organizationId,
  projectId: paymentReceipts.projectId,
  endpointId: paymentReceipts.endpointId,
  paymentId: paymentReceipts.paymentId,
  paymentRequestId: paymentReceipts.paymentRequestId,
  environment: paymentReceipts.environment,
  protocol: paymentReceipts.protocol,
  amountMinorUnits: paymentReceipts.amountMinorUnits,
  assetSymbol: paymentReceipts.assetSymbol,
  assetDecimals: paymentReceipts.assetDecimals,
  chainId: paymentReceipts.chainId,
  externalTransactionReference: paymentReceipts.externalTransactionReference,
  simulated: paymentReceipts.simulated,
  issuedAt: paymentReceipts.issuedAt,
  metadata: paymentReceipts.metadata,
} as const;

/**
 * Create the receipt for a payment.
 *
 * `UNIQUE (payment_id)` makes this exactly-once. Like the payment insert it
 * returns null on conflict rather than throwing, so a retry reads the existing
 * receipt instead of producing a second one — a duplicate receipt is a
 * duplicate piece of evidence, which is worse than none.
 */
export async function insertReceiptIfAbsent(
  executor: Executor,
  scope: TenantScope,
  input: {
    payment: PaymentRecord;
    request: PaymentRequest;
    metadata: Readonly<Record<string, unknown>>;
  },
): Promise<ReceiptRecord | null> {
  const rows = await executor
    .insert(paymentReceipts)
    .values({
      id: newId('receipt'),
      organizationId: scope.organizationId,
      paymentId: input.payment.id,
      paymentRequestId: input.request.id,
      projectId: input.request.projectId,
      endpointId: input.request.endpointId,
      environment: input.request.environment,
      protocol: input.payment.protocol,
      amountMinorUnits: input.request.amountMinorUnits.toString(),
      assetSymbol: input.request.assetSymbol,
      assetDecimals: input.request.assetDecimals,
      chainId: input.request.chainId,
      externalTransactionReference: input.payment.externalTransactionReference,
      simulated: input.payment.simulated,
      metadata: input.metadata as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: paymentReceipts.paymentId })
    .returning(RECEIPT_COLUMNS);

  return (rows[0] as ReceiptRecord | undefined) ?? null;
}

export async function findReceiptByPayment(
  executor: Executor,
  scope: TenantScope,
  paymentId: string,
): Promise<ReceiptRecord | null> {
  const [row] = await executor
    .select(RECEIPT_COLUMNS)
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.paymentId, paymentId),
        eq(paymentReceipts.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  return (row as ReceiptRecord | undefined) ?? null;
}

export async function findReceiptInOrganization(
  executor: Executor,
  scope: TenantScope,
  receiptId: string,
): Promise<ReceiptRecord | null> {
  const [row] = await executor
    .select(RECEIPT_COLUMNS)
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.id, receiptId),
        eq(paymentReceipts.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  return (row as ReceiptRecord | undefined) ?? null;
}

export async function listReceiptsInProject(
  executor: Executor,
  scope: TenantScope,
  projectId: string,
): Promise<readonly ReceiptRecord[]> {
  const rows = await executor
    .select(RECEIPT_COLUMNS)
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.projectId, projectId),
        eq(paymentReceipts.organizationId, scope.organizationId),
      ),
    )
    .orderBy(desc(paymentReceipts.issuedAt));

  return rows as ReceiptRecord[];
}

/* --- Usage ------------------------------------------------------------- */

/**
 * Record one billable request.
 *
 * Keyed on the payment so a retried authorization cannot bill twice: the
 * insert is conditional on no usage event already existing for that payment.
 * Metering that double-counts is a billing dispute waiting to happen.
 */
export async function recordUsageEventIfAbsent(
  executor: Executor,
  scope: TenantScope,
  input: {
    projectId: string;
    endpointId: string | null;
    paymentId: string;
    requestId: string | null;
  },
): Promise<boolean> {
  const existing = await executor
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.paymentId, input.paymentId),
        eq(usageEvents.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return false;
  }

  await executor.insert(usageEvents).values({
    id: newId('usageEvent'),
    organizationId: scope.organizationId,
    projectId: input.projectId,
    endpointId: input.endpointId,
    paymentId: input.paymentId,
    requestId: input.requestId,
    unit: 'REQUEST',
    quantity: '1',
  });
  return true;
}

export async function countUsageEventsForPayment(
  executor: Executor,
  scope: TenantScope,
  paymentId: string,
): Promise<number> {
  const rows = await executor
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.paymentId, paymentId),
        eq(usageEvents.organizationId, scope.organizationId),
      ),
    );
  return rows.length;
}

/* --- Ownership resolution ---------------------------------------------- */

/**
 * Resolve which organization owns a payment resource — and nothing else.
 *
 * The one deliberately unscoped read in this module, and the same narrow
 * exception `findProjectOrganizationId` and `findEndpointOrganizationId` make,
 * for the same reason: it lets routes be addressed as
 * `/v1/receipts/:receiptId` instead of forcing every caller to also name the
 * organization.
 *
 * It is safe because of what it does *not* return. The only value that leaves
 * this function is an opaque organization ID, never payment data, and the
 * caller must immediately pass it through `resolveOrganizationAccess`, which
 * answers 404 unless the user holds a membership. A caller probing another
 * tenant's receipt ID therefore learns nothing: the ID never reaches them and
 * the response is identical to a receipt that does not exist.
 *
 * Written as one function over a closed set of tables rather than three
 * near-identical ones, so the exception stays a single reviewable place. Any
 * change that makes it return more than the organization ID needs a second
 * look — the narrowness is the security property.
 */
export type PaymentResourceKind = 'payment_request' | 'payment' | 'receipt';

export async function findPaymentResourceOrganizationId(
  executor: Executor,
  kind: PaymentResourceKind,
  resourceId: string,
): Promise<string | null> {
  if (kind === 'payment_request') {
    const [row] = await executor
      .select({ organizationId: paymentRequests.organizationId })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, resourceId))
      .limit(1);
    return row?.organizationId ?? null;
  }

  if (kind === 'payment') {
    const [row] = await executor
      .select({ organizationId: payments.organizationId })
      .from(payments)
      .where(eq(payments.id, resourceId))
      .limit(1);
    return row?.organizationId ?? null;
  }

  const [row] = await executor
    .select({ organizationId: paymentReceipts.organizationId })
    .from(paymentReceipts)
    .where(eq(paymentReceipts.id, resourceId))
    .limit(1);
  return row?.organizationId ?? null;
}

/* --- Attempts ----------------------------------------------------------- */

/**
 * Record one attempt to pay a request.
 *
 * Written for failures as well as successes, because "this authorization was
 * rejected four times before one succeeded" is what a support conversation or
 * an abuse investigation actually needs.
 *
 * Deliberately narrow: it stores a transaction hash and a reason code, never
 * the signed payload. A stored EIP-3009 signature is a bearer instrument, and
 * an attempts table is exactly the sort of widely-readable operational data
 * that should not contain one.
 */
export async function recordPaymentAttempt(
  executor: Executor,
  scope: TenantScope,
  input: {
    paymentRequestId: string;
    transactionHash: string | null;
    succeeded: boolean;
    failureReason: string | null;
    requestId: string | null;
    sourceIp: string | null;
  },
): Promise<void> {
  await executor.insert(paymentAttempts).values({
    id: newId('paymentAttempt'),
    organizationId: scope.organizationId,
    paymentRequestId: input.paymentRequestId,
    transactionHash: input.transactionHash,
    succeeded: input.succeeded,
    failureReason: input.failureReason,
    requestId: input.requestId,
    sourceIp: input.sourceIp,
  });
}
