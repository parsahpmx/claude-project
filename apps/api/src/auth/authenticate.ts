import { Meter402Error, type MerchantEnvironment } from '@meter402/shared';
import type { Database } from '@meter402/database';
import {
  buildAuthorizationContext,
  isApiKeyScope,
  type ApiKeyPrincipal,
  type AuthorizationContext,
  type ApiKeyScope,
  type Principal,
  type UserPrincipal,
} from '@meter402/auth';
import { extractBearerToken, hashApiKey, parseApiKey } from '../lib/api-key.js';
import { findMembership } from '../modules/identity/membership.repository.js';
import { findUserById } from '../modules/identity/user.repository.js';
import { findApiKeyByHash, touchApiKeyLastUsed } from '../modules/api-keys/api-key.repository.js';
import type { SessionIssuer } from './session.js';
import { scopeFromContext, type TenantScope } from '../lib/tenant.js';

export interface AuthenticationDeps {
  readonly db: Database;
  readonly sessionIssuer: SessionIssuer;
  readonly apiKeyPepper: string;
}

/**
 * Resolve the caller into a principal.
 *
 * The credential's own shape selects the mechanism: anything matching the
 * `meter_test_`/`meter_live_` format is an API key, everything else is treated
 * as a session token. That is a format check, not a trust decision — both
 * paths verify cryptographically before returning anything.
 *
 * On error disclosure. A credential that does not verify always yields
 * INVALID_API_KEY / INVALID_CREDENTIALS, so probing cannot distinguish "no
 * such key" from "wrong secret". The more specific API_KEY_REVOKED and
 * API_KEY_EXPIRED are returned only after the presented secret has produced a
 * matching 256-bit HMAC — that is, only to someone who already holds the key.
 * Telling a legitimate holder why their key stopped working is useful; telling
 * an attacker that a guess was close is not, and this ordering does the first
 * without the second.
 */
export async function authenticate(
  deps: AuthenticationDeps,
  authorizationHeader: string | undefined,
): Promise<Principal> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new Meter402Error('AUTHENTICATION_REQUIRED');
  }

  const parsed = parseApiKey(token);
  if (parsed) {
    return authenticateApiKey(deps, token);
  }
  return authenticateSession(deps, token);
}

async function authenticateSession(
  deps: AuthenticationDeps,
  token: string,
): Promise<UserPrincipal> {
  const verified = deps.sessionIssuer.verify(token);
  if (!verified) {
    throw new Meter402Error('INVALID_CREDENTIALS');
  }

  // The token asserts an identity; the database decides whether that identity
  // may still act. A disabled user's unexpired token must not work.
  const user = await findUserById(deps.db, verified.userId);
  if (!user || user.status === 'DISABLED') {
    throw new Meter402Error('INVALID_CREDENTIALS');
  }

  return { type: 'user', userId: user.id };
}

async function authenticateApiKey(
  deps: AuthenticationDeps,
  token: string,
): Promise<ApiKeyPrincipal> {
  // A direct probe on the unique key_hash index. The presented secret is the
  // only thing that can produce this value.
  const candidate = await findApiKeyByHash(deps.db, hashApiKey(token, deps.apiKeyPepper));
  if (!candidate) {
    throw new Meter402Error('INVALID_API_KEY');
  }

  const { key, organizationStatus, projectStatus } = candidate;

  if (key.status === 'REVOKED') {
    throw new Meter402Error('API_KEY_REVOKED');
  }

  /*
   * Expiry is computed from `expires_at` on every request rather than trusting
   * the materialised status column. The sweeper that sets EXPIRED runs
   * periodically, so a key can be past its expiry while still marked ACTIVE;
   * relying on the column alone would keep it working until the sweep.
   */
  if (key.expiresAt !== null && key.expiresAt.getTime() <= Date.now()) {
    throw new Meter402Error('API_KEY_EXPIRED');
  }
  if (key.status === 'EXPIRED') {
    throw new Meter402Error('API_KEY_EXPIRED');
  }

  if (organizationStatus !== 'ACTIVE') {
    throw new Meter402Error('PERMISSION_DENIED', 'This organization is not active.');
  }
  if (projectStatus !== 'ACTIVE') {
    throw new Meter402Error('PERMISSION_DENIED', 'This project is not active.');
  }

  // Best-effort and throttled; never allowed to fail a request.
  void touchApiKeyLastUsed(deps.db, key.id).catch(() => {});

  return {
    type: 'api_key',
    apiKeyId: key.id,
    organizationId: key.organizationId,
    projectId: key.projectId,
    environment: key.environment as MerchantEnvironment,
    // Filter rather than cast: a scope removed from the vocabulary in a later
    // release must stop granting authority, not survive in old rows.
    scopes: key.scopes.filter((scope): scope is ApiKeyScope => isApiKeyScope(scope)),
  };
}

/** Narrow to a human principal, rejecting a machine credential. */
export function requireUserPrincipal(principal: Principal): UserPrincipal {
  if (principal.type !== 'user') {
    throw new Meter402Error(
      'PERMISSION_DENIED',
      'This endpoint requires a user session; an API key cannot be used.',
    );
  }
  return principal;
}

/** Narrow to a machine principal, rejecting a human session. */
export function requireApiKeyPrincipal(principal: Principal): ApiKeyPrincipal {
  if (principal.type !== 'api_key') {
    throw new Meter402Error('PERMISSION_DENIED', 'This endpoint requires an API key.');
  }
  return principal;
}

/**
 * Establish the caller's authority within a specific organization.
 *
 * This is the single gate every organization-scoped route passes through, and
 * the only place a `TenantScope` is minted for a human.
 *
 * A user with no membership row gets ORGANIZATION_NOT_FOUND, not
 * PERMISSION_DENIED. 403 would confirm the organization exists, which is
 * exactly the disclosure a cross-tenant probe is looking for. A user who *is*
 * a member but whose membership is suspended gets 403 — they already know the
 * organization exists, so there is nothing left to protect.
 */
export async function resolveOrganizationAccess(
  db: Database,
  principal: UserPrincipal,
  organizationId: string,
): Promise<{ context: AuthorizationContext; scope: TenantScope }> {
  const membership = await findMembership(db, principal.userId, organizationId);
  if (!membership) {
    throw new Meter402Error('ORGANIZATION_NOT_FOUND');
  }

  const context = buildAuthorizationContext(principal, membership);
  return { context, scope: scopeFromContext(context) };
}
