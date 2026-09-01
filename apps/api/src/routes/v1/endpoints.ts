import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MerchantEnvironment, Meter402Error } from '@meter402/shared';
import { requirePermission } from '@meter402/auth';
import { requireUserPrincipal } from '../../auth/authenticate.js';
import { actorContext, getPrincipal, type RouteDeps } from '../context.js';
import { HTTP_METHODS } from '../../lib/http-path.js';
import { parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import { recordAuditEvent } from '../../modules/audit/audit.repository.js';
import {
  findEndpointInOrganization,
  findEndpointOrganizationId,
  findPricingRule,
  listEndpointsInProject,
  updateEndpoint,
  type EndpointRecord,
  type PricingRuleRecord,
} from '../../modules/endpoints/endpoint.repository.js';
import {
  chainIdForEnvironment,
  createEndpointWithPricing,
  repriceEndpoint,
} from '../../modules/endpoints/endpoint.service.js';
import { resolveOrganizationAccess } from '../../auth/authenticate.js';
import { resolveProjectAccess } from './projects.js';
import type { TenantScope } from '../../lib/tenant.js';
import type { AuthorizationContext, UserPrincipal } from '@meter402/auth';
import type { Database } from '@meter402/database';

/*
 * Paid endpoints.
 *
 * These are merchant-configuration routes, so they are user-only: creating or
 * repricing an endpoint is an act of running a business, not something an
 * agent credential should be able to do. An API key that could reprice the
 * endpoints it pays for would be a considerable design mistake, so the
 * handlers narrow to a user principal rather than accepting either type.
 */

const environmentSchema = z.enum([MerchantEnvironment.Test, MerchantEnvironment.Live]);

const priceSchema = z.object({
  // A decimal string, never a JSON number. `Money.fromDecimalString` refuses
  // to truncate, so over-precision is an error rather than silent rounding.
  amount: z.string().trim().min(1).max(40),
  asset: z.string().trim().min(2).max(12),
});

const createEndpointSchema = z.object({
  projectId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  path: z.string().min(1).max(512),
  method: z.enum(HTTP_METHODS),
  environment: environmentSchema,
  price: priceSchema,
  /*
   * How this endpoint settles. Defaults to `test` — a merchant opts in to
   * real money explicitly, and never gets it by leaving a field out.
   */
  settlementProtocol: z.enum(['test', 'x402']).default('test'),
});

const updateEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED']).optional(),
    settlementProtocol: z.enum(['test', 'x402']).optional(),
    price: priceSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(64),
  environment: environmentSchema.optional(),
});

const endpointParams = z.object({ endpointId: z.string().min(1).max(64) });

function serializeEndpoint(record: EndpointRecord, pricingRule?: PricingRuleRecord | null) {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    path: record.path,
    normalizedPath: record.normalizedPath,
    method: record.method,
    environment: record.environment,
    status: record.status,
    settlementProtocol: record.settlementProtocol,
    createdAt: record.createdAt.toISOString(),
    price: pricingRule
      ? {
          pricingRuleId: pricingRule.id,
          amount: pricingRule.amount,
          asset: pricingRule.assetSymbol,
          decimals: pricingRule.assetDecimals,
          chainId: pricingRule.chainId,
        }
      : null,
  };
}

/**
 * Resolve `/v1/endpoints/:endpointId` to a scope the caller is entitled to.
 *
 * The same two-step shape as `resolveProjectAccess`: an opaque owner lookup
 * that returns only an organization ID, then the normal membership check. A
 * caller probing another tenant's endpoint ID gets the identical 404 they
 * would get for an ID that never existed.
 */
async function resolveEndpointAccess(
  db: Database,
  principal: UserPrincipal,
  endpointId: string,
): Promise<{ context: AuthorizationContext; scope: TenantScope; endpoint: EndpointRecord }> {
  const organizationId = await findEndpointOrganizationId(db, endpointId);
  if (!organizationId) {
    throw new Meter402Error('ENDPOINT_NOT_FOUND');
  }

  let access;
  try {
    access = await resolveOrganizationAccess(db, principal, organizationId);
  } catch (error) {
    if (error instanceof Meter402Error && error.code === 'ORGANIZATION_NOT_FOUND') {
      throw new Meter402Error('ENDPOINT_NOT_FOUND');
    }
    throw error;
  }

  const endpoint = await findEndpointInOrganization(db, access.scope, endpointId);
  /* istanbul ignore next -- the organization came from this endpoint. */
  if (!endpoint) {
    throw new Meter402Error('ENDPOINT_NOT_FOUND');
  }
  return { ...access, endpoint };
}

