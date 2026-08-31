import { MerchantEnvironment, Meter402Error, findAsset, isValidAddress } from '@meter402/shared';
import type { Database } from '@meter402/database';
import { PricingEngine, type PricingContext } from '@meter402/pricing';
import {
  PaymentStatus,
  assertTransition,
  createPaymentRequest,
  type PaymentRequest,
} from '@meter402/payments';
import type { TenantScope } from '../../lib/tenant.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import { findPricingRule, type EndpointRecord } from '../endpoints/endpoint.repository.js';
import { chainIdForEnvironment } from '../endpoints/endpoint.service.js';
import { findOrganization } from '../identity/organization.repository.js';
import { findProjectInOrganization } from '../projects/project.repository.js';
import { insertPaymentRequest } from './payment.repository.js';

/**
 * The recipient used for TEST payments when a merchant has not configured a
 * settlement address.
 *
 * A well-known burn address, deliberately recognisable. TEST money is not real
 * money and nothing is ever sent here — but a payment request needs *a*
 * recipient, and requiring a settlement wallet before a developer can run
 * their first simulated payment would defeat the point of TEST mode.
 *
 * LIVE has no equivalent default: a LIVE request without a configured
 * settlement address is refused, because guessing where real revenue should go
 * is not a thing software should do.
 */
export const TEST_FALLBACK_RECIPIENT = '0x000000000000000000000000000000000000dead';

const pricingEngine = new PricingEngine();

export interface PaymentRequestActor {
  readonly actorType: 'user' | 'api_key';
  readonly actorId: string;
  readonly requestId?: string | null;
}

export interface CreatePaymentRequestInput {
  readonly endpoint: EndpointRecord;
  readonly protocol: string;
  readonly ttlSeconds: number;
  readonly agentReference?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Resolve where a payment should be sent.
 *
 * Project setting wins over organization setting, so a merchant can route one
 * project's revenue separately. LIVE without a configured address is a hard
 * failure rather than a fallback.
 */
async function resolveRecipient(
  db: Database,
  scope: TenantScope,
  projectId: string,
  environment: MerchantEnvironment,
): Promise<string> {
  const project = await findProjectInOrganization(db, scope, projectId);
  const organization = await findOrganization(db, scope);
  const configured = project?.settlementAddress ?? organization?.settlementAddress ?? null;

  if (configured && isValidAddress(configured)) {
    return configured.toLowerCase();
  }

  if (environment === MerchantEnvironment.Live) {
    throw new Meter402Error(
      'CONFLICT',
      'This project has no settlement address configured, so a LIVE payment cannot be requested.',
      { details: { projectId } },
    );
  }
  return TEST_FALLBACK_RECIPIENT;
}

/**
 * Create an immutable PaymentRequest for an endpoint.
 *
 * The price is evaluated **once**, here, and written onto the request as
 * values: amount, asset symbol, asset address, decimals, chain, recipient.
 * `pricing_rule_id` is stored alongside for provenance but is never read back
 * during verification or authorization.
 *
 * That is what makes the snapshot immutable in practice rather than by
 * promise: a merchant repricing the endpoint tomorrow cannot change this
 * request's amount, because no code path re-derives it.
 */
export async function createPaymentRequestForEndpoint(
  db: Database,
  scope: TenantScope,
  actor: PaymentRequestActor,
  input: CreatePaymentRequestInput,
): Promise<PaymentRequest> {
  const endpoint = input.endpoint;

  if (endpoint.status !== 'ACTIVE') {
    throw new Meter402Error(
      'ENDPOINT_DISABLED',
      `This endpoint is ${endpoint.status} and is not accepting payments.`,
      { details: { status: endpoint.status } },
    );
  }

  if (!endpoint.pricingRuleId) {
    throw new Meter402Error(
      'PRICING_RULE_NOT_FOUND',
      'This endpoint has no pricing rule and cannot be charged for.',
    );
  }

  const rule = await findPricingRule(db, scope, endpoint.pricingRuleId);
  if (!rule) {
    throw new Meter402Error('PRICING_RULE_NOT_FOUND');
  }

  /*
   * Defence in depth. The rule is reached through the endpoint, which is
   * already tenant-scoped, so a cross-environment rule should be impossible.
   * Checking anyway costs nothing and turns a would-be silent TEST/LIVE
   * confusion into a loud failure.
   */
  if (rule.environment !== endpoint.environment) {
    throw new Meter402Error(
      'TEST_LIVE_MISMATCH',
      'The pricing rule and endpoint belong to different environments.',
      { details: { rule: rule.environment, endpoint: endpoint.environment } },
    );
  }

  const chainId = chainIdForEnvironment(endpoint.environment);
  const context: PricingContext = {
    organizationId: scope.organizationId,
    projectId: endpoint.projectId,
    endpointId: endpoint.id,
    environment: endpoint.environment,
    method: endpoint.method,
    path: endpoint.normalizedPath,
    agentId: input.agentReference ?? null,
    requestedAt: new Date(),
    metadata: input.metadata ?? {},
  };

  // The single price evaluation. Everything after this reads the snapshot.
  const quote = await pricingEngine.quote(
    {
      id: rule.id,
      kind: rule.kind,
      amount: rule.amount,
      assetSymbol: rule.assetSymbol,
      chainId: rule.chainId,
    },
    context,
  );

  const asset = findAsset(quote.asset.symbol, chainId);
  /* istanbul ignore next -- the quote came from the same registry. */
  if (!asset) {
    throw new Meter402Error('INVALID_PRICE', 'Quoted asset is not supported on this chain.');
  }

  const recipient = await resolveRecipient(db, scope, endpoint.projectId, endpoint.environment);

  const draft = createPaymentRequest({
    organizationId: scope.organizationId,
    projectId: endpoint.projectId,
    endpointId: endpoint.id,
    environment: endpoint.environment,
    amount: quote.amount,
    asset,
    recipientAddress: recipient,
    ttlSeconds: input.ttlSeconds,
    metadata: input.metadata ?? {},
  });

  /*
   * Walk the state machine rather than writing the target status directly.
   * The request is CREATED the instant it exists and CHALLENGE_ISSUED once we
   * are about to hand the requirement to a caller; asserting the transition
   * means this path is bound by the same table as every other status change.
   */
  assertTransition(draft.status, PaymentStatus.ChallengeIssued, draft.id);
  const issued: PaymentRequest = { ...draft, status: PaymentStatus.ChallengeIssued };

  return db.transaction(async (tx) => {
    const stored = await insertPaymentRequest(tx, scope, {
      request: issued,
      protocol: input.protocol,
      pricingRuleId: rule.id,
    });

    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'payment_request.created',
      resourceType: 'payment_request',
      resourceId: stored.id,
      requestId: actor.requestId ?? null,
      metadata: {
        endpointId: endpoint.id,
        environment: endpoint.environment,
        // Recorded as a string; a JSON number would be a double.
        amountMinorUnits: stored.amountMinorUnits.toString(),
        asset: stored.assetSymbol,
        pricingRuleId: rule.id,
        protocol: input.protocol,
      },
    });

    return stored;
  });
}
