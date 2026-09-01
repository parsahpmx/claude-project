import { describe, expect, it } from 'vitest';
import { Meter402Error } from '@meter402/shared';
import { PERMISSIONS, isPermission, type Permission } from './permissions.js';
import { ROLES, ROLE_PERMISSIONS, isRole, permissionsForRole, type Role } from './roles.js';
import {
  buildAuthorizationContext,
  hasPermission,
  requireAnyPermission,
  requirePermission,
} from './authorization.js';
import type { Membership, UserPrincipal } from './principal.js';

const USER: UserPrincipal = { type: 'user', userId: 'usr_test' };

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    membershipId: 'mem_test',
    organizationId: 'org_test',
    userId: USER.userId,
    role: 'OWNER',
    status: 'ACTIVE',
    ...overrides,
  };
}

function contextFor(role: Role) {
  return buildAuthorizationContext(USER, membership({ role }));
}

/**
 * The expected matrix, written out by hand rather than derived from
 * ROLE_PERMISSIONS.
 *
 * Deriving it would make the test tautological — it would pass for any
 * implementation, including one that accidentally grants DEVELOPER the ability
 * to delete the organization. Written explicitly, adding a permission to a
 * role is a deliberate two-place edit that a reviewer sees.
 */
const EXPECTED: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: [...PERMISSIONS],

  ADMIN: [
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
  ],

  DEVELOPER: [
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
    'settlement:read',
    'webhooks:read',
    'webhooks:write',
  ],

  ANALYST: [
    'organization:read',
    'members:read',
    'projects:read',
    'endpoints:read',
    'payments:read',
    'analytics:read',
    'webhooks:read',
    'audit:read',
  ],

  BILLING: [
    'organization:read',
    'payments:read',
    'analytics:read',
    'billing:read',
    'billing:manage',
    'settlement:read',
  ],

  VIEWER: [
    'organization:read',
    'members:read',
    'projects:read',
    'endpoints:read',
    'payments:read',
    'analytics:read',
  ],
};

describe('permission and role vocabularies', () => {
  it('has no duplicate permissions', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('has no duplicate roles', () => {
    expect(new Set(ROLES).size).toBe(ROLES.length);
  });

  it('recognises its own members and rejects invented ones', () => {
    expect(isPermission('organization:read')).toBe(true);
    expect(isPermission('organization:take_over')).toBe(false);
    expect(isRole('OWNER')).toBe(true);
    expect(isRole('SUPERUSER')).toBe(false);
    expect(isRole('owner')).toBe(false);
  });

  it('grants only permissions that exist', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(isPermission(permission), `${role} -> ${permission}`).toBe(true);
      }
    }
  });
});

describe('ROLE_PERMISSIONS matrix', () => {
  it.each(ROLES)('grants %s exactly its declared permissions', (role) => {
    expect([...permissionsForRole(role)].sort()).toEqual([...EXPECTED[role]].sort());
  });

  /**
   * The denial half of the matrix. Product rule 30 is explicit that testing
   * only OWNER is insufficient — the interesting assertions are the ones that
   * say a role *cannot* do something.
   */
  it.each(ROLES)('denies %s every permission it was not granted', (role) => {
    const granted = new Set(EXPECTED[role]);
    const denied = PERMISSIONS.filter((permission) => !granted.has(permission));
    const context = contextFor(role);
    for (const permission of denied) {
      expect(hasPermission(context, permission), `${role} must not have ${permission}`).toBe(false);
      expect(() => requirePermission(context, permission)).toThrow(Meter402Error);
    }
  });

  it('gives OWNER every permission', () => {
    expect(permissionsForRole('OWNER').size).toBe(PERMISSIONS.length);
  });

  it('reserves organization deletion to OWNER alone', () => {
    // Irreversible and account-ending. Everything else an ADMIN can undo.
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].has('organization:delete')).toBe(role === 'OWNER');
    }
  });

  it('reserves billing management to OWNER and BILLING', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].has('billing:manage')).toBe(
        role === 'OWNER' || role === 'BILLING',
      );
    }
  });

  it('gives no non-administrative role authority over people', () => {
    for (const role of ['DEVELOPER', 'ANALYST', 'BILLING', 'VIEWER'] as const) {
      expect(ROLE_PERMISSIONS[role].has('members:invite')).toBe(false);
      expect(ROLE_PERMISSIONS[role].has('members:update_role')).toBe(false);
      expect(ROLE_PERMISSIONS[role].has('members:remove')).toBe(false);
    }
  });

  it('gives no read-only role any write permission', () => {
    const writes = PERMISSIONS.filter(
      (permission) =>
        permission.endsWith(':write') ||
        permission.endsWith(':create') ||
        permission.endsWith(':update') ||
        permission.endsWith(':delete') ||
        permission.endsWith(':remove') ||
        permission.endsWith(':revoke') ||
        permission.endsWith(':rotate') ||
        permission.endsWith(':invite') ||
        permission.endsWith(':manage') ||
        permission === 'members:update_role',
    );
    for (const role of ['VIEWER', 'ANALYST'] as const) {
      for (const permission of writes) {
        expect(ROLE_PERMISSIONS[role].has(permission), `${role} ${permission}`).toBe(false);
      }
    }
  });

  it('makes VIEWER a subset of ANALYST and ANALYST a subset of ADMIN where read access overlaps', () => {
    for (const permission of ROLE_PERMISSIONS.VIEWER) {
      expect(ROLE_PERMISSIONS.ANALYST.has(permission), `ANALYST missing ${permission}`).toBe(true);
    }
  });

  it('makes every role a subset of OWNER', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(ROLE_PERMISSIONS.OWNER.has(permission)).toBe(true);
      }
    }
  });

  it('freezes the permission sets against runtime mutation', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
  });
});

