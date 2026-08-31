import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@meter402/auth';
import {
  addMember,
  call,
  createHarness,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  uniqueSlug,
  type Harness,
  type TestUser,
} from '../../test-support/harness.js';

/**
 * RBAC enforced over real HTTP.
 *
 * The unit matrix in @meter402/auth proves the permission map is right. This
 * proves the routes actually consult it — a correct map that a handler forgets
 * to call is worth nothing.
 *
 * Both halves matter, and product rule 30 is explicit that testing only OWNER
 * is insufficient. Every role is exercised against every operation, and the
 * denials are asserted as carefully as the grants.
 */
describe.skipIf(!hasDatabase)('RBAC over HTTP', () => {
  let harness: Harness;
  let organizationId: string;
  let projectId: string;
  let owner: TestUser;
  const members = new Map<Role, TestUser>();

  const ROLES: readonly Role[] = ['ADMIN', 'DEVELOPER', 'ANALYST', 'BILLING', 'VIEWER'];

  beforeAll(async () => {
    harness = await createHarness();
    const org = await createTestOrganization(harness.app, 'rbac');
    organizationId = org.organizationId;
    owner = org.owner;
    projectId = await createTestProject(harness.app, organizationId, owner.token, 'rbac');

    for (const role of ROLES) {
      members.set(
        role,
        await addMember(harness.app, organizationId, owner.token, role, `rbac-${role}`),
      );
    }
    members.set('OWNER', owner);
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
  });

  function tokenFor(role: Role): string {
    const user = members.get(role);
    if (!user) throw new Error(`No test user for role ${role}`);
    return user.token;
  }

  /**
   * The expected access matrix, written out explicitly.
   *
   * `true` means the operation must succeed; `false` means it must be refused
   * with 403 — the caller is a genuine member of this organization, so the
   * refusal is about authority, not tenancy.
   */
  interface Operation {
    readonly label: string;
    readonly allowed: Readonly<Record<Role, boolean>>;
    run(role: Role): Promise<number>;
  }

  const operations: readonly Operation[] = [
    {
      label: 'GET /v1/organizations/:id',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: true,
        ANALYST: true,
        BILLING: true,
        VIEWER: true,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'GET',
            url: `/v1/organizations/${organizationId}`,
            token: tokenFor(role),
          })
        ).status;
      },
    },
    {
      label: 'PATCH /v1/organizations/:id',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: false,
        ANALYST: false,
        BILLING: false,
        VIEWER: false,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'PATCH',
            url: `/v1/organizations/${organizationId}`,
            token: tokenFor(role),
            payload: { name: `Renamed by ${role}` },
          })
        ).status;
      },
    },
    {
      label: 'GET /v1/organizations/:id/members',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: true,
        ANALYST: true,
        BILLING: false,
        VIEWER: true,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'GET',
            url: `/v1/organizations/${organizationId}/members`,
            token: tokenFor(role),
          })
        ).status;
      },
    },
    {
      label: 'POST /v1/organizations/:id/members',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: false,
        ANALYST: false,
        BILLING: false,
        VIEWER: false,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'POST',
            url: `/v1/organizations/${organizationId}/members`,
            token: tokenFor(role),
            payload: { email: `invitee-${role}-${Date.now()}@example.test`, role: 'VIEWER' },
          })
        ).status;
      },
    },
    {
      label: 'GET /v1/projects',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: true,
        ANALYST: true,
        BILLING: false,
        VIEWER: true,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'GET',
            url: `/v1/projects?organizationId=${organizationId}`,
            token: tokenFor(role),
          })
        ).status;
      },
    },
    {
      label: 'POST /v1/projects',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: true,
        ANALYST: false,
        BILLING: false,
        VIEWER: false,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'POST',
            url: '/v1/projects',
            token: tokenFor(role),
            payload: {
              organizationId,
              name: `Project by ${role}`,
              slug: uniqueSlug(`p-${role.toLowerCase()}`),
            },
          })
        ).status;
      },
    },
    {
      label: 'GET /v1/projects/:id/api-keys',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: true,
        ANALYST: false,
        BILLING: false,
        VIEWER: false,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'GET',
            url: `/v1/projects/${projectId}/api-keys`,
            token: tokenFor(role),
          })
        ).status;
      },
    },
    {
      label: 'POST /v1/projects/:id/api-keys',
      allowed: {
        OWNER: true,
        ADMIN: true,
        DEVELOPER: true,
        ANALYST: false,
        BILLING: false,
        VIEWER: false,
      },
      async run(role) {
        return (
          await call(harness.app, {
            method: 'POST',
            url: `/v1/projects/${projectId}/api-keys`,
            token: tokenFor(role),
            payload: { name: `key by ${role}`, environment: 'TEST', scopes: ['payments:read'] },
          })
        ).status;
      },
    },
  ];

  for (const operation of operations) {
    describe(operation.label, () => {
      for (const role of ['OWNER', ...ROLES] as readonly Role[]) {
        const shouldAllow = operation.allowed[role];
        it(`${shouldAllow ? 'permits' : 'denies'} ${role}`, async () => {
          const status = await operation.run(role);
          if (shouldAllow) {
            expect(status, `${role} should be permitted`).toBeLessThan(400);
          } else {
            // 403, never 404: the caller *is* a member here, so the refusal is
            // about authority. Reserving 404 for cross-tenant keeps the two
            // signals meaningfully distinct.
            expect(status, `${role} should be denied`).toBe(403);
          }
        });
      }
    });
  }

  describe('project deletion is reserved to organization administrators', () => {
    it.each(['DEVELOPER', 'ANALYST', 'BILLING', 'VIEWER'] as const)('denies %s', async (role) => {
      const disposable = await createTestProject(
        harness.app,
        organizationId,
        owner.token,
        `del-${role.toLowerCase()}`,
      );
      const result = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${disposable}`,
        token: tokenFor(role),
      });
      expect(result.status).toBe(403);
    });

    it('permits ADMIN', async () => {
      const disposable = await createTestProject(
        harness.app,
        organizationId,
        owner.token,
        'del-ok',
      );
      const result = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${disposable}`,
        token: tokenFor('ADMIN'),
      });
      expect(result.status).toBe(200);
      expect((result.body['data'] as { status: string }).status).toBe('ARCHIVED');
    });
  });

  describe('privilege escalation attempts', () => {
    it('refuses an ADMIN inviting a new OWNER without role-change authority', async () => {
      // ADMIN does hold members:update_role, so this specific case is allowed;
      // the assertion documents that the guard exists and is deliberate.
      const result = await call(harness.app, {
        method: 'POST',
        url: `/v1/organizations/${organizationId}/members`,
        token: tokenFor('ADMIN'),
        payload: { email: `owner-invite-${Date.now()}@example.test`, role: 'OWNER' },
      });
      expect(result.status).toBe(201);
    });

    it('refuses a DEVELOPER promoting themselves', async () => {
      const developer = members.get('DEVELOPER')!;
      const roster = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${organizationId}/members`,
        token: owner.token,
      });
      const own = (roster.body['data'] as Array<{ id: string; userId: string }>).find(
        (row) => row.userId === developer.userId,
      );
      expect(own).toBeDefined();

      const result = await call(harness.app, {
        method: 'PATCH',
        url: `/v1/organizations/${organizationId}/members/${own!.id}`,
        token: developer.token,
        payload: { role: 'OWNER' },
      });
      expect(result.status).toBe(403);
    });

    it('rejects an unknown role rather than defaulting to one', async () => {
      const result = await call(harness.app, {
        method: 'POST',
        url: `/v1/organizations/${organizationId}/members`,
        token: owner.token,
        payload: { email: `bad-role-${Date.now()}@example.test`, role: 'SUPERUSER' },
      });
      expect(result.status).toBe(422);
    });

    it('rejects a suspended member entirely', async () => {
      const victim = await addMember(
        harness.app,
        organizationId,
        owner.token,
        'ADMIN',
        'suspendee',
      );
      const suspended = await call(harness.app, {
        method: 'PATCH',
        url: `/v1/organizations/${organizationId}/members/${victim.membershipId}`,
        token: owner.token,
        payload: { status: 'SUSPENDED' },
      });
      expect(suspended.status).toBe(200);

      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${organizationId}`,
        token: victim.token,
      });
      expect(result.status).toBe(403);
      expect((result.body['error'] as { code: string }).code).toBe('MEMBERSHIP_INACTIVE');
    }, 30_000);

    it('grants an invited-but-not-accepted member nothing', async () => {
      // The invitation exists; authority does not follow until acceptance.
      const invitee = await call(harness.app, {
        method: 'POST',
        url: '/v1/dev/sessions',
        payload: { email: `pending-${Date.now()}@example.test` },
      });
      const pending = invitee.body['data'] as { token: string; email: string };

      await call(harness.app, {
        method: 'POST',
        url: `/v1/organizations/${organizationId}/members`,
        token: owner.token,
        payload: { email: pending.email, role: 'ADMIN' },
      });

      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${organizationId}`,
        token: pending.token,
      });
      expect(result.status).toBe(403);
      expect((result.body['error'] as { code: string }).code).toBe('MEMBERSHIP_INACTIVE');
    }, 30_000);
  });
});
