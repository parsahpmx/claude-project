import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  MerchantEnvironment,
  Meter402Error,
  Money,
  assertChainAllowedForEnvironment,
  findAsset,
} from '@meter402/shared';
import type { Database } from '@meter402/database';
import { assertValidPath, normalizePath, type HttpMethod } from '../../lib/http-path.js';
import type { TenantScope } from '../../lib/tenant.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import { isUniqueViolation } from '../identity/organization.service.js';
import {
  createEndpoint,
  createPricingRule,
  findEndpointInOrganization,
  updateEndpoint,
  type EndpointRecord,
  type PricingRuleRecord,
} from './endpoint.repository.js';

export interface EndpointActor {
  readonly actorUserId: string;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreateEndpointRequest {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly path: string;
  readonly method: HttpMethod;
  readonly environment: MerchantEnvironment;
  readonly price: { amount: string; asset: string };
}

/**
 * Validate a price against the asset that will carry it.
 *
 * Done here, at configuration time, rather than at payment time. A price with
 * more precision than the asset can represent is a merchant mistake, and the
 * moment to tell them is while they are typing it — not silently at 3am when
 * an agent's payment is rejected for an amount nobody can explain.
 *
 * `Money.fromDecimalString` refuses to truncate, so "0.0000001" against
 * 6-decimal USDC is an error rather than a silent zero.
 */
function validatePrice(
  amount: string,
  assetSymbol: string,
  chainId: number,
): { asset: ReturnType<typeof findAsset>; money: Money } {
  const asset = findAsset(assetSymbol, chainId);
  if (!asset) {
    throw new Meter402Error(
      'INVALID_PRICE',
      `Asset ${assetSymbol} is not supported on chain ${chainId}.`,
      { details: { asset: assetSymbol, chainId } },
    );
  }

  let money: Money;
  try {
    money = Money.fromDecimalString(amount, asset.symbol, asset.decimals);
  } catch (error) {
    throw new Meter402Error(
      'INVALID_PRICE',
      error instanceof Error ? error.message : 'The price is not a valid decimal amount.',
      { details: { amount } },
    );
  }

  if (!money.isPositive()) {
    throw new Meter402Error(
      'INVALID_PRICE',
      'An endpoint price must be greater than zero. A free endpoint should not be registered as paid.',
      { details: { amount } },
    );
  }
  return { asset, money };
}

/**
 * Create a paid endpoint and its pricing rule, atomically.
 *
 * One transaction because an endpoint without its pricing rule is a route that
 * cannot be priced, and a pricing rule without its endpoint is an orphan. The
 * audit event joins them, so all three exist or none do.
 */
export async function createEndpointWithPricing(
  db: Database,
  scope: TenantScope,
  actor: EndpointActor,
  request: CreateEndpointRequest,
  chainId: number,
): Promise<{ endpoint: EndpointRecord; pricingRule: PricingRuleRecord }> {
  assertValidPath(request.path);
  const normalizedPath = normalizePath(request.path);

  /*
   * TEST/LIVE separation, enforced at the earliest point a merchant's
   * configuration becomes a concrete chain instruction. A TEST endpoint can
   * only ever be priced on a testnet chain.
   */
  assertChainAllowedForEnvironment(chainId, request.environment);
  const { asset } = validatePrice(request.price.amount, request.price.asset, chainId);
  /* istanbul ignore next -- validatePrice throws when the asset is unknown. */
  if (!asset) {
    throw new Meter402Error('INVALID_PRICE', 'Unsupported asset.');
  }

  try {
    return await db.transaction(async (tx) => {
      const pricingRule = await createPricingRule(tx, scope, {
        projectId: request.projectId,
        environment: request.environment,
        amount: request.price.amount,
        assetSymbol: asset.symbol,
        assetDecimals: asset.decimals,
        chainId,
      });

      const endpoint = await createEndpoint(tx, scope, {
        projectId: request.projectId,
        name: request.name.trim(),
        description: request.description ?? null,
        path: request.path.trim(),
        normalizedPath,
        method: request.method,
        environment: request.environment,
        pricingRuleId: pricingRule.id,
      });

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorType: 'user',
        actorId: actor.actorUserId,
        action: 'endpoint.created',
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        requestId: actor.requestId ?? null,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        metadata: {
          method: endpoint.method,
          path: endpoint.normalizedPath,
          environment: endpoint.environment,
          price: request.price.amount,
          asset: asset.symbol,
          pricingRuleId: pricingRule.id,
        },
      });

      return { endpoint, pricingRule };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Meter402Error(
        'CONFLICT',
        `An endpoint for ${request.method} ${normalizedPath} already exists in this project's ${request.environment} environment.`,
        { details: { method: request.method, path: normalizedPath } },
      );
    }
    throw error;
  }
}

/**
 * Reprice an endpoint.
 *
 * Creates a *new* pricing rule and repoints the endpoint at it, rather than
 * mutating the existing rule in place. Outstanding PaymentRequests are
 * unaffected either way — they carry their amount as a value — but keeping old
 * rules intact means the `pricing_rule_id` recorded on a historical request
 * still resolves to the rule that actually produced it, which is what makes
 * "why was this priced at 0.03" answerable.
 */
export async function repriceEndpoint(
  db: Database,
  scope: TenantScope,
  actor: EndpointActor,
  endpointId: string,
  price: { amount: string; asset: string },
): Promise<{ endpoint: EndpointRecord; pricingRule: PricingRuleRecord }> {
  const existing = await findEndpointInOrganization(db, scope, endpointId);
  if (!existing) {
    throw new Meter402Error('ENDPOINT_NOT_FOUND');
  }
  if (existing.status === 'ARCHIVED') {
    throw new Meter402Error('CONFLICT', 'An archived endpoint cannot be repriced.');
  }

  const chainId = chainIdForEnvironment(existing.environment);
  const { asset } = validatePrice(price.amount, price.asset, chainId);
  /* istanbul ignore next */
  if (!asset) {
    throw new Meter402Error('INVALID_PRICE', 'Unsupported asset.');
  }

  return db.transaction(async (tx) => {
    const pricingRule = await createPricingRule(tx, scope, {
      projectId: existing.projectId,
      environment: existing.environment,
      amount: price.amount,
      assetSymbol: asset.symbol,
      assetDecimals: asset.decimals,
      chainId,
    });

    const endpoint = await updateEndpoint(tx, scope, endpointId, {
      pricingRuleId: pricingRule.id,
    });
    /* istanbul ignore next -- read under the same scope moments ago. */
    if (!endpoint) {
      throw new Meter402Error('ENDPOINT_NOT_FOUND');
    }

    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: actor.actorUserId,
      action: 'pricing_rule.created',
      resourceType: 'endpoint',
      resourceId: endpointId,
      requestId: actor.requestId ?? null,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: {
        previousPricingRuleId: existing.pricingRuleId,
        pricingRuleId: pricingRule.id,
        price: price.amount,
        asset: asset.symbol,
      },
    });

    return { endpoint, pricingRule };
  });
}

/**
 * The chain an environment settles on.
 *
 * Derived from the environment through the shared chain registry rather than
 * stored on the endpoint. That means a TEST endpoint cannot be pointed at a
 * mainnet chain by editing one column, and adding a chain later is a registry
 * change rather than a hunt for hardcoded IDs.
 */
export function chainIdForEnvironment(environment: MerchantEnvironment): number {
  return environment === MerchantEnvironment.Live ? BASE_MAINNET.id : BASE_SEPOLIA.id;
}
