import { Meter402Error } from '@meter402/shared';
import type { Permission } from './permissions.js';
import { permissionsForRole, type Role } from './roles.js';
import type { Membership, UserPrincipal } from './principal.js';

/**
 * Authorization context.
 *
 * Built once per request, after the membership has been loaded from the
 * database. Everything a handler needs to make an access decision lives here,
 * and nothing in it comes from the request body — the organization ID is the
 * one the membership proves the caller belongs to, not one they asked for.
 */
export interface AuthorizationContext {
  readonly principal: UserPrincipal;
  readonly membership: Membership;
  readonly organizationId: string;
  readonly role: Role;
  readonly permissions: ReadonlySet<Permission>;
}

/**
 * Turn a loaded membership into an authorization context.
 *
 * Fails closed on three conditions, each of which would otherwise be a way to
 * act with authority the caller does not hold:
 *
 *  1. The membership belongs to a different user. This should be impossible
 *     given how memberships are loaded, but a mismatch here means something
 *     upstream is confused about identity, and continuing would attach one
 *     user's authority to another's session.
 *  2. The membership is not ACTIVE. An INVITED member has not accepted;
 *     SUSPENDED and REMOVED members have had authority withdrawn. None of them
 *     may act.
 *  3. The role is not one we recognise, which can only happen if the database
 *     holds a value the application does not know about.
 */
export function buildAuthorizationContext(
  principal: UserPrincipal,
  membership: Membership,
): AuthorizationContext {
  if (membership.userId !== principal.userId) {
    throw new Meter402Error(
      'PERMISSION_DENIED',
      'The membership does not belong to the authenticated user.',
    );
  }

  if (membership.status !== 'ACTIVE') {
    throw new Meter402Error(
      'MEMBERSHIP_INACTIVE',
      `Your membership of this organization is ${membership.status} and cannot perform actions.`,
      { details: { status: membership.status } },
    );
  }

  const permissions = permissionsForRole(membership.role);
  /* istanbul ignore next -- the role column is a database enum. */
  if (!permissions) {
    throw new Meter402Error('INTERNAL_ERROR', 'Unrecognised membership role.');
  }

  return {
    principal,
    membership,
    organizationId: membership.organizationId,
    role: membership.role,
    permissions,
  };
}

export function hasPermission(context: AuthorizationContext, permission: Permission): boolean {
  return context.permissions.has(permission);
}

/**
 * Enforce a permission.
 *
 * Throws rather than returning a boolean, so that forgetting to check the
 * result is not a silent authorization bypass. A handler that calls this and
 * ignores the outcome does not compile into working code — the exception
 * unwinds.
 */
export function requirePermission(context: AuthorizationContext, permission: Permission): void {
  if (!hasPermission(context, permission)) {
    throw new Meter402Error(
      'PERMISSION_DENIED',
      `Your role (${context.role}) does not permit ${permission}.`,
      { details: { requiredPermission: permission, role: context.role } },
    );
  }
}

export function requireAnyPermission(
  context: AuthorizationContext,
  permissions: readonly Permission[],
): void {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new Meter402Error(
      'PERMISSION_DENIED',
      `Your role (${context.role}) does not permit any of: ${permissions.join(', ')}.`,
      { details: { requiredAnyOf: [...permissions], role: context.role } },
    );
  }
}