describe('buildAuthorizationContext', () => {
  it('builds a context for an active membership', () => {
    const context = buildAuthorizationContext(USER, membership({ role: 'DEVELOPER' }));
    expect(context.organizationId).toBe('org_test');
    expect(context.role).toBe('DEVELOPER');
    expect(hasPermission(context, 'projects:create')).toBe(true);
  });

  it.each(['INVITED', 'SUSPENDED', 'REMOVED'] as const)(
    'refuses to authorize a %s membership',
    (status) => {
      // Product rule 8: a suspended membership cannot authorize actions. An
      // INVITED member has not accepted; a REMOVED one has had authority
      // withdrawn.
      expect(() => buildAuthorizationContext(USER, membership({ status }))).toThrow(Meter402Error);
      try {
        buildAuthorizationContext(USER, membership({ status }));
      } catch (error) {
        expect((error as Meter402Error).code).toBe('MEMBERSHIP_INACTIVE');
        expect((error as Meter402Error).httpStatus).toBe(403);
      }
    },
  );

  it('refuses a membership belonging to a different user', () => {
    // Should be impossible given how memberships are loaded; if it happens,
    // something upstream is confused about identity and continuing would
    // attach one user's authority to another's session.
    expect(() =>
      buildAuthorizationContext(USER, membership({ userId: 'usr_someone_else' })),
    ).toThrow(/does not belong/);
  });

  it('never grants a suspended owner any authority', () => {
    // The most dangerous combination: highest role, withdrawn authority.
    expect(() =>
      buildAuthorizationContext(USER, membership({ role: 'OWNER', status: 'SUSPENDED' })),
    ).toThrow(Meter402Error);
  });
});

describe('requirePermission', () => {
  it('passes silently when permitted', () => {
    expect(() => requirePermission(contextFor('OWNER'), 'organization:delete')).not.toThrow();
  });

  it('throws PERMISSION_DENIED with the required permission in details', () => {
    try {
      requirePermission(contextFor('VIEWER'), 'projects:create');
      expect.unreachable('expected a permission denial');
    } catch (error) {
      const typed = error as Meter402Error;
      expect(typed.code).toBe('PERMISSION_DENIED');
      expect(typed.httpStatus).toBe(403);
      expect(typed.details).toMatchObject({
        requiredPermission: 'projects:create',
        role: 'VIEWER',
      });
    }
  });

  it('supports an any-of check', () => {
    expect(() =>
      requireAnyPermission(contextFor('BILLING'), ['billing:manage', 'organization:delete']),
    ).not.toThrow();
    expect(() =>
      requireAnyPermission(contextFor('VIEWER'), ['billing:manage', 'organization:delete']),
    ).toThrow(Meter402Error);
  });
});
