import { and, desc, eq } from 'drizzle-orm';
import { newId, type MerchantEnvironment } from '@meter402/shared';
import { endpoints, pricingRules } from '@meter402/database';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';
import type { HttpMethod } from '../../lib/http-path.js';

/**
 * Endpoints and their pricing rules.
 *
 * Every function takes a `TenantScope` and includes `organization_id` in its
 * WHERE clause. There is no `findEndpointById(id)`: the narrowest lookup is
 * "this endpoint, within this organization", so a guessed or leaked endpoint
 * ID from another tenant simply returns nothing.
 */

export type EndpointStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
export type SettlementProtocol = 'test' | 'x402';

export interface EndpointRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly path: string;
  readonly normalizedPath: string;
  readonly method: HttpMethod;
  readonly environment: MerchantEnvironment;
  readonly status: EndpointStatus;
  /** How this endpoint settles: simulated (`test`) or real (`x402`). */
  readonly settlementProtocol: SettlementProtocol;
  readonly pricingRuleId: string | null;
  readonly createdAt: Date;
}

export interface PricingRuleRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environment: MerchantEnvironment;
  readonly kind: 'FIXED';
  readonly amount: string;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly chainId: number;
  readonly createdAt: Date;
}

const ENDPOINT_COLUMNS = {
  id: endpoints.id,
  organizationId: endpoints.organizationId,
  projectId: endpoints.projectId,
  name: endpoints.name,
  description: endpoints.description,
  path: endpoints.path,
  normalizedPath: endpoints.normalizedPath,
  method: endpoints.method,
  environment: endpoints.environment,
  status: endpoints.status,
  settlementProtocol: endpoints.settlementProtocol,
  pricingRuleId: endpoints.pricingRuleId,
  createdAt: endpoints.createdAt,
} as const;

const PRICING_RULE_COLUMNS = {
  id: pricingRules.id,
  organizationId: pricingRules.organizationId,
  projectId: pricingRules.projectId,
  environment: pricingRules.environment,
  kind: pricingRules.kind,
  amount: pricingRules.amount,
  assetSymbol: pricingRules.assetSymbol,
  assetDecimals: pricingRules.assetDecimals,
  chainId: pricingRules.chainId,
  createdAt: pricingRules.createdAt,
} as const;

export interface CreatePricingRuleInput {
  readonly projectId: string;
  readonly environment: MerchantEnvironment;
  readonly amount: string;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly chainId: number;
}

export async function createPricingRule(
  executor: Executor,
  scope: TenantScope,
  input: CreatePricingRuleInput,
): Promise<PricingRuleRecord> {
  const [row] = await executor
    .insert(pricingRules)
    .values({
      id: newId('pricingRule'),
      // From the scope, never the request body.
      organizationId: scope.organizationId,
      projectId: input.projectId,
      environment: input.environment,
      kind: 'FIXED',
      amount: input.amount,
      assetSymbol: input.assetSymbol,
      assetDecimals: input.assetDecimals,
      chainId: input.chainId,
    })
    .returning(PRICING_RULE_COLUMNS);

  /* istanbul ignore next */
  if (!row) throw new Error('Pricing rule insert returned no row');
  return row as PricingRuleRecord;
}

