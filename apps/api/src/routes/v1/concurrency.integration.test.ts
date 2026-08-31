import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { organizationMembers } from '@meter402/database';
import {
  addMember,
  call,
  createHarness,
  createTestApiKey,
  createTestOrganization,
  createTestProject,
  createTestUser,
  hasDatabase,
  uniqueEmail,
  type Harness,
} from '../../test-support/harness.js';

/**
 * Concurrency, against a real PostgreSQL instance.
 *
 * Every invariant here is of the check-then-write kind, and every one of them
 * is invisible to a unit test: a single-threaded test always sees a consistent
 * snapshot, so the race that breaks the invariant in production never occurs.
 * The only way to know these hold is to actually run them in parallel against
 * a real database with real transactions.
 *
 * This is the same reasoning that put replay protection behind a database
 * constraint in Phase 0 rather than an application check.
 */
describe.skipIf(!hasDatabase)('concurrency invariants', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  async function countActiveOwners(organizationId: string): Promise<number> {
    const rows = await harness.handle.db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, 'OWNER'),
          eq(organizationMembers.status, 'ACTIVE'),
        ),
      );
    return rows.length;
  }

  describe('an organization always keeps at least one active owner', () => {
    it('survives two owners demoting each other simultaneously', async () => {
      /*
       * The canonical lost-update race. Two owners, each demoting the other at
       * the same instant. Without `SELECT ... FOR UPDATE` inside the
       * transaction, both read a snapshot in which the other owner is still
       * ACTIVE, both conclude the invariant holds, and both commit — leaving an
       * organization nobody can administer.
       */
      const org = await createTestOrganization(harness.app, 'race-demote');
      const second = await addMember(
        harness.app,
        org.organizationId,
        org.owner.token,
        'OWNER',
        'race-owner-2',
      );

      const roster = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${org.organizationId}/members`,
        token: org.owner.token,
      });
      const rows = roster.body['data'] as Array<{ id: string; userId: string }>;
      const firstMembership = rows.find((row) => row.userId === org.owner.userId)!;
      const secondMembership = rows.find((row) => row.userId === second.userId)!;

      expect(await countActiveOwners(org.organizationId)).toBe(2);

      const [a, b] = await Promise.all([
        call(harness.app, {
          method: 'PATCH',
          url: `/v1/organizations/${org.organizationId}/members/${secondMembership.id}`,
          token: org.owner.token,
          payload: { role: 'VIEWER' },
        }),
        call(harness.app, {
          method: 'PATCH',
          url: `/v1/organizations/${org.organizationId}/members/${firstMembership.id}`,
          token: second.token,
          payload: { role: 'VIEWER' },
        }),
      ]);

      const successes = [a, b].filter((result) => result.status === 200);
      const failures = [a, b].filter((result) => result.status !== 200);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      /*
       * Two failure codes are both correct here, and which one appears depends
       * on where the interleaving lands:
       *
       *   LAST_OWNER_REQUIRED — the loser's transaction ran the invariant check
       *     after the winner committed, and refused to remove the last owner.
       *   PERMISSION_DENIED — the winner committed before the loser's
       *     permission check ran, so by then the loser was no longer an OWNER
       *     and never reached the invariant.
       *
       * Both are safe refusals. Asserting one specific code would make this
       * test flaky for no benefit; what must hold is that exactly one succeeds
       * and an active owner remains.
       */
      expect(['LAST_OWNER_REQUIRED', 'PERMISSION_DENIED']).toContain(
        (failures[0]!.body['error'] as { code: string }).code,
      );

      // The invariant, checked at the source of truth rather than inferred
      // from the responses.
      expect(await countActiveOwners(org.organizationId)).toBe(1);
    }, 60_000);

    it('survives many simultaneous attempts to demote the only owner', async () => {
      const org = await createTestOrganization(harness.app, 'race-solo');
      const roster = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${org.organizationId}/members`,
        token: org.owner.token,
      });
      const membershipId = (roster.body['data'] as Array<{ id: string }>)[0]!.id;

      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          call(harness.app, {
            method: 'PATCH',
            url: `/v1/organizations/${org.organizationId}/members/${membershipId}`,
            token: org.owner.token,
            payload: { role: 'ADMIN' },
          }),
        ),
      );

      expect(attempts.every((result) => result.status === 409)).toBe(true);
      expect(await countActiveOwners(org.organizationId)).toBe(1);
    }, 60_000);

    it('survives simultaneous removal and demotion of the last two owners', async () => {
      const org = await createTestOrganization(harness.app, 'race-mixed');
      const second = await addMember(
        harness.app,
        org.organizationId,
        org.owner.token,
        'OWNER',
        'race-mixed-2',
      );

      const roster = await call(harness.app, {
        method: 'GET',
        url: `/v1/organizations/${org.organizationId}/members`,
        token: org.owner.token,
      });
      const rows = roster.body['data'] as Array<{ id: string; userId: string }>;
      const firstMembership = rows.find((row) => row.userId === org.owner.userId)!;
      const secondMembership = rows.find((row) => row.userId === second.userId)!;

      // One removes, the other demotes. Different operations, same invariant.
      const [removal, demotion] = await Promise.all([
        call(harness.app, {
          method: 'DELETE',
          url: `/v1/organizations/${org.organizationId}/members/${secondMembership.id}`,
          token: org.owner.token,
        }),
        call(harness.app, {
          method: 'PATCH',
          url: `/v1/organizations/${org.organizationId}/members/${firstMembership.id}`,
          token: second.token,
          payload: { role: 'DEVELOPER' },
        }),
      ]);

      expect([removal.status, demotion.status].filter((status) => status === 200)).toHaveLength(1);
      expect(await countActiveOwners(org.organizationId)).toBeGreaterThanOrEqual(1);
    }, 60_000);
  });

  describe('membership uniqueness', () => {
    it('admits exactly one of several simultaneous invitations of the same person', async () => {
      /*
       * Two rows for the same person in the same organization would create a
       * "which role wins" ambiguity — and an attacker who could provoke it
       * could invite themselves as VIEWER and OWNER simultaneously and hope
       * the higher role is the one read. The unique index makes it impossible
       * regardless of timing.
       */
      const org = await createTestOrganization(harness.app, 'race-invite');
      const email = uniqueEmail('duplicate-invite');

      const attempts = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          call(harness.app, {
            method: 'POST',
            url: `/v1/organizations/${org.organizationId}/members`,
            token: org.owner.token,
            payload: { email, role: index === 0 ? 'VIEWER' : 'OWNER' },
          }),
        ),
      );

      const created = attempts.filter((result) => result.status === 201);
      expect(created).toHaveLength(1);
      expect(attempts.filter((result) => result.status === 409).length).toBe(attempts.length - 1);
    }, 60_000);
  });

  describe('API key rotation', () => {
    it('admits exactly one of several simultaneous rotations of the same key', async () => {
      /*
       * Two successful rotations would leave two live replacements for one
       * revoked key — twice the credentials the operator believes exist, which
       * is precisely the wrong outcome for an operation usually performed
       * because a key may be compromised.
       */
      const org = await createTestOrganization(harness.app, 'race-rotate');
      const projectId = await createTestProject(
        harness.app,
        org.organizationId,
        org.owner.token,
        'race-rotate',
      );
      const key = await createTestApiKey(harness.app, projectId, org.owner.token, {
        name: 'contended',
      });

      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(harness.app, {
            method: 'POST',
            url: `/v1/projects/${projectId}/api-keys/${key.id}/rotate`,
            token: org.owner.token,
          }),
        ),
      );

      const succeeded = attempts.filter((result) => result.status === 201);
      expect(succeeded).toHaveLength(1);

      // The original is dead, and exactly one replacement works.
      expect(
        (await call(harness.app, { method: 'GET', url: '/v1/me', token: key.secret })).status,
      ).toBe(401);

      const replacementSecret = (succeeded[0]!.body['data'] as { secret: string }).secret;
      expect(
        (await call(harness.app, { method: 'GET', url: '/v1/me', token: replacementSecret }))
          .status,
      ).toBe(200);
    }, 60_000);

    it('admits exactly one of several simultaneous revocations', async () => {
      const org = await createTestOrganization(harness.app, 'race-revoke');
      const projectId = await createTestProject(
        harness.app,
        org.organizationId,
        org.owner.token,
        'race-revoke',
      );
      const key = await createTestApiKey(harness.app, projectId, org.owner.token, {
        name: 'contended revoke',
      });

      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(harness.app, {
            method: 'DELETE',
            url: `/v1/projects/${projectId}/api-keys/${key.id}`,
            token: org.owner.token,
          }),
        ),
      );

      // Exactly one 200 means exactly one audit event, rather than five
      // records of a single action.
      expect(attempts.filter((result) => result.status === 200)).toHaveLength(1);
    }, 60_000);
  });

  describe('organization slug uniqueness', () => {
    it('admits exactly one of several simultaneous creations of the same slug', async () => {
      const user = await createTestUser(harness.app, 'race-slug');
      const slug = `race-slug-${Date.now().toString(36)}`;

      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(harness.app, {
            method: 'POST',
            url: '/v1/organizations',
            token: user.token,
            payload: { name: 'Race Slug', slug },
          }),
        ),
      );

      expect(attempts.filter((result) => result.status === 201)).toHaveLength(1);
      expect(attempts.filter((result) => result.status === 409)).toHaveLength(4);
    }, 60_000);
  });
});
