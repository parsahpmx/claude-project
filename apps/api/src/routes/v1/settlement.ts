import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findAsset, findChainById, Meter402Error } from '@meter402/shared';
import { requirePermission } from '@meter402/auth';
import { requireUserPrincipal, resolveOrganizationAccess } from '../../auth/authenticate.js';
import { actorContext, getPrincipal, type RouteDeps } from '../context.js';
import { parseBody, parseParams, requiredSettlementAddressSchema } from '../../lib/validation.js';
import { recordAuditEvent } from '../../modules/audit/audit.repository.js';
import {
  listSettlementConfigurations,
  setSettlementConfigurationStatus,
  upsertSettlementConfiguration,
  type SettlementConfigRecord,
} from '../../modules/settlement/settlement.repository.js';
import { findProjectInOrganization } from '../../modules/projects/project.repository.js';

/**
 * Settlement destinations — the money-routing surface.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * These routes are **user-session only**, and that is the security property
 * they exist to provide.
 *
 * `requireUserPrincipal` throws for an API key before any handler logic runs.
 * It is not a convenience for narrowing a type: an API key that could repoint
 * settlement would turn a leaked machine credential into a permanent theft of
 * all future revenue — categorically worse than the same key spending its own
 * balance, and not something a scope should be able to grant. There is
 * therefore no `settlement:write` API-key scope at all; the capability does
 * not exist for machines, so it cannot be granted to one by mistake.
 *
 * On top of that, `settlement:write` is held only by OWNER and ADMIN. A
 * DEVELOPER — who can create endpoints, set prices, and mint API keys — can
 * read settlement configuration and cannot change it.
 * ─────────────────────────────────────────────────────────────────────────
 */

const organizationParams = z.object({ organizationId: z.string().min(1).max(64) });
const configParams = organizationParams.extend({
  settlementConfigId: z.string().min(1).max(64),
});

const upsertSchema = z.object({
  /** Null or absent means the organization-wide default for this chain/asset. */
  projectId: z.string().min(1).max(64).nullable().optional(),
  chainId: z.number().int().positive(),
  asset: z.string().trim().min(2).max(12),
  /*
   * Validated and lowercased at the boundary. This is the column that decides
   * where revenue lands, so a malformed value is refused where it is written
   * rather than discovered at payment time.
   */
  recipientAddress: requiredSettlementAddressSchema,
});

const statusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });

function serialize(record: SettlementConfigRecord) {
  const chain = findChainById(record.chainId);
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    chainId: record.chainId,
    network: chain ? `eip155:${chain.id}` : null,
    networkName: chain?.name ?? null,
    isTestnet: chain?.isTestnet ?? null,
    asset: record.assetSymbol,
    recipientAddress: record.recipientAddress,
    status: record.status,
    createdByUserId: record.createdByUserId,
    updatedByUserId: record.updatedByUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function registerSettlementRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/v1/organizations/:organizationId/settlement', async (request) => {
    // Throws for an API key before anything else happens.
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId } = parseParams(organizationParams, request.params);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'settlement:read');

    const rows = await listSettlementConfigurations(deps.db, scope);
    return { data: rows.map(serialize), hasMore: false, nextCursor: null };
  });

  app.put('/v1/organizations/:organizationId/settlement', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId } = parseParams(organizationParams, request.params);
    const body = parseBody(upsertSchema, request.body);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'settlement:write');

    /*
     * The chain must be one this server knows. Accepting an arbitrary chain ID
     * would let a merchant configure a destination for a network Meter402
     * cannot verify anything on.
     */
    const chain = findChainById(body.chainId);
    if (!chain) {
      throw new Meter402Error('VALIDATION_FAILED', `Chain ${body.chainId} is not supported.`, {
        details: { chainId: body.chainId },
      });
    }

    const asset = findAsset(body.asset, body.chainId);
    if (!asset) {
      throw new Meter402Error(
        'VALIDATION_FAILED',
        `Asset ${body.asset} is not supported on ${chain.name}.`,
        { details: { asset: body.asset, chainId: body.chainId } },
      );
    }

    // A project-scoped destination must name a project in *this* organization.
    const projectId = body.projectId ?? null;
    if (projectId !== null) {
      const project = await findProjectInOrganization(deps.db, scope, projectId);
      if (!project) {
        throw new Meter402Error('PROJECT_NOT_FOUND');
      }
    }

    const actor = actorContext(request, principal.userId);
    const record = await deps.db.transaction(async (tx) => {
      const existing = await upsertSettlementConfiguration(tx, scope, {
        projectId,
        chainId: body.chainId,
        assetSymbol: asset.symbol,
        recipientAddress: body.recipientAddress,
        actorUserId: principal.userId,
      });

      /*
       * Audited in the same transaction as the change. "Who repointed our
       * revenue, and when" must never be answerable only by inference — and a
       * change that committed without its audit event would make it so.
       */
      await recordAuditEvent(tx, {
        ...actor,
        organizationId: scope.organizationId,
        actorType: 'user',
        actorId: principal.userId,
        action:
          existing.updatedByUserId === null
            ? 'settlement_config.created'
            : 'settlement_config.updated',
        resourceType: 'settlement_configuration',
        resourceId: existing.id,
        metadata: {
          projectId,
          chainId: body.chainId,
          network: `eip155:${chain.id}`,
          asset: asset.symbol,
          recipientAddress: existing.recipientAddress,
          isTestnet: chain.isTestnet,
        },
      });

      return existing;
    });

    void reply.status(200);
    return { data: serialize(record) };
  });

  app.patch('/v1/organizations/:organizationId/settlement/:settlementConfigId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId, settlementConfigId } = parseParams(configParams, request.params);
    const body = parseBody(statusSchema, request.body);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'settlement:write');

    const actor = actorContext(request, principal.userId);
    const updated = await deps.db.transaction(async (tx) => {
      const record = await setSettlementConfigurationStatus(
        tx,
        scope,
        settlementConfigId,
        body.status,
        principal.userId,
      );
      if (!record) {
        throw new Meter402Error('RESOURCE_NOT_FOUND', 'No such settlement configuration.');
      }
      await recordAuditEvent(tx, {
        ...actor,
        organizationId: scope.organizationId,
        actorType: 'user',
        actorId: principal.userId,
        action:
          body.status === 'DISABLED' ? 'settlement_config.disabled' : 'settlement_config.updated',
        resourceType: 'settlement_configuration',
        resourceId: record.id,
        metadata: { status: body.status },
      });
      return record;
    });

    return { data: serialize(updated) };
  });
}
