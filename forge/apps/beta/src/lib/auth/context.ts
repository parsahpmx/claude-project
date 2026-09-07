import { cache } from 'react';
import {
  ANONYMOUS,
  type AuthContext,
  type OrgRole,
  type Permission,
  type PermissionScope,
  type PlatformRole,
  can,
} from '@forge/contracts';
import { createClient } from '../supabase/server';

/**
 * Resolving who the caller is and what they may do, once per request.
 *
 * `cache()` deduplicates this within a single render, so a layout and three
 * server components asking the same question cost one round trip rather than
 * four.
 *
 * Every read here runs under the caller's own session, so RLS applies. That is
 * deliberate and load-bearing: `platform_role_assignments` is readable only to
 * people who already hold a platform role, which means an ordinary user asking
 * "am I an admin" gets zero rows and the honest answer, without the app ever
 * needing a service-role key to find out.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    // Supabase unreachable. Fail closed — an outage must not hand out
    // permissions, and the middleware already routes people to sign-in.
    return ANONYMOUS;
  }
  if (!userId) return ANONYMOUS;

  const [memberships, platform, clients] = await Promise.all([
    supabase.from('organization_members').select('organization_id, role').eq('user_id', userId),
    supabase.from('platform_role_assignments').select('role').eq('user_id', userId),
    supabase
      .from('coach_clients')
      .select('client_id')
      .eq('coach_id', userId)
      .eq('status', 'active'),
  ]);

  const organizations: Record<string, OrgRole[]> = {};
  for (const row of memberships.data ?? []) {
    const orgId = row.organization_id as string;
    (organizations[orgId] ??= []).push(row.role as OrgRole);
  }

  return {
    userId,
    platformRoles: (platform.data ?? []).map((r) => r.role as PlatformRole),
    organizations,
    coachOf: (clients.data ?? []).map((r) => r.client_id as string),
  };
});

/** Non-throwing check, for deciding what to render. */
export async function hasPermission(
  permission: Permission,
  scope: PermissionScope = {},
): Promise<boolean> {
  return can(await getAuthContext(), permission, scope);
}

/**
 * Thrown when a signed-in caller lacks a permission.
 *
 * A distinct error type rather than a bare `Error` so a route can tell "denied"
 * apart from "something broke" and respond differently — the first is a normal
 * outcome, the second is a bug.
 */
export class PermissionDeniedError extends Error {
  readonly permission: Permission;
  readonly scope: PermissionScope;

  constructor(permission: Permission, scope: PermissionScope) {
    super(`Permission denied: ${permission}`);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
    this.scope = scope;
  }
}

/**
 * Enforce a permission at a server entry point — a Server Component, a Server
 * Action, or a route handler.
 *
 * Hiding a button is a usability courtesy; this is the security boundary, and
 * RLS behind it is the last one. Anything that mutates or reads scoped data
 * calls this, never `ctx.organizations[...]` directly, because a check spelled
 * out by hand at each call site is a check that will eventually be spelled
 * wrong.
 */
export async function requirePermission(
  permission: Permission,
  scope: PermissionScope = {},
): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!can(ctx, permission, scope)) {
    throw new PermissionDeniedError(permission, scope);
  }
  return ctx;
}

/**
 * Require membership of an organization named by the *caller* — a route
 * parameter, a form field.
 *
 * The IDOR shape this exists to prevent is reading an id out of the URL and
 * trusting it. Passing it through here means an id the caller does not belong
 * to is refused before it reaches a query.
 */
export async function requireOrgPermission(
  organizationId: string,
  permission: Permission,
): Promise<AuthContext> {
  return requirePermission(permission, { organizationId });
}
