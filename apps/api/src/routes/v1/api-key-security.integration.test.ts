import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys, auditEvents } from '@meter402/database';
import {
  call,
  createHarness,
  createTestApiKey,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  type Harness,
  type TestUser,
} from '../../test-support/harness.js';

/**
 * API key security, end to end against a real database.
 *
 * The assertions that matter most are the negative ones: that the plaintext
 * secret is nowhere it should not be, and that a credential stops working the
 * instant it is supposed to.
 */
describe.skipIf(!hasDatabase)('API key security', () => {
  let harness: Harness;
  let organizationId: string;
  let projectId: string;
  let owner: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    const org = await createTestOrganization(harness.app, 'keys');
    organizationId = org.organizationId;
    owner = org.owner;
    projectId = await createTestProject(harness.app, organizationId, owner.token, 'keys');
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  describe('authentication', () => {
    it('authenticates a valid key and reports it accurately', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        environment: 'TEST',
        scopes: ['payments:read', 'endpoints:write'],
      });

      const result = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: key.secret,
      });

      expect(result.status).toBe(200);
      expect(result.body['data']).toMatchObject({
        type: 'api_key',
        apiKeyId: key.id,
        organizationId,
        projectId,
        environment: 'TEST',
        scopes: ['payments:read', 'endpoints:write'],
      });
    });

    it.each([
      ['meter_test_' + 'A'.repeat(43), 'well-formed but unknown'],
      ['meter_live_' + 'B'.repeat(43), 'unknown live key'],
      ['meter_test_short', 'too short to be a key'],
      ['not-a-key-at-all', 'not our format'],
      ['meter_prod_' + 'A'.repeat(43), 'unknown environment prefix'],
      ['bearer meter_test_' + 'A'.repeat(43), 'doubled scheme'],
    ])('rejects %s (%s)', async (candidate) => {
      const result = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: candidate,
      });
      expect(result.status).toBe(401);
    });

    it('requires a credential at all', async () => {
      const result = await call(harness.app, { method: 'GET', url: '/v1/me' });
      expect(result.status).toBe(401);
      expect((result.body['error'] as { code: string }).code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('does not distinguish an unknown key from a wrong secret', async () => {
      // Both must be INVALID_API_KEY. A different code for "this prefix exists"
      // would let an attacker confirm guesses.
      const unknownA = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: 'meter_test_' + 'C'.repeat(43),
      });
      const unknownB = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: 'meter_test_' + 'D'.repeat(43),
      });
      expect(unknownA.status).toBe(401);
      expect(unknownB.status).toBe(401);
      expect((unknownA.body['error'] as { code: string }).code).toBe(
        (unknownB.body['error'] as { code: string }).code,
      );
      expect((unknownA.body['error'] as { code: string }).code).toBe('INVALID_API_KEY');
    });
  });

  describe('revocation takes effect immediately', () => {
    it('stops authenticating a revoked key', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        name: 'to be revoked',
      });

      expect(
        (await call(harness.app, { method: 'GET', url: '/v1/me', token: key.secret })).status,
      ).toBe(200);

      const revoked = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${projectId}/api-keys/${key.id}`,
        token: owner.token,
      });
      expect(revoked.status).toBe(200);

      // No cache, no grace period: the very next request fails.
      const after = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: key.secret,
      });
      expect(after.status).toBe(401);
      expect((after.body['error'] as { code: string }).code).toBe('API_KEY_REVOKED');
    });

    it('reports a second revocation as not found rather than succeeding twice', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, { name: 'twice' });
      await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${projectId}/api-keys/${key.id}`,
        token: owner.token,
      });
      const second = await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${projectId}/api-keys/${key.id}`,
        token: owner.token,
      });
      expect(second.status).toBe(404);
    });
  });

  describe('expiry', () => {
    it('refuses a key past its expiry even while still marked ACTIVE', async () => {
      /*
       * The materialised EXPIRED status is set by a periodic sweeper, so there
       * is always a window where an expired key is still ACTIVE in the table.
       * Authentication computes expiry from `expires_at` on every request
       * precisely so that window is not exploitable.
       */
      const key = await createTestApiKey(harness.app, projectId, owner.token, { name: 'expiring' });
      await harness.handle.db
        .update(apiKeys)
        .set({ expiresAt: new Date(Date.now() - 1000), status: 'ACTIVE' })
        .where(eq(apiKeys.id, key.id));

      const result = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: key.secret,
      });
      expect(result.status).toBe(401);
      expect((result.body['error'] as { code: string }).code).toBe('API_KEY_EXPIRED');
    });

    it('accepts a key whose expiry is still in the future', async () => {
      const created = await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectId}/api-keys`,
        token: owner.token,
        payload: {
          name: 'future expiry',
          environment: 'TEST',
          scopes: [],
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      });
      expect(created.status).toBe(201);
      const secret = (created.body['data'] as { secret: string }).secret;
      expect(
        (await call(harness.app, { method: 'GET', url: '/v1/me', token: secret })).status,
      ).toBe(200);
    });
  });

  describe('rotation', () => {
    it('issues a working replacement and kills the original atomically', async () => {
      const original = await createTestApiKey(harness.app, projectId, owner.token, {
        name: 'rotate me',
        scopes: ['payments:read', 'analytics:read'],
      });

      const rotated = await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectId}/api-keys/${original.id}/rotate`,
        token: owner.token,
      });
      expect(rotated.status).toBe(201);

      const replacement = rotated.body['data'] as {
        id: string;
        secret: string;
        scopes: string[];
        rotatedFromKeyId: string;
      };

      // Scopes carry over unchanged: rotation replaces a credential, it does
      // not silently widen or narrow what that credential may do.
      expect(replacement.scopes).toEqual(['payments:read', 'analytics:read']);
      expect(replacement.rotatedFromKeyId).toBe(original.id);
      expect(replacement.secret).not.toBe(original.secret);

      expect(
        (await call(harness.app, { method: 'GET', url: '/v1/me', token: replacement.secret }))
          .status,
      ).toBe(200);

      const old = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: original.secret,
      });
      expect(old.status).toBe(401);
      expect((old.body['error'] as { code: string }).code).toBe('API_KEY_REVOKED');
    });

    it('refuses to rotate an already-revoked key', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, { name: 'dead' });
      await call(harness.app, {
        method: 'DELETE',
        url: `/v1/projects/${projectId}/api-keys/${key.id}`,
        token: owner.token,
      });
      const result = await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectId}/api-keys/${key.id}/rotate`,
        token: owner.token,
      });
      expect(result.status).toBe(409);
    });
  });

  describe('the plaintext secret exists in exactly one place', () => {
    it('is returned on creation and never again', async () => {
      const created = await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectId}/api-keys`,
        token: owner.token,
        payload: { name: 'once only', environment: 'TEST', scopes: [] },
      });
      const secret = (created.body['data'] as { secret: string }).secret;
      expect(secret).toMatch(/^meter_test_[A-Za-z0-9_-]{43}$/);

      const list = await call(harness.app, {
        method: 'GET',
        url: `/v1/projects/${projectId}/api-keys`,
        token: owner.token,
      });
      expect(list.status).toBe(200);
      expect(list.raw).not.toContain(secret);
      // Nor the hash, nor any field that could substitute for one.
      expect(list.raw).not.toContain('keyHash');
      expect(list.raw).not.toContain('key_hash');
      expect(list.raw).not.toContain('secret');

      const listed = (list.body['data'] as Array<Record<string, unknown>>)[0];
      expect(listed).toHaveProperty('maskedKey');
      expect(String(listed!['maskedKey'])).toMatch(/^meter_test_\.\.\.[A-Za-z0-9_-]{4}$/);
    });

    it('is not stored anywhere in the database', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        name: 'db scan',
      });

      // Casting the whole row to text catches a secret hiding in a column this
      // test does not know the name of.
      const rows = await harness.handle.sql`
        SELECT count(*)::int AS hits FROM api_keys
        WHERE api_keys::text LIKE ${'%' + key.secret + '%'}
      `;
      expect(rows[0]?.['hits']).toBe(0);

      const stored = await harness.handle.db
        .select({ hash: apiKeys.keyHash })
        .from(apiKeys)
        .where(eq(apiKeys.id, key.id));
      expect(stored[0]?.hash).toBeDefined();
      expect(stored[0]?.hash).not.toContain(key.secret);
      expect(stored[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is not present in any audit event', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        name: 'audit scan',
      });
      await call(harness.app, {
        method: 'POST',
        url: `/v1/projects/${projectId}/api-keys/${key.id}/rotate`,
        token: owner.token,
      });

      const rows = await harness.handle.sql`
        SELECT count(*)::int AS hits FROM audit_events
        WHERE audit_events::text LIKE ${'%' + key.secret + '%'}
      `;
      expect(rows[0]?.['hits']).toBe(0);
    });

    it('records the key lifecycle in the audit log', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        name: 'audited',
      });
      const events = await harness.handle.db
        .select({ action: auditEvents.action, resourceId: auditEvents.resourceId })
        .from(auditEvents)
        .where(eq(auditEvents.resourceId, key.id));

      expect(events.map((event) => event.action)).toContain('api_key.created');
    });
  });

  describe('environment', () => {
    it('mints TEST and LIVE keys with distinguishable prefixes', async () => {
      const test = await createTestApiKey(harness.app, projectId, owner.token, {
        environment: 'TEST',
        name: 'env test',
      });
      const live = await createTestApiKey(harness.app, projectId, owner.token, {
        environment: 'LIVE',
        name: 'env live',
      });

      expect(test.secret.startsWith('meter_test_')).toBe(true);
      expect(live.secret.startsWith('meter_live_')).toBe(true);

      // The environment is legible from the credential itself, without a
      // database lookup — which is what lets a test key be rejected from a live
      // operation cheaply.
      const testPrincipal = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: test.secret,
      });
      const livePrincipal = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: live.secret,
      });
      expect((testPrincipal.body['data'] as { environment: string }).environment).toBe('TEST');
      expect((livePrincipal.body['data'] as { environment: string }).environment).toBe('LIVE');
    });
  });

  describe('scopes', () => {
    it('records exactly the scopes requested', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        scopes: ['payments:read', 'webhooks:write'],
        name: 'scoped',
      });
      const principal = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: key.secret,
      });
      expect((principal.body['data'] as { scopes: string[] }).scopes).toEqual([
        'payments:read',
        'webhooks:write',
      ]);
    });

    it('mints a key with no scopes, which authenticates but authorises nothing', async () => {
      // Authentication and authorization are separate: a scopeless key is a
      // valid credential that can do nothing but describe itself.
      const key = await createTestApiKey(harness.app, projectId, owner.token, {
        scopes: [],
        name: 'scopeless',
      });
      const principal = await call(harness.app, {
        method: 'GET',
        url: '/v1/me',
        token: key.secret,
      });
      expect(principal.status).toBe(200);
      expect((principal.body['data'] as { scopes: string[] }).scopes).toEqual([]);
    });

    it.each([['members:remove'], ['organization:delete'], ['api_keys:create'], ['*']])(
      'refuses to mint a key with the escalating scope %s',
      async (scope) => {
        const result = await call(harness.app, {
          method: 'POST',
          url: `/v1/projects/${projectId}/api-keys`,
          token: owner.token,
          payload: { name: 'escalation', environment: 'TEST', scopes: [scope] },
        });
        expect(result.status).toBe(422);
      },
    );
  });

  describe('key usage tracking', () => {
    it('records last-used on first authentication', async () => {
      const key = await createTestApiKey(harness.app, projectId, owner.token, { name: 'touch' });
      await call(harness.app, { method: 'GET', url: '/v1/me', token: key.secret });

      // The write is fire-and-forget, so allow it to settle.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const rows = await harness.handle.db
        .select({ lastUsedAt: apiKeys.lastUsedAt })
        .from(apiKeys)
        .where(eq(apiKeys.id, key.id));
      expect(rows[0]?.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe('database-level guarantees', () => {
    it('refuses two keys with the same hash', async () => {
      // A duplicate hash would mean either a CSPRNG collision or a bug, and
      // authenticating ambiguously is worse than failing.
      const key = await createTestApiKey(harness.app, projectId, owner.token, { name: 'dupe' });
      const [existing] = await harness.handle.db
        .select({ hash: apiKeys.keyHash })
        .from(apiKeys)
        .where(eq(apiKeys.id, key.id));

      await expect(
        harness.handle.sql`
          INSERT INTO api_keys (id, organization_id, project_id, name, prefix, key_hash, last_four, environment)
          VALUES ('key_dupe_probe', ${organizationId}, ${projectId}, 'dupe probe', 'meter_test',
                  ${existing!.hash}, 'aaaa', 'TEST')
        `,
      ).rejects.toThrow();
    });
  });
});
