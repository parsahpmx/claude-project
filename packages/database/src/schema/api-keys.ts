import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { apiKeyStatusEnum, merchantEnvironmentEnum } from './enums.js';
import { organizations, projects, users } from './identity.js';

/**
 * API keys.
 *
 * The plaintext secret is shown exactly once, at creation, and never stored,
 * logged, or placed in an audit event. `keyHash` is an HMAC-SHA256 of the
 * secret under a server-side pepper held in the secret store.
 *
 * On lookup. Phase 0's documentation said authentication looks up by `prefix`
 * and then compares hashes. That does not work: `prefix` is `meter_test` or
 * `meter_live`, shared by every key, so it selects the whole table. Because
 * the HMAC is deterministic (no per-row salt), the correct lookup is a direct
 * equality probe on `key_hash` — O(1) against the unique index below — with
 * the constant-time comparison retained afterwards as defence in depth. The
 * hashing strategy itself is unchanged and remains right for the reasons
 * recorded in docs/DATABASE.md.
 *
 * `lastFour` exists so the dashboard can show `meter_test_…a4f9` for
 * recognition. Four base64url characters is 24 bits, leaving well over 200
 * bits of the secret unexposed.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** `meter_test` or `meter_live`. Non-secret; display and filtering only. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    lastFour: text('last_four').notNull(),
    environment: merchantEnvironmentEnum('environment').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    status: apiKeyStatusEnum('status').notNull().default('ACTIVE'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * Set on the replacement when a key is rotated, so the audit trail links
     * a live credential back to the one it superseded. Intentionally not a
     * foreign key: the superseded key may later be pruned, and losing the
     * lineage pointer should not block that.
     */
    rotatedFromKeyId: text('rotated_from_key_id'),
    expiresAt: tsColumn('expires_at'),
    lastUsedAt: tsColumn('last_used_at'),
    revokedAt: tsColumn('revoked_at'),
    ...auditTimestamps,
  },
  (table) => [
    /*
     * The authentication lookup index. Unique because two keys hashing
     * identically would mean either a CSPRNG collision or a duplicate insert,
     * and both must fail loudly rather than authenticate ambiguously.
     */
    uniqueIndex('api_keys_hash_unique').on(table.keyHash),
    index('api_keys_org_idx').on(table.organizationId),
    // Serves the project key list, which is always scoped to one project.
    index('api_keys_project_status_idx').on(table.projectId, table.status),
  ],
);
