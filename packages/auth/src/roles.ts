import { PERMISSIONS, type Permission } from './permissions.js';

/**
 * Roles.
 *
 * The single source of truth for what each role may do. Product rule 17
 * requires this to be centralised: string comparisons scattered through route
 * handlers are unreviewable, and the first one that gets the comparison
 * backwards is a privilege escalation nobody notices.
 */

export const ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'BILLING', 'VIEWER'] as const;

export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set<string>(ROLES);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

function permissionSet(...permissions: readonly Permission[]): ReadonlySet<Permission> {
  return Object.freeze(new Set(permissions)) as ReadonlySet<Permission>;
}

/** Everything a viewer can see. Every other role is a superset of this. */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  'organization:read',
  'members:read',
  'projects:read',
  'endpoints:read',
  'payments:read',
  'analytics:read',
];

/**
 * ROLE -> PERMISSIONS.
 *
 * Design intent per role:
 *
 *  OWNER      Full authority, including deleting the organization and managing
 *             billing. Only OWNER can delete the organization — that is
 *             irreversible and should require the highest level of trust.
 *  ADMIN      Runs the account day to day: members, projects, keys, webhooks.
 *             Deliberately cannot delete the organization or change billing
 *             arrangements; those are the two actions whose blast radius
 *             extends beyond the product.
 *  DEVELOPER  Builds the integration: projects, endpoints, API keys, webhooks.
 *             No authority over people or money.
 *  ANALYST    Reads operational data, including audit history. Changes nothing.
 *  BILLING    Finance contact. Sees the organization, payments, analytics and
 *             manages billing; has no engineering authority and cannot see
 *             members' details beyond the roster.
 *  VIEWER     Read-only.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = Object.freeze({
  OWNER: permissionSet(...PERMISSIONS),

  ADMIN: permissionSet(
    'organization:read',
    'organization:update',
    'members:read',
    'members:invite',
    'members:update_role',
    'members:remove',
    'projects:read',
    'projects:create',
    'projects:update',
    'projects:delete',
    'api_keys:read',
    'api_keys:create',
    'api_keys:rotate',
    'api_keys:revoke',
    'endpoints:read',
    'endpoints:write',
    'settlement:read',
    'settlement:write',
    'payments:read',
    'analytics:read',
    'webhooks:read',
    'webhooks:write',
    'billing:read',
    'audit:read',
  ),

  DEVELOPER: permissionSet(
    'organization:read',
    'members:read',
    'projects:read',
    'projects:create',
    'projects:update',
    'api_keys:read',
    'api_keys:create',
    'api_keys:rotate',
    'api_keys:revoke',
    'endpoints:read',
    'endpoints:write',
    'payments:read',
    'analytics:read',
    // Read, deliberately not write. A developer configures endpoints and
    // rotates keys; deciding where revenue lands is an owner's call.
    'settlement:read',
    'webhooks:read',
    'webhooks:write',
  ),

  ANALYST: permissionSet(...VIEWER_PERMISSIONS, 'webhooks:read', 'audit:read'),

  BILLING: permissionSet(
    'organization:read',
    'payments:read',
    'analytics:read',
    'billing:read',
    'billing:manage',
    'settlement:read',
  ),

  VIEWER: permissionSet(...VIEWER_PERMISSIONS),
});

export function permissionsForRole(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}