async function loadPricingRule(
  db: Database,
  scope: TenantScope,
  endpoint: EndpointRecord,
): Promise<PricingRuleRecord | null> {
  return endpoint.pricingRuleId ? findPricingRule(db, scope, endpoint.pricingRuleId) : null;
}

export function registerEndpointRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/v1/endpoints', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const body = parseBody(createEndpointSchema, request.body);

    // Membership is proven against the project's organization before anything
    // is written, and the scope comes from that membership.
    const { context, scope, project } = await resolveProjectAccess(
      deps.db,
      principal,
      body.projectId,
    );
    requirePermission(context, 'endpoints:write');

    /*
     * LIVE requires the project to have been switched into LIVE mode
     * deliberately. Without this a merchant could create a LIVE endpoint on a
     * project that has never been reviewed for real money.
     */
    if (body.environment === MerchantEnvironment.Live && !project.liveModeEnabled) {
      throw new Meter402Error(
        'CONFLICT',
        'LIVE mode is not enabled for this project. Enable it before creating LIVE endpoints.',
        { details: { projectId: project.id } },
      );
    }

    const chainId = chainIdForEnvironment(body.environment);
    const { endpoint, pricingRule } = await createEndpointWithPricing(
      deps.db,
      scope,
      { ...actorContext(request, principal.userId) },
      {
        projectId: project.id,
        name: body.name,
        description: body.description ?? null,
        path: body.path,
        method: body.method,
        environment: body.environment,
        price: body.price,
        settlementProtocol: body.settlementProtocol ?? 'test',
      },
      chainId,
    );

    void reply.status(201);
    return { data: serializeEndpoint(endpoint, pricingRule) };
  });

  app.get('/v1/endpoints', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const query = parseQuery(listQuerySchema, request.query);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, query.projectId);
    requirePermission(context, 'endpoints:read');

    const records = await listEndpointsInProject(deps.db, scope, query.projectId, {
      ...(query.environment ? { environment: query.environment } : {}),
    });

    const data = await Promise.all(
      records.map(async (record) =>
        serializeEndpoint(record, await loadPricingRule(deps.db, scope, record)),
      ),
    );
    return { data, hasMore: false, nextCursor: null };
  });

  app.get('/v1/endpoints/:endpointId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { endpointId } = parseParams(endpointParams, request.params);

    const { context, scope, endpoint } = await resolveEndpointAccess(
      deps.db,
      principal,
      endpointId,
    );
    requirePermission(context, 'endpoints:read');

    return { data: serializeEndpoint(endpoint, await loadPricingRule(deps.db, scope, endpoint)) };
  });

  app.patch('/v1/endpoints/:endpointId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { endpointId } = parseParams(endpointParams, request.params);
    const body = parseBody(updateEndpointSchema, request.body);

    const { context, scope, endpoint } = await resolveEndpointAccess(
      deps.db,
      principal,
      endpointId,
    );
    requirePermission(context, 'endpoints:write');

    const actor = actorContext(request, principal.userId);

    /*
     * Repricing is its own operation because it creates a new pricing rule
     * rather than editing one in place. Done first so that a request combining
     * a rename and a reprice ends with the endpoint pointing at the new rule.
     */
    let current = endpoint;
    if (body.price) {
      const repriced = await repriceEndpoint(deps.db, scope, actor, endpointId, body.price);
      current = repriced.endpoint;
    }

    const metadataPatch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.settlementProtocol !== undefined
        ? { settlementProtocol: body.settlementProtocol }
        : {}),
    };

    if (Object.keys(metadataPatch).length > 0) {
      const updated = await deps.db.transaction(async (tx) => {
        const row = await updateEndpoint(tx, scope, endpointId, metadataPatch);
        /* istanbul ignore next -- access was just resolved. */
        if (!row) {
          throw new Meter402Error('ENDPOINT_NOT_FOUND');
        }
        await recordAuditEvent(tx, {
          ...actor,
          organizationId: scope.organizationId,
          actorType: 'user',
          actorId: principal.userId,
          action: body.status === 'ARCHIVED' ? 'endpoint.archived' : 'endpoint.updated',
          resourceType: 'endpoint',
          resourceId: endpointId,
          metadata: metadataPatch,
        });
        return row;
      });
      current = updated;
    }

    return { data: serializeEndpoint(current, await loadPricingRule(deps.db, scope, current)) };
  });
}
