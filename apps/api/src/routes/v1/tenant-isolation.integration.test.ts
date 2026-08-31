import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  call,
  createHarness,
  createTestApiKey,
  createTestOrganization,
  createTestProject,
  createTestUser,
  hasDatabase,
  type Harness,
  type TestUser,
} from '../../test-support/harness.js';

/**
 * Cross-tenant isolation.
 *
 * The single most important property in Phase 1, and the one the phase brief
 * calls release-blocking:
 *
 *   A valid identity belonging to Organization A must never be able to read or
 *   modify Organization B's resources, regardless of guessed IDs, malformed
 *   requests, role manipulation, or API-key usage.
 *
 * Every test here uses a *legitimately authenticated* user. These are not
 * "does auth work" tests — the caller is always a real, valid, active user
 * with real credentials. They simply belong to the wrong organization.
 *
 * The expected status is 404, never 403: a 403 would confirm the resource
 * exists, which is exactly what a cross-tenant probe is looking for.
 */
describe.skipIf(!hasDatabase)('cross-tenant isolation', () => {
  let harness: Harness;

  // Organization A and its resources.
  let orgA: string;
  let ownerA: TestUser;
  let projectA: string;
  let keyAId: string;
  let membershipAId: string;

  // Organization B: a completely separate tenant.
  let orgB: string;
  let ownerB: TestUser;

  // A user with no membership anywhere.
  let outsider: TestUser;

  beforeAll(async () => {
    harness = await createHarness();

    const a = await createTestOrganization(harness.app, 'alpha');
    orgA = a.organizationId;
    ownerA = a.owner;
    projectA = await createTestProject(harness.app, orgA, ownerA.token, 'alpha');
    keyAId = (await createTestApiKey(harness.app, projectA, ownerA.token)).id;

    const membersA = await call(harness.app, {
      method: 'GET',
      url: `/v1/organizations/${orgA}/members`,
      token: ownerA.token,
    });
    membershipAId = (membersA.body['data'] as Array<{ id: string }>)[0]!.id;

    const b = await createTestOrganization(harness.app, 'beta');
    orgB = b.organizationId;
    ownerB = b.owner;

    outsider = await createTestUser(harness.app, 'outsider');
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  describe('Organization B owner cannot reach Organization A', () => {
    it('cannot read the organization', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${orgA}`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
      expect((result.body['error'] as { code: string }).code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('cannot update the organization', async () => {
      const result = await call(harness.app, {
        method: 'PATCH',
        url: `/v1/organizations/${orgA}`,
        token: ownerB.token,
        payload: { name: 'Taken over' },
      });
      expect(result.status).toBe(404);
    });

    it('cannot list its members', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${orgA}/members`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
    });

    it('cannot invite a member into it', async () => {
      const result = await call(harness.app, {
        method: 'POST',
        url: `/v1/organizations/${orgA}/members`,
        token: ownerB.token,
        payload: { email: 'intruder@example.test', role: 'OWNER' },
      });
      expect(result.status).toBe(404);
    });

    it('cannot modify one of its memberships', async () => {
      const result = await call(harness.app, {
        method: 'PATCH',
        url: `/v1/organizations/${orgA}/members/${membershipAId}`,
        token: ownerB.token,
        payload: { role: 'VIEWER' },
      });
      expect(result.status).toBe(404);
    });

    it('cannot remove one of its members', async () => {
      const result = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/organizations/${orgA}/members/${membershipAId}`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
    });

    it('cannot read its project', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/projects/${projectA}`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
      expect((result.body['error'] as { code: string }).code).toBe('PROJECT_NOT_FOUND');
    });

    it('cannot update its project', async () => {
      const result = await call(harness.app, {
        method: 'PATCH',
        url: `/v1/projects/${projectA}`,
        token: ownerB.token,
        payload: { name: 'Renamed by intruder' },
      });
      expect(result.status).toBe(404);
    });

    it('cannot archive its project', async () => {
      const result = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${projectA}`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
    });

    it('cannot list its API keys', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/projects/${projectA}/api-keys`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
    });

    it('cannot mint an API key in its project', async () => {
      // The worst case: minting a working credential inside another tenant.
      const result = await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectA}/api-keys`,
        token: ownerB.token,
        payload: { name: 'intruder key', environment: 'TEST', scopes: ['payments:read'] },
      });
      expect(result.status).toBe(404);
      expect(result.raw).not.toContain('meter_test_');
    });

    it('cannot rotate its API key', async () => {
      const result = await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectA}/api-keys/${keyAId}/rotate`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
      expect(result.raw).not.toContain('meter_test_');
    });

    it('cannot revoke its API key', async () => {
      const result = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${projectA}/api-keys/${keyAId}`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
    });

    it('cannot see it in their own organization list', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: '/v1/organizations',
        token: ownerB.token,
      });
      expect(result.status).toBe(200);
      const ids = (result.body['data'] as Array<{ id: string }>).map((row) => row.id);
      expect(ids).toContain(orgB);
      expect(ids).not.toContain(orgA);
    });

    it('cannot list projects by naming another organization', async () => {
      // The organization ID is caller-supplied here, which is precisely why it
      // is validated against membership before it reaches a query.
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/projects?organizationId=${orgA}`,
        token: ownerB.token,
      });
      expect(result.status).toBe(404);
    });

    it('cannot create a project inside another organization', async () => {
      const result = await call(harness.app, {
        method: 'POST',
        url: '/v1/projects',
        token: ownerB.token,
        payload: { organizationId: orgA, name: 'Intruder project', slug: 'intruder-project' },
      });
      expect(result.status).toBe(404);
    });
  });

  describe('a user with no memberships reaches nothing', () => {
    it.each([
      ['GET', '/v1/organizations/:org'],
      ['PATCH', '/v1/organizations/:org'],
      ['GET', '/v1/organizations/:org/members'],
    ])('%s %s returns 404', async (method, template) => {
      const result = await call(harness.app, {
        method: method as 'GET' | 'PATCH',
        url: template.replace(':org', orgA),
        token: outsider.token,
        ...(method === 'PATCH' ? { payload: { name: 'nope' } } : {}),
      });
      expect(result.status).toBe(404);
    });

    it('sees an empty organization list', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: '/v1/organizations',
        token: outsider.token,
      });
      expect(result.status).toBe(200);
      expect(result.body['data']).toEqual([]);
    });
  });

  describe('lower-privilege roles are also confined to their own tenant', () => {
    it.each(['ADMIN', 'DEVELOPER', 'ANALYST', 'BILLING', 'VIEWER'] as const)(
      'a %s in Organization B cannot read Organization A',
      async (role) => {
        // A lower privilege level must not widen reach; it only narrows what
        // the member can do inside their own organization.
        const member = await addMember(harness.app, orgB, ownerB.token, role, `beta-${role}`);

        expect(
          (
            await call(harness.app, {
              method: 'GET',
              url: `/v1/organizations/${orgA}`,
              token: member.token,
            })
          ).status,
        ).toBe(404);

        expect(
          (
            await call(harness.app, {
              method: 'GET',
              url: `/v1/projects/${projectA}`,
              token: member.token,
            })
          ).status,
        ).toBe(404);

        expect(
          (
            await call(harness.app, {
              method: 'GET',
              url: `/v1/projects/${projectA}/api-keys`,
              token: member.token,
            })
          ).status,
        ).toBe(404);
      },
      30_000,
    );
  });

  describe('an API key is confined to its own organization', () => {
    it('cannot be used on human organization routes at all', async () => {
      // An API key is a machine credential. Even in its own organization it
      // must not be able to act as its creator on member management.
      const key = await createTestApiKey(harness.app, projectA, ownerA.token, {
        name: 'confinement probe',
      });
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${orgA}/members`,
        token: key.secret,
      });
      expect(result.status).toBe(403);
      expect((result.body['error'] as { code: string }).code).toBe('PERMISSION_DENIED');
    });

    it('cannot read another organization', async () => {
      const key = await createTestApiKey(harness.app, projectA, ownerA.token, {
        name: 'cross-tenant probe',
      });
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${orgB}`,
        token: key.secret,
      });
      // Rejected as the wrong kind of principal before tenancy is even
      // considered — a machine credential has no path to these routes.
      expect([403, 404]).toContain(result.status);
    });
  });

  describe('malformed and hostile identifiers', () => {
    it.each([
      ['org_00000000000000000000000000', 'well-formed but nonexistent'],
      ['../../etc/passwd', 'path traversal'],
      ["' OR 1=1--", 'SQL injection'],
      ['%00', 'null byte'],
      ['org_' + 'A'.repeat(200), 'oversized'],
    ])('rejects organization ID %s (%s) without leaking', async (candidate) => {
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${encodeURIComponent(candidate)}`,
        token: ownerB.token,
      });
      /*
       * Any clean rejection is acceptable: 404 (no membership), 422 (fails the
       * length bound), or 414 (the oversized case, rejected by the HTTP layer
       * before routing — the earliest and cheapest possible rejection).
       *
       * What must never happen is a 200, or a 500 that would suggest the input
       * reached something that choked on it.
       */
      expect([404, 414, 422]).toContain(result.status);
      expect(result.status).not.toBe(200);
    });

    it('does not execute injected SQL through the project list filter', async () => {
      const result = await call(harness.app, {
        method: 'GET',
        url: `/v1/projects?organizationId=${encodeURIComponent("' OR '1'='1")}`,
        token: ownerB.token,
      });
      expect([404, 422]).toContain(result.status);
      expect(result.raw).not.toContain('alpha');
    });
  });
});
