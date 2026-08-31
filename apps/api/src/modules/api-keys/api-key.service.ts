import { Meter402Error, type MerchantEnvironment } from '@meter402/shared';
import type { Database } from '@meter402/database';
import { parseScopes, type ApiKeyScope } from '@meter402/auth';
import { generateApiKey } from '../../lib/api-key.js';
import type { TenantScope } from '../../lib/tenant.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import { findProjectInOrganization } from '../projects/project.repository.js';
import {
  createApiKey,
  findApiKeyInOrganization,
  revokeApiKey,
  type ApiKeyRecord,
} from './api-key.repository.js';

/**
 * API key lifecycle.
 *
 * The plaintext secret exists in exactly one place in this file — the local
 * returned by `generateApiKey` — and travels only to the HTTP response. It is
 * never persisted, never logged, and never placed in audit metadata. The audit
 * events below construct their metadata field by field rather than spreading
 * the generated key, so a future field added to `GeneratedApiKey` cannot
 * silently start leaking into the audit log.
 */

export interface CreatedApiKey {
  readonly record: ApiKeyRecord;
  /** Returned to the caller exactly once. Never retrievable again. */
  readonly plaintextSecret: string;
}

export interface ApiKeyActor {
  readonly actorUserId: string;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreateApiKeyRequest {
  readonly projectId: string;
  readonly name: string;
  readonly environment: MerchantEnvironment;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date | null;
}

async function assertProjectUsable(
  db: Database,
  scope: TenantScope,
  projectId: string,
): Promise<void> {
  const project = await findProjectInOrganization(db, scope, projectId);
  if (!project) {
    // Also the cross-tenant case: a project in another organization is simply
    // not found here, so we never confirm it exists.
    throw new Meter402Error('PROJECT_NOT_FOUND');
  }
  if (project.status !== 'ACTIVE') {
    throw new Meter402Error(
      'CONFLICT',
      `Cannot mint credentials for a project that is ${project.status}.`,
      { details: { projectStatus: project.status } },
    );
  }
}

export async function issueApiKey(
  db: Database,
  scope: TenantScope,
  actor: ApiKeyActor,
  request: CreateApiKeyRequest,
  pepper: string,
): Promise<CreatedApiKey> {
  await assertProjectUsable(db, scope, request.projectId);
  const scopes: readonly ApiKeyScope[] = parseScopes(request.scopes);

  const generated = generateApiKey(request.environment, pepper);

  const record = await db.transaction(async (tx) => {
    const created = await createApiKey(tx, scope, {
      projectId: request.projectId,
      name: request.name.trim(),
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      lastFour: generated.lastFour,
      environment: request.environment,
      scopes,
      createdByUserId: actor.actorUserId,
      expiresAt: request.expiresAt ?? null,
    });

    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: actor.actorUserId,
      action: 'api_key.created',
      resourceType: 'api_key',
      resourceId: created.id,
      requestId: actor.requestId ?? null,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      // Explicit, non-secret fields only.
      metadata: {
        projectId: request.projectId,
        environment: request.environment,
        scopes: [...scopes],
        lastFour: created.lastFour,
      },
    });

    return created;
  });

  return { record, plaintextSecret: generated.secret };
}

/**
 * Rotate a key: mint a replacement and revoke the original, atomically.
 *
 * Both halves are in one transaction so there is no window in which either two
 * keys are live or none is. The replacement inherits the original's project,
 * environment, and scopes — rotation replaces a credential, it does not change
 * what that credential may do, and silently widening authority during a
 * routine rotation would be a poor surprise.
 *
 * The old key stops working immediately. That is the honest tradeoff for a
 * security operation: a rotation is usually a response to suspected exposure,
 * and an overlap window would leave the suspect credential live exactly when
 * it must not be. Callers that want zero downtime should create a second key,
 * deploy it, then revoke the first.
 */
export async function rotateApiKeyPair(
  db: Database,
  scope: TenantScope,
  actor: ApiKeyActor,
  apiKeyId: string,
  pepper: string,
): Promise<CreatedApiKey> {
  const existing = await findApiKeyInOrganization(db, scope, apiKeyId);
  if (!existing) {
    throw new Meter402Error('API_KEY_NOT_FOUND');
  }
  if (existing.status !== 'ACTIVE') {
    throw new Meter402Error(
      'CONFLICT',
      `Only an active key can be rotated; this one is ${existing.status}.`,
    );
  }

  const generated = generateApiKey(existing.environment, pepper);

  const record = await db.transaction(async (tx) => {
    const replacement = await createApiKey(tx, scope, {
      projectId: existing.projectId,
      name: existing.name,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      lastFour: generated.lastFour,
      environment: existing.environment,
      scopes: existing.scopes as readonly ApiKeyScope[],
      createdByUserId: actor.actorUserId,
      expiresAt: existing.expiresAt,
      rotatedFromKeyId: existing.id,
    });

    const revoked = await revokeApiKey(tx, scope, existing.id);
    if (!revoked) {
      // Another request revoked it between our read and this write. Abort
      // rather than leave a replacement for a key someone else just killed.
      throw new Meter402Error('CONFLICT', 'The key was revoked concurrently; rotation aborted.');
    }

    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: actor.actorUserId,
      action: 'api_key.rotated',
      resourceType: 'api_key',
      resourceId: replacement.id,
      requestId: actor.requestId ?? null,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: { rotatedFromKeyId: existing.id, projectId: existing.projectId },
    });

    return replacement;
  });

  return { record, plaintextSecret: generated.secret };
}

export async function revokeApiKeyById(
  db: Database,
  scope: TenantScope,
  actor: ApiKeyActor,
  apiKeyId: string,
): Promise<ApiKeyRecord> {
  return db.transaction(async (tx) => {
    const revoked = await revokeApiKey(tx, scope, apiKeyId);
    if (!revoked) {
      // Either it does not exist, belongs to another tenant, or was already
      // revoked. Deliberately indistinguishable.
      throw new Meter402Error('API_KEY_NOT_FOUND');
    }

    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: actor.actorUserId,
      action: 'api_key.revoked',
      resourceType: 'api_key',
      resourceId: revoked.id,
      requestId: actor.requestId ?? null,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: { projectId: revoked.projectId, lastFour: revoked.lastFour },
    });

    return revoked;
  });
}
