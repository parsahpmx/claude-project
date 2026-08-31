import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MerchantEnvironment } from '@meter402/shared';
import { API_KEY_SCOPES, requirePermission } from '@meter402/auth';
import { requireUserPrincipal } from '../../auth/authenticate.js';
import { actorContext, getPrincipal, type RouteDeps } from '../context.js';
import { resolveProjectAccess } from './projects.js';
import {
  listApiKeysInProject,
  type ApiKeyRecord,
} from '../../modules/api-keys/api-key.repository.js';
import {
  issueApiKey,
  revokeApiKeyById,
  rotateApiKeyPair,
} from '../../modules/api-keys/api-key.service.js';
import { parseBody, parseParams } from '../../lib/validation.js';

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  environment: z.enum(['TEST', 'LIVE']),
  scopes: z.array(z.enum(API_KEY_SCOPES)).max(API_KEY_SCOPES.length).optional(),
  /** ISO 8601. Optional; a key with no expiry lives until revoked. */
  expiresAt: z.string().datetime().optional(),
});

const projectParams = z.object({ projectId: z.string().min(1).max(64) });
const keyParams = projectParams.extend({ apiKeyId: z.string().min(1).max(64) });

/**
 * The list/metadata shape.
 *
 * There is no `keyHash` and no `secret` field, and the repository physically
 * cannot supply one — `API_KEY_COLUMNS` omits the hash. `maskedKey` is built
 * from the prefix and the stored last four characters, never by reconstructing
 * anything.
 */
function serializeApiKey(record: ApiKeyRecord) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    name: record.name,
    maskedKey: `${record.prefix}_...${record.lastFour}`,
    environment: record.environment,
    scopes: record.scopes,
    status: record.status,
    createdByUserId: record.createdByUserId,
    rotatedFromKeyId: record.rotatedFromKeyId,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function registerApiKeyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  /**
   * Mint a key. The plaintext secret appears in this response and nowhere else
   * — not in the database, not in logs, not in the audit event.
   */
  app.post('/v1/projects/:projectId/api-keys', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId } = parseParams(projectParams, request.params);
    const body = parseBody(createKeySchema, request.body);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'api_keys:create');

    const created = await issueApiKey(
      deps.db,
      scope,
      actorContext(request, principal.userId),
      {
        projectId,
        name: body.name,
        environment:
          body.environment === 'LIVE' ? MerchantEnvironment.Live : MerchantEnvironment.Test,
        scopes: body.scopes ?? [],
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      deps.config.secrets.apiKeyHashPepper,
    );

    void reply.status(201);
    // `secret` is present on creation only. Every other endpoint omits it.
    return {
      data: {
        ...serializeApiKey(created.record),
        secret: created.plaintextSecret,
        secretNote: 'Store this now. It cannot be retrieved again.',
      },
    };
  });

  app.get('/v1/projects/:projectId/api-keys', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId } = parseParams(projectParams, request.params);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'api_keys:read');

    const keys = await listApiKeysInProject(deps.db, scope, projectId);
    return { data: keys.map(serializeApiKey), hasMore: false, nextCursor: null };
  });

  app.post('/v1/projects/:projectId/api-keys/:apiKeyId/rotate', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId, apiKeyId } = parseParams(keyParams, request.params);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'api_keys:rotate');

    const rotated = await rotateApiKeyPair(
      deps.db,
      scope,
      actorContext(request, principal.userId),
      apiKeyId,
      deps.config.secrets.apiKeyHashPepper,
    );

    void reply.status(201);
    return {
      data: {
        ...serializeApiKey(rotated.record),
        secret: rotated.plaintextSecret,
        secretNote: 'Store this now. The previous key is revoked and cannot be restored.',
      },
    };
  });

  app.delete('/v1/projects/:projectId/api-keys/:apiKeyId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId, apiKeyId } = parseParams(keyParams, request.params);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'api_keys:revoke');

    const revoked = await revokeApiKeyById(
      deps.db,
      scope,
      actorContext(request, principal.userId),
      apiKeyId,
    );

    return { data: serializeApiKey(revoked) };
  });
}
