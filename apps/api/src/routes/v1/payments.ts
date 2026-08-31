import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MerchantEnvironment, Meter402Error } from '@meter402/shared';
import {
  requireEnvironment,
  requirePermission,
  requireScope,
  type ApiKeyPrincipal,
  type AuthorizationContext,
  type Principal,
} from '@meter402/auth';
import type { Database } from '@meter402/database';
import { resolveOrganizationAccess } from '../../auth/authenticate.js';
import { getPrincipal, type RouteDeps } from '../context.js';
import { parseParams } from '../../lib/validation.js';
import { scopeFromApiKey, scopeFromContext, type TenantScope } from '../../lib/tenant.js';
import {
  findPaymentInOrganization,
  findPaymentRequestInOrganization,
  findPaymentResourceOrganizationId,
  findReceiptInOrganization,
  type PaymentRecord,
  type PaymentResourceKind,
  type ReceiptRecord,
} from '../../modules/payments/payment.repository.js';
import { completeTestPayment } from '../../modules/payments/test-payment.service.js';
import type { PaymentRequest } from '@meter402/payments';

/*
 * Payment resources.
 *
 * These routes accept either principal type, because both have a legitimate
 * need: a developer inspects a payment in the dashboard, and an agent's own
 * tooling reads back the receipt it just paid for. The two are authorized
 * differently — RBAC permissions for people, scopes for machines — and that
 * difference is expressed once, in `readScope` below, rather than repeated in
 * each handler.
 */

const paymentRequestParams = z.object({ paymentRequestId: z.string().min(1).max(64) });
const receiptParams = z.object({ receiptId: z.string().min(1).max(64) });
const paymentParams = z.object({ paymentId: z.string().min(1).max(64) });

function serializePaymentRequest(request: PaymentRequest) {
  return {
    id: request.id,
    projectId: request.projectId,
    endpointId: request.endpointId,
    environment: request.environment,
    status: request.status,
    // Money as a string. A JSON number is an IEEE-754 double, and a payment
    // amount that survives a round-trip through one is a coincidence.
    amountMinorUnits: request.amountMinorUnits.toString(),
    asset: {
      symbol: request.assetSymbol,
      address: request.assetAddress,
      decimals: request.assetDecimals,
    },
    chainId: request.chainId,
    recipient: request.recipientAddress,
    // The nonce is public: it is handed to the agent in the 402 challenge.
    nonce: request.nonce,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
  };
}

