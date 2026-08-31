import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { merchantEnvironmentEnum } from './enums.js';
import { organizations, projects } from './identity.js';

/**
 * API keys.
 *
 * The plaintext secret is shown exactly once, at creation, and never stored.
 * `keyHash` is an HMAC-SHA256 of the secret under a server-side pepper held
 * in the secret store — see docs/DATABASE.md for why a fast keyed hash is the
 * right choice here and a slow KDF (bcrypt/Argon2) is not.
 *
 * `lastFour` exists so the dashboard can show `meter_test_…a4f9` for
 * recognition. It is short enough to be useless to an attacker and long enough
 * to disambiguate keys in a list.
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
    /** `meter_test` or `meter_live`. Indexed; the lookup key on the auth hot path. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    lastFour: text('last_four').notNull(),
    environment: merchantEnvironmentEnum('environment').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    createdByUserId: text('created_by_user_id'),
    expiresAt: tsColumn('expires_at'),
    lastUsedAt: tsColumn('last_used_at'),
    revokedAt: tsColumn('revoked_at'),
    ...auditTimestamps,
  },
  (table) => [
    // The hash is unique across the table: two keys hashing identically would
    // mean a collision or a duplicate insert, and either must fail loudly.
    uniqueIndex('api_keys_hash_unique').on(table.keyHash),
    index('api_keys_prefix_idx').on(table.prefix),
    index('api_keys_org_idx').on(table.organizationId),
    index('api_keys_project_idx').on(table.projectId),
  ],
);
