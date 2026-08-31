/**
 * Permissions.
 *
 * A permission is the unit of authority a human role can hold. The set is a
 * closed vocabulary declared once here, so a route cannot invent authority by
 * inventing a string, and so the full surface of what any role can do is
 * readable on one screen during a security review.
 *
 * Naming is `<resource>:<action>`. Read and write are separated everywhere
 * because the interesting boundary in a merchant account is almost always
 * "can look" versus "can change".
 */

export const PERMISSIONS = [
  // The organization itself
  'organization:read',
  'organization:update',
  'organization:delete',

  // Membership management. Split finely because inviting a colleague and
  // promoting them to OWNER are very different levels of trust.
  'members:read',
  'members:invite',
  'members:update_role',
  'members:remove',

  'projects:read',
  'projects:create',
  'projects:update',
  'projects:delete',

  // API keys are credentials. Creating one mints authority, so it is separated
  // from merely listing them.
  'api_keys:read',
  'api_keys:create',
  'api_keys:rotate',
  'api_keys:revoke',

  'endpoints:read',
  'endpoints:write',

  'payments:read',
  'analytics:read',

  'webhooks:read',
  'webhooks:write',

  'billing:read',
  'billing:manage',

  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
