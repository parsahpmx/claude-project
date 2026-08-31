import type { AuthorizationContext, ApiKeyPrincipal } from '@meter402/auth';

/**
 * Tenant scope.
 *
 * This is the type that makes tenant isolation structural rather than
 * remembered. Every repository function that touches a tenant-owned table
 * requires a `TenantScope` as its first argument, and the brand means one
 * cannot be produced by writing an object literal — it comes only from the two
 * constructors below, both of which take an already-authenticated principal
 * whose organization was established from the database.
 *
 * The consequence: a route handler cannot query a tenant-owned table without
 * an organization the caller has proven membership of. Forgetting the check is
 * not possible, because there is nothing to forget — the argument is required,
 * and the only way to get one is to have authenticated.
 *
 * A handler that wanted to bypass this would have to cast, which is visible in
 * review in a way that a missing WHERE clause is not.
 */

declare const tenantScopeBrand: unique symbol;

export interface TenantScope {
  readonly organizationId: string;
  readonly [tenantScopeBrand]: 'TenantScope';
}

function brand(organizationId: string): TenantScope {
  return { organizationId } as TenantScope;
}

/**
 * Scope from a human's authorization context.
 *
 * The organization comes from the membership row, never from the request. A
 * caller can ask about any organization ID they like; what they get scoped to
 * is the one they are actually a member of.
 */
export function scopeFromContext(context: AuthorizationContext): TenantScope {
  return brand(context.organizationId);
}

/** Scope from a machine credential. The key itself names its organization. */
export function scopeFromApiKey(principal: ApiKeyPrincipal): TenantScope {
  return brand(principal.organizationId);
}