function serializePayment(payment: PaymentRecord) {
  return {
    id: payment.id,
    projectId: payment.projectId,
    paymentRequestId: payment.paymentRequestId,
    endpointId: payment.endpointId,
    environment: payment.environment,
    status: payment.status,
    protocol: payment.protocol,
    simulated: payment.simulated,
    amountMinorUnits: payment.grossAmountMinorUnits,
    netAmountMinorUnits: payment.netAmountMinorUnits,
    asset: { symbol: payment.assetSymbol, decimals: payment.assetDecimals },
    chainId: payment.chainId,
    reference: payment.externalTransactionReference,
    confirmedAt: payment.confirmedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

function serializeReceipt(receipt: ReceiptRecord) {
  return {
    id: receipt.id,
    paymentId: receipt.paymentId,
    paymentRequestId: receipt.paymentRequestId,
    projectId: receipt.projectId,
    endpointId: receipt.endpointId,
    environment: receipt.environment,
    protocol: receipt.protocol,
    amountMinorUnits: receipt.amountMinorUnits,
    asset: { symbol: receipt.assetSymbol, decimals: receipt.assetDecimals },
    chainId: receipt.chainId,
    reference: receipt.externalTransactionReference,
    // Prominent, not buried in metadata: a receipt that does not say it is
    // simulated is one somebody will eventually reconcile as real revenue.
    simulated: receipt.simulated,
    issuedAt: receipt.issuedAt.toISOString(),
    metadata: receipt.metadata,
  };
}

/**
 * Resolve a scope entitled to read one payment resource, from either principal
 * type.
 *
 * A machine credential names its own organization, so nothing needs looking
 * up: it must simply hold the `payments:read` scope.
 *
 * A human session names no organization, so the resource's owner is resolved
 * first — a lookup that yields an opaque organization ID and no payment data —
 * and membership is then checked against it. A caller probing another tenant's
 * ID gets exactly the 404 they would get for an ID that never existed, so the
 * two cases stay indistinguishable.
 *
 * `notFound` is the code to raise when the resource is not the caller's,
 * passed in so each route answers with its own resource's 404 rather than
 * leaking which table the ID was found in.
 */
async function readScope(
  db: Database,
  principal: Principal,
  kind: PaymentResourceKind,
  resourceId: string,
  notFound: 'PAYMENT_REQUEST_NOT_FOUND' | 'RECEIPT_NOT_FOUND' | 'RESOURCE_NOT_FOUND',
): Promise<TenantScope> {
  if (principal.type === 'api_key') {
    requireScope(principal, 'payments:read');
    return scopeFromApiKey(principal);
  }

  const organizationId = await findPaymentResourceOrganizationId(db, kind, resourceId);
  if (!organizationId) {
    throw new Meter402Error(notFound);
  }

  let context: AuthorizationContext;
  try {
    ({ context } = await resolveOrganizationAccess(db, principal, organizationId));
  } catch (error) {
    // A non-member must not learn that the resource exists elsewhere.
    if (error instanceof Meter402Error && error.code === 'ORGANIZATION_NOT_FOUND') {
      throw new Meter402Error(notFound);
    }
    throw error;
  }

  requirePermission(context, 'payments:read');
  return scopeFromContext(context);
}

export function registerPaymentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/v1/payment-requests/:paymentRequestId', async (request) => {
    const principal = getPrincipal(request);
    const { paymentRequestId } = parseParams(paymentRequestParams, request.params);

    const scope = await readScope(
      deps.db,
      principal,
      'payment_request',
      paymentRequestId,
      'PAYMENT_REQUEST_NOT_FOUND',
    );
    const record = await findPaymentRequestInOrganization(deps.db, scope, paymentRequestId);
    if (!record) {
      // 404 for another tenant's ID, identical to one that never existed.
      throw new Meter402Error('PAYMENT_REQUEST_NOT_FOUND');
    }
    return { data: serializePaymentRequest(record) };
  });

  app.get('/v1/payments/:paymentId', async (request) => {
    const principal = getPrincipal(request);
    const { paymentId } = parseParams(paymentParams, request.params);

    const scope = await readScope(deps.db, principal, 'payment', paymentId, 'RESOURCE_NOT_FOUND');
    const record = await findPaymentInOrganization(deps.db, scope, paymentId);
    if (!record) {
      throw new Meter402Error('RESOURCE_NOT_FOUND', 'No such payment.');
    }
    return { data: serializePayment(record) };
  });

  app.get('/v1/receipts/:receiptId', async (request) => {
    const principal = getPrincipal(request);
    const { receiptId } = parseParams(receiptParams, request.params);

    const scope = await readScope(deps.db, principal, 'receipt', receiptId, 'RECEIPT_NOT_FOUND');
    const record = await findReceiptInOrganization(deps.db, scope, receiptId);
    if (!record) {
      throw new Meter402Error('RECEIPT_NOT_FOUND');
    }
    return { data: serializeReceipt(record) };
  });

  /**
   * Complete a TEST payment.
   *
   * The simulator. Note what this handler does *not* accept: no environment,
   * no amount, no "simulate" flag, no override of any kind. Its entire input
   * is a payment request ID in the URL. Every decision — which environment,
   * how much, to whom — is read from the stored request.
   *
   * That is deliberate and is the third of the four simulator guards: there is
   * no parameter a caller could supply to make this touch LIVE, because the
   * handler takes no parameters that could say so.
   */
  app.post('/v1/test/payment-requests/:paymentRequestId/complete', async (request) => {
    const principal = getPrincipal(request);
    const { paymentRequestId } = parseParams(paymentRequestParams, request.params);

    const { scope, actor } = await writeAccess(deps.db, principal, paymentRequestId);

    const result = await completeTestPayment(
      deps.db,
      scope,
      deps.config,
      {
        ...actor,
        requestId: String(request.id),
        ipAddress: request.ip,
        userAgent: (request.headers['user-agent'] ?? null)?.slice(0, 256) ?? null,
      },
      paymentRequestId,
    );

    return {
      data: {
        paymentRequest: serializePaymentRequest(result.request),
        payment: serializePayment(result.payment),
        receipt: serializeReceipt(result.receipt),
        /*
         * The reference the agent must present on its retry. Returned here
         * because this is the only place it is available to the payer — it is
         * derived from a server-side secret and never appears in the 402.
         */
        reference: result.reference,
        // False when this call found the payment already complete. Idempotent
        // rather than an error, so a retrying agent is not punished.
        created: result.created,
      },
    };
  });
}

/**
 * Resolve a write scope for the simulator.
 *
 * A machine credential must hold `payments:write` *and* be a TEST key —
 * `requireEnvironment` is the second guard, and it means a LIVE key cannot
 * reach the simulator even for a TEST payment request. A human must hold
 * `payments:read` at minimum; completing a test payment is a development
 * action, not a treasury one.
 */
async function writeAccess(
  db: Database,
  principal: Principal,
  paymentRequestId: string,
): Promise<{
  scope: TenantScope;
  actor: { actorType: 'user' | 'api_key'; actorId: string };
}> {
  if (principal.type === 'api_key') {
    return apiKeyWriteAccess(principal);
  }
  const scope = await readScope(
    db,
    principal,
    'payment_request',
    paymentRequestId,
    'PAYMENT_REQUEST_NOT_FOUND',
  );
  return { scope, actor: { actorType: 'user', actorId: principal.userId } };
}

function apiKeyWriteAccess(principal: ApiKeyPrincipal): {
  scope: TenantScope;
  actor: { actorType: 'user' | 'api_key'; actorId: string };
} {
  requireScope(principal, 'payments:write');
  requireEnvironment(principal, MerchantEnvironment.Test);
  return {
    scope: scopeFromApiKey(principal),
    actor: { actorType: 'api_key', actorId: principal.apiKeyId },
  };
}
