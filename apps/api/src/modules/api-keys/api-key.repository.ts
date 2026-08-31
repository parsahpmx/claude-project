import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { newId, type MerchantEnvironment } from '@meter402/shared';
import { apiKeys, organizations, projects } from '@meter402/database';
import type { ApiKeyScope } from '@meter402/auth';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

/**
 * API key persistence.
 *
 * Two properties are enforced structurally rather than by convention:
 *
 *  1. **The hash never leaves this module.** `API_KEY_COLUMNS` has no
 *     `keyHash` entry, so every read path is physically incapable of returning
 *     it. A future endpoint cannot leak the hash by accidentally spreading a
 *     record.
 *  2. **The plaintext secret is never written.** Nothing in this file accepts
 *     one except `createApiKey`, which takes an already-computed hash.
 */

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface ApiKeyRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly name: string;
  readonly prefix: string;
  readonly lastFour: string;
  readonly environment: MerchantEnvironment;
  readonly scopes: readonly string[];
  readonly status: ApiKeyStatus;
  readonly createdByUserId: string | null;
  readonly rotatedFromKeyId: string | null;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

/** Deliberately omits `keyHash`. Do not add it. */
const API_KEY_COLUMNS = {
  id: apiKeys.id,
  organizationId: apiKeys.organizationId,
  projectId: apiKeys.projectId,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  lastFour: apiKeys.lastFour,
  environment: apiKeys.environment,
  scopes: apiKeys.scopes,
  status: apiKeys.status,
  createdByUserId: apiKeys.createdByUserId,
  rotatedFromKeyId: apiKeys.rotatedFromKeyId,
  expiresAt: apiKeys.expiresAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
} as const;

export interface CreateApiKeyInput {
  readonly projectId: string;
  readonly name: string;
  readonly prefix: string;
  /** Already hashed by the caller. The plaintext must never reach this module. */
  readonly keyHash: string;
  readonly lastFour: string;
  readonly environment: MerchantEnvironment;
  readonly scopes: readonly ApiKeyScope[];
  readonly createdByUserId: string | null;
  readonly expiresAt?: Date | null;
  readonly rotatedFromKeyId?: string | null;
}

export async function createApiKey(
  executor: Executor,
  scope: TenantScope,
  input: CreateApiKeyInput,
): Promise<ApiKeyRecord> {
  const [row] = await executor
    .insert(apiKeys)
    .values({
      id: newId('apiKey'),
      organizationId: scope.organizationId,
      projectId: input.projectId,
      name: input.name,
      prefix: input.prefix,
      keyHash: input.keyHash,
      lastFour: input.lastFour,
      environment: input.environment,
      scopes: [...input.scopes],
      status: 'ACTIVE',
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt ?? null,
      rotatedFromKeyId: input.rotatedFromKeyId ?? null,
    })
    .returning(API_KEY_COLUMNS);

  /* istanbul ignore next */
  if (!row) {
    throw new Error('API key insert returned no row');
  }
  return row as ApiKeyRecord;
}

/**
 * The authentication lookup.
 *
 * A direct equality probe on the unique `key_hash` index. Not tenant-scoped —
 * this is the query that *establishes* the tenant, so there is no scope to
 * supply yet. It is safe precisely because the lookup key is a 256-bit HMAC
 * that only the holder of the secret can produce.
 *
 * Joins the organization and project so a single round trip can also reject a
 * key belonging to a suspended organization or an archived project.
 */
export interface AuthenticationCandidate {
  readonly key: ApiKeyRecord;
  readonly organizationStatus: string;
  readonly projectStatus: string;
}

export async function findApiKeyByHash(
  executor: Executor,
  keyHash: string,
): Promise<AuthenticationCandidate | null> {
  const [row] = await executor
    .select({
      ...API_KEY_COLUMNS,
      organizationStatus: organizations.status,
      projectStatus: projects.status,
    })
    .from(apiKeys)
    .innerJoin(organizations, eq(organizations.id, apiKeys.organizationId))
    .innerJoin(projects, eq(projects.id, apiKeys.projectId))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!row) {
    return null;
  }
  const { organizationStatus, projectStatus, ...key } = row;
  return { key: key as ApiKeyRecord, organizationStatus, projectStatus };
}

export async function listApiKeysInProject(
  executor: Executor,
  scope: TenantScope,
  projectId: string,
): Promise<readonly ApiKeyRecord[]> {
  const rows = await executor
    .select(API_KEY_COLUMNS)
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.organizationId, scope.organizationId)))
    .orderBy(desc(apiKeys.createdAt));

  return rows as ApiKeyRecord[];
}

export async function findApiKeyInOrganization(
  executor: Executor,
  scope: TenantScope,
  apiKeyId: string,
): Promise<ApiKeyRecord | null> {
  const [row] = await executor
    .select(API_KEY_COLUMNS)
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.organizationId, scope.organizationId)))
    .limit(1);

  return (row as ApiKeyRecord | undefined) ?? null;
}

/**
 * Revoke a key.
 *
 * Conditional on the key still being ACTIVE, so two concurrent revocations
 * cannot both report success and emit two audit events for one action. The
 * returned row is null when the key was already revoked or belongs to another
 * tenant — the caller cannot distinguish those, which is intentional.
 */
export async function revokeApiKey(
  executor: Executor,
  scope: TenantScope,
  apiKeyId: string,
): Promise<ApiKeyRecord | null> {
  const [row] = await executor
    .update(apiKeys)
    .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, apiKeyId),
        eq(apiKeys.organizationId, scope.organizationId),
        eq(apiKeys.status, 'ACTIVE'),
      ),
    )
    .returning(API_KEY_COLUMNS);

  return (row as ApiKeyRecord | undefined) ?? null;
}

/**
 * Record that a key was used.
 *
 * Throttled to at most one write per minute per key. Updating on every request
 * would turn a read-mostly authentication path into a write on the hottest row
 * in the table, and `last_used_at` is an operational convenience, not an audit
 * record — minute granularity is ample.
 */
export async function touchApiKeyLastUsed(
  executor: Executor,
  apiKeyId: string,
  now: Date = new Date(),
): Promise<void> {
  const threshold = new Date(now.getTime() - 60_000);
  await executor
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, apiKeyId),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, threshold)),
      ),
    );
}

/** Materialise EXPIRED for keys past their expiry. Reporting only. */
export async function markExpiredApiKeys(executor: Executor): Promise<number> {
  const rows = await executor
    .update(apiKeys)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(and(eq(apiKeys.status, 'ACTIVE'), lt(apiKeys.expiresAt, sql`now()`)))
    .returning({ id: apiKeys.id });

  return rows.length;
}