export async function findPricingRule(
  executor: Executor,
  scope: TenantScope,
  pricingRuleId: string,
): Promise<PricingRuleRecord | null> {
  const [row] = await executor
    .select(PRICING_RULE_COLUMNS)
    .from(pricingRules)
    .where(
      and(
        eq(pricingRules.id, pricingRuleId),
        eq(pricingRules.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  return (row as PricingRuleRecord | undefined) ?? null;
}

export interface CreateEndpointInput {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly path: string;
  readonly normalizedPath: string;
  readonly method: HttpMethod;
  readonly environment: MerchantEnvironment;
  readonly settlementProtocol: SettlementProtocol;
  readonly pricingRuleId: string | null;
}

export async function createEndpoint(
  executor: Executor,
  scope: TenantScope,
  input: CreateEndpointInput,
): Promise<EndpointRecord> {
  const [row] = await executor
    .insert(endpoints)
    .values({
      id: newId('endpoint'),
      organizationId: scope.organizationId,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      path: input.path,
      normalizedPath: input.normalizedPath,
      method: input.method,
      environment: input.environment,
      settlementProtocol: input.settlementProtocol,
      status: 'ACTIVE',
      pricingRuleId: input.pricingRuleId,
    })
    .returning(ENDPOINT_COLUMNS);

  /* istanbul ignore next */
  if (!row) throw new Error('Endpoint insert returned no row');
  return row as EndpointRecord;
}

export async function findEndpointInOrganization(
  executor: Executor,
  scope: TenantScope,
  endpointId: string,
): Promise<EndpointRecord | null> {
  const [row] = await executor
    .select(ENDPOINT_COLUMNS)
    .from(endpoints)
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.organizationId, scope.organizationId)))
    .limit(1);

  return (row as EndpointRecord | undefined) ?? null;
}

/**
 * Resolve an endpoint by its route.
 *
 * Environment is part of the lookup key, not a filter applied afterwards: a
 * TEST request must never be able to resolve the LIVE definition of the same
 * route, and making it part of the key means there is no code path where that
 * could happen through a forgotten condition.
 */
export async function findEndpointByRoute(
  executor: Executor,
  scope: TenantScope,
  route: {
    projectId: string;
    environment: MerchantEnvironment;
    method: HttpMethod;
    normalizedPath: string;
  },
): Promise<EndpointRecord | null> {
  const [row] = await executor
    .select(ENDPOINT_COLUMNS)
    .from(endpoints)
    .where(
      and(
        eq(endpoints.organizationId, scope.organizationId),
        eq(endpoints.projectId, route.projectId),
        eq(endpoints.environment, route.environment),
        eq(endpoints.method, route.method),
        eq(endpoints.normalizedPath, route.normalizedPath),
      ),
    )
    .limit(1);

  return (row as EndpointRecord | undefined) ?? null;
}

export async function listEndpointsInProject(
  executor: Executor,
  scope: TenantScope,
  projectId: string,
  filter: { environment?: MerchantEnvironment } = {},
): Promise<readonly EndpointRecord[]> {
  const conditions = [
    eq(endpoints.projectId, projectId),
    eq(endpoints.organizationId, scope.organizationId),
  ];
  if (filter.environment !== undefined) {
    conditions.push(eq(endpoints.environment, filter.environment));
  }

  const rows = await executor
    .select(ENDPOINT_COLUMNS)
    .from(endpoints)
    .where(and(...conditions))
    .orderBy(desc(endpoints.createdAt));

  return rows as EndpointRecord[];
}

export async function updateEndpoint(
  executor: Executor,
  scope: TenantScope,
  endpointId: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: EndpointStatus;
    settlementProtocol?: SettlementProtocol;
    pricingRuleId?: string;
  },
): Promise<EndpointRecord | null> {
  const [row] = await executor
    .update(endpoints)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.settlementProtocol !== undefined
        ? { settlementProtocol: patch.settlementProtocol }
        : {}),
      ...(patch.pricingRuleId !== undefined ? { pricingRuleId: patch.pricingRuleId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.organizationId, scope.organizationId)))
    .returning(ENDPOINT_COLUMNS);

  return (row as EndpointRecord | undefined) ?? null;
}

/**
 * Resolve which organization owns an endpoint — and nothing else.
 *
 * The same narrow exception as `findProjectOrganizationId`, for the same
 * reason: it lets routes be addressed by endpoint ID while the caller still
 * has to pass the membership check before any endpoint data is returned. It
 * yields an opaque organization ID only, so a probe against another tenant's
 * endpoint ID learns nothing.
 */
export async function findEndpointOrganizationId(
  executor: Executor,
  endpointId: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ organizationId: endpoints.organizationId })
    .from(endpoints)
    .where(eq(endpoints.id, endpointId))
    .limit(1);

  return row?.organizationId ?? null;
}
