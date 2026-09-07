import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS,
  ORG_ROLE_PERMISSIONS,
  PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  type AuthContext,
  type OrgRole,
  type Permission,
  can,
  isMemberOf,
  isPlatformStaff,
  permissionsInOrg,
} from './permissions';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ME = 'user-me';
const OTHER = 'user-other';

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return { userId: ME, platformRoles: [], organizations: {}, coachOf: [], ...over };
}

const withOrgRole = (role: OrgRole, org = ORG_A) => ctx({ organizations: { [org]: [role] } });

describe('anonymous', () => {
  it('holds no permission at all', () => {
    for (const permission of PERMISSIONS) {
      expect(can(ANONYMOUS, permission, { organizationId: ORG_A, userId: ME }), permission).toBe(
        false,
      );
    }
  });
});

describe('self permissions', () => {
  it('lets a signed-in person act on their own records', () => {
    expect(can(ctx(), 'profile.read.self')).toBe(true);
    expect(can(ctx(), 'profile.update.self')).toBe(true);
    expect(can(ctx(), 'activity.read.self')).toBe(true);
    expect(can(ctx(), 'activity.write.self')).toBe(true);
  });

  it('accepts an explicit scope naming themselves', () => {
    expect(can(ctx(), 'activity.write.self', { userId: ME })).toBe(true);
  });

  it('refuses when the subject is somebody else', () => {
    expect(can(ctx(), 'profile.update.self', { userId: OTHER })).toBe(false);
    expect(can(ctx(), 'activity.write.self', { userId: OTHER })).toBe(false);
  });
});

describe('coach relationships', () => {
  it('grants nothing without an accepted relationship', () => {
    expect(can(ctx(), 'client.read', { userId: OTHER })).toBe(false);
    expect(can(ctx(), 'client.program.manage', { userId: OTHER })).toBe(false);
  });

  it('grants access only to the named client', () => {
    const coach = ctx({ coachOf: [OTHER] });
    expect(can(coach, 'client.read', { userId: OTHER })).toBe(true);
    expect(can(coach, 'client.program.manage', { userId: OTHER })).toBe(true);
    expect(can(coach, 'client.read', { userId: 'someone-else' })).toBe(false);
  });

  it('refuses an unscoped client check rather than assuming any client', () => {
    expect(can(ctx({ coachOf: [OTHER] }), 'client.read')).toBe(false);
  });

  it('does not let the org coach role stand in for a relationship', () => {
    // Being a coach *at a gym* is not consent from an individual athlete.
    expect(can(withOrgRole('coach'), 'client.read', { userId: OTHER })).toBe(false);
  });
});

describe('organization scope', () => {
  it('refuses an org permission with no organization named', () => {
    expect(can(withOrgRole('gym_owner'), 'gym.member.manage')).toBe(false);
  });

  it('does not leak a role from one organization into another', () => {
    const owner = withOrgRole('gym_owner', ORG_A);
    expect(can(owner, 'gym.member.manage', { organizationId: ORG_A })).toBe(true);
    expect(can(owner, 'gym.member.manage', { organizationId: ORG_B })).toBe(false);
    expect(can(owner, 'organization.settings.manage', { organizationId: ORG_B })).toBe(false);
  });

  it('grants an ordinary member nothing operational', () => {
    const member = withOrgRole('member');
    for (const permission of ORG_ROLE_PERMISSIONS.gym_owner) {
      expect(can(member, permission, { organizationId: ORG_A }), permission).toBe(false);
    }
  });

  it('lets staff and coaches read members but not manage them', () => {
    for (const role of ['gym_staff', 'coach'] as const) {
      const c = withOrgRole(role);
      expect(can(c, 'gym.member.read', { organizationId: ORG_A }), role).toBe(true);
      expect(can(c, 'gym.member.manage', { organizationId: ORG_A }), role).toBe(false);
      expect(can(c, 'gym.staff.manage', { organizationId: ORG_A }), role).toBe(false);
    }
  });

  it('stops a manager reconfiguring the organization or its access control', () => {
    const manager = withOrgRole('gym_manager');
    expect(can(manager, 'gym.member.manage', { organizationId: ORG_A })).toBe(true);
    expect(can(manager, 'gym.class.manage', { organizationId: ORG_A })).toBe(true);
    // Mirrors the database policy that a manager cannot mint an owner.
    expect(can(manager, 'organization.settings.manage', { organizationId: ORG_A })).toBe(false);
    expect(can(manager, 'gym.access.manage', { organizationId: ORG_A })).toBe(false);
  });

  it('gives an owner every gym permission in their own organization', () => {
    const owner = withOrgRole('gym_owner');
    for (const permission of ORG_ROLE_PERMISSIONS.gym_owner) {
      expect(can(owner, permission, { organizationId: ORG_A }), permission).toBe(true);
    }
  });

  it('supports several roles in the same organization', () => {
    const both = ctx({ organizations: { [ORG_A]: ['member', 'gym_manager'] } });
    expect(can(both, 'gym.member.manage', { organizationId: ORG_A })).toBe(true);
  });

  it('supports different roles in different organizations', () => {
    const multi = ctx({ organizations: { [ORG_A]: ['gym_owner'], [ORG_B]: ['member'] } });
    expect(can(multi, 'organization.settings.manage', { organizationId: ORG_A })).toBe(true);
    expect(can(multi, 'organization.settings.manage', { organizationId: ORG_B })).toBe(false);
  });
});

