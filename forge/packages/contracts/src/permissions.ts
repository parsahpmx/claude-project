/**
 * The permission model.
 *
 * Authorization answers "may this person do this here", which is a different
 * question from "is this person signed in". It is kept here, in a package both
 * the web app and any future admin or mobile client import, so there is exactly
 * one definition of what `gym.member.manage` means.
 *
 * Two rules this file exists to enforce:
 *
 *   - **No `user.role === 'admin'` anywhere.** Callers ask `can(ctx, permission,
 *     scope)`. Roles are an implementation detail of that answer, so adding a
 *     role or moving a permission between roles is one edit here rather than a
 *     search across components.
 *
 *   - **Roles are always scoped.** A person is commonly a member of one gym,
 *     a coach to some athletes, and staff at another gym. There is deliberately
 *     no global role: every org permission requires an `organizationId`, and
 *     holding a role in one organization says nothing about any other.
 *
 * This is the policy half only — pure, synchronous, no I/O, so it can be
 * exhaustively tested. Loading a person's roles from the database and enforcing
 * the answer lives in the app. And none of this replaces RLS: the database is
 * the last line, this is the first.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Roles held *within one organization*. Mirrors the `org_role` enum. */
export const ORG_ROLES = ['gym_owner', 'gym_manager', 'gym_staff', 'coach', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Platform-wide operational roles. Mirrors the `platform_role` enum. */
export const PLATFORM_ROLES = ['platform_admin', 'super_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Every permission the platform recognises. Deliberately small: this is the set
 * needed to build coach, gym and admin surfaces safely, not a guess at every
 * permission the product will ever want. Adding one is a single edit here plus
 * the role mapping below.
 */
export const PERMISSIONS = [
  // A person's own data. Granted to any signed-in user, scoped to themselves.
  'profile.read.self',
  'profile.update.self',
  'activity.read.self',
  'activity.write.self',

  // A coach acting on an athlete they have an accepted relationship with.
  'client.read',
  'client.program.manage',

  // Operating a gym, always within one organization.
  'gym.member.read',
  'gym.member.manage',
  'gym.class.manage',
  'gym.staff.manage',
  'gym.access.manage',
  'organization.settings.manage',

  // Platform operations.
  'platform.user.read',
  'platform.user.suspend',
  'platform.audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions any authenticated person holds over their own records. */
const SELF_PERMISSIONS = [
  'profile.read.self',
  'profile.update.self',
  'activity.read.self',
  'activity.write.self',
] as const satisfies readonly Permission[];

/**
 * Permissions that come from an accepted coach–client relationship rather than
 * from any role. A coach with no relationship to an athlete is, as far as that
 * athlete's data is concerned, a stranger.
 */
const COACH_RELATIONSHIP_PERMISSIONS = [
  'client.read',
  'client.program.manage',
] as const satisfies readonly Permission[];

/**
 * What each organization role grants *inside that organization*.
 *
 * `member` grants nothing operational on purpose — being a gym's member is not
 * a licence to read the membership list. Managers may run the gym but not
 * change what the organization itself is; only an owner may do that, which
 * matches the database policy that stops a manager minting an owner.
 */
export const ORG_ROLE_PERMISSIONS: Readonly<Record<OrgRole, readonly Permission[]>> = {
  member: [],
  coach: ['gym.member.read'],
  gym_staff: ['gym.member.read'],
  gym_manager: ['gym.member.read', 'gym.member.manage', 'gym.class.manage', 'gym.staff.manage'],
  gym_owner: [
    'gym.member.read',
    'gym.member.manage',
    'gym.class.manage',
    'gym.staff.manage',
    'gym.access.manage',
    'organization.settings.manage',
  ],
};

/**
 * What each platform role grants. `super_admin` is a strict superset of
 * `platform_admin`; suspending an account is the one action reserved to it.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<Record<PlatformRole, readonly Permission[]>> = {
  platform_admin: ['platform.user.read', 'platform.audit.read'],
  super_admin: ['platform.user.read', 'platform.audit.read', 'platform.user.suspend'],
};

// ---------------------------------------------------------------------------
// Context and the decision
// ---------------------------------------------------------------------------

/**
 * Everything needed to answer an authorization question, resolved once per
 * request. `organizations` maps an organization id to the roles held there, so
 * a permission check never has to ask "which org?" separately from "which role?".
 */
export interface AuthContext {
  /** `null` for an anonymous visitor, who holds no permissions at all. */
  readonly userId: string | null;
  readonly platformRoles: readonly PlatformRole[];
  readonly organizations: Readonly<Record<string, readonly OrgRole[]>>;
  /** Athlete ids this person coaches under an **accepted** relationship. */
  readonly coachOf: readonly string[];
}

/** An anonymous context. Useful as a safe default. */
export const ANONYMOUS: AuthContext = {
  userId: null,
  platformRoles: [],
  organizations: {},
  coachOf: [],
};

/**
 * Where the question is being asked.
 *
 * `organizationId` is required for every `gym.*` and `organization.*`
 * permission — a check without it is refused rather than assumed, because
 * "may they manage members" is meaningless without saying whose.
 *
 * `userId` names the subject for `*.self` and `client.*` permissions.
 */
export interface PermissionScope {
  readonly organizationId?: string;
  readonly userId?: string;
}

function isOrgScoped(permission: Permission): boolean {
  return permission.startsWith('gym.') || permission.startsWith('organization.');
}

function isPlatformScoped(permission: Permission): boolean {
  return permission.startsWith('platform.');
}

function isSelfScoped(permission: Permission): boolean {
  return permission.endsWith('.self');
}

function isClientScoped(permission: Permission): boolean {
  return permission.startsWith('client.');
}

/**
 * The one authorization decision in the platform.
 *
 * Returns false for anything it cannot positively justify — an unknown
 * permission, a missing scope, an anonymous caller — so a mistake denies rather
 * than admits.
 */
export function can(
  ctx: AuthContext,
  permission: Permission,
  scope: PermissionScope = {},
): boolean {
  // Anonymous visitors hold nothing. Every surface behind this is server-side.
  if (!ctx.userId) return false;

  // Guard against a permission string that is not in the model at all, which
  // in JavaScript can arrive from an untyped caller.
  if (!(PERMISSIONS as readonly string[]).includes(permission)) return false;

  if (isSelfScoped(permission)) {
    // Naming a subject other than yourself is not a self permission.
    if (scope.userId !== undefined && scope.userId !== ctx.userId) return false;
    return (SELF_PERMISSIONS as readonly Permission[]).includes(permission);
  }

  if (isClientScoped(permission)) {
    const client = scope.userId;
    if (!client) return false;
    if (!ctx.coachOf.includes(client)) return false;
    return (COACH_RELATIONSHIP_PERMISSIONS as readonly Permission[]).includes(permission);
  }

  if (isPlatformScoped(permission)) {
    return ctx.platformRoles.some((role) => PLATFORM_ROLE_PERMISSIONS[role]?.includes(permission));
  }

  if (isOrgScoped(permission)) {
    const org = scope.organizationId;
    // Refusing an unscoped org check is what stops a caller reading a gym id
    // out of a URL and having it silently treated as "any gym".
    if (!org) return false;
    const roles = ctx.organizations[org];
    if (!roles || roles.length === 0) return false;
    return roles.some((role) => ORG_ROLE_PERMISSIONS[role]?.includes(permission));
  }

  return false;
}

/** Every permission this context holds in one organization. For building UI. */
export function permissionsInOrg(ctx: AuthContext, organizationId: string): Permission[] {
  const roles = ctx.organizations[organizationId] ?? [];
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ORG_ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return [...granted];
}

/** True when this person holds any role at all in the organization. */
export function isMemberOf(ctx: AuthContext, organizationId: string): boolean {
  return (ctx.organizations[organizationId] ?? []).length > 0;
}

/** True when this person holds any platform role. Never a substitute for `can`. */
export function isPlatformStaff(ctx: AuthContext): boolean {
  return ctx.platformRoles.length > 0;
}