describe('platform scope', () => {
  it('is closed to ordinary users however many gyms they own', () => {
    const owner = ctx({ organizations: { [ORG_A]: ['gym_owner'], [ORG_B]: ['gym_owner'] } });
    expect(can(owner, 'platform.user.read')).toBe(false);
    expect(can(owner, 'platform.user.suspend')).toBe(false);
    expect(can(owner, 'platform.audit.read')).toBe(false);
  });

  it('grants a platform admin read and audit but not suspension', () => {
    const admin = ctx({ platformRoles: ['platform_admin'] });
    expect(can(admin, 'platform.user.read')).toBe(true);
    expect(can(admin, 'platform.audit.read')).toBe(true);
    expect(can(admin, 'platform.user.suspend')).toBe(false);
  });

  it('makes super admin a strict superset of platform admin', () => {
    const superAdmin = ctx({ platformRoles: ['super_admin'] });
    for (const permission of PLATFORM_ROLE_PERMISSIONS.platform_admin) {
      expect(can(superAdmin, permission), permission).toBe(true);
    }
    expect(can(superAdmin, 'platform.user.suspend')).toBe(true);
  });

  it('does not let a platform role stand in for gym or client access', () => {
    const admin = ctx({ platformRoles: ['super_admin'] });
    // Platform staff reach member data through an audited elevated path, not by
    // silently inheriting every gym's permissions.
    expect(can(admin, 'gym.member.manage', { organizationId: ORG_A })).toBe(false);
    expect(can(admin, 'client.read', { userId: OTHER })).toBe(false);
  });
});

describe('fails closed', () => {
  it('refuses a permission that is not in the model', () => {
    const admin = ctx({ platformRoles: ['super_admin'] });
    expect(
      can(admin, 'gym.member.delete_everything' as Permission, { organizationId: ORG_A }),
    ).toBe(false);
    expect(can(admin, '' as Permission)).toBe(false);
  });

  it('refuses when the organization is unknown to the context', () => {
    expect(can(withOrgRole('gym_owner'), 'gym.member.read', { organizationId: 'nope' })).toBe(
      false,
    );
  });

  it('refuses when a role list is present but empty', () => {
    expect(
      can(ctx({ organizations: { [ORG_A]: [] } }), 'gym.member.read', { organizationId: ORG_A }),
    ).toBe(false);
  });
});

describe('helpers', () => {
  it('lists the permissions held in one organization', () => {
    const perms = permissionsInOrg(withOrgRole('gym_manager'), ORG_A);
    expect(perms).toContain('gym.member.manage');
    expect(perms).not.toContain('organization.settings.manage');
    expect(permissionsInOrg(withOrgRole('gym_manager'), ORG_B)).toEqual([]);
  });

  it('reports organization membership and platform staff', () => {
    expect(isMemberOf(withOrgRole('member'), ORG_A)).toBe(true);
    expect(isMemberOf(withOrgRole('member'), ORG_B)).toBe(false);
    expect(isPlatformStaff(ctx())).toBe(false);
    expect(isPlatformStaff(ctx({ platformRoles: ['platform_admin'] }))).toBe(true);
  });
});
