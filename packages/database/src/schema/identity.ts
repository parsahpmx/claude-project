import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { memberRoleEnum, planEnum } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    emailVerifiedAt: tsColumn('email_verified_at'),
    /** Set when the user disables their own account; preserves audit history. */
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [
    // Lowercased at the application layer before write. A case-sensitive
    // unique index would let alice@ and Alice@ both register.
    uniqueIndex('users_email_unique').on(table.email),
  ],
);

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: planEnum('plan').notNull().default('FREE'),
    /**
     * Where confirmed payments settle. The single highest-value field a
     * merchant owns: changing it redirects all future revenue. Changes require
     * confirmation, emit an audit event, and notify owners (threat T7).
     */
    settlementAddress: text('settlement_address'),
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [uniqueIndex('organizations_slug_unique').on(table.slug)],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('VIEWER'),
    invitedByUserId: text('invited_by_user_id'),
    acceptedAt: tsColumn('accepted_at'),
    ...auditTimestamps,
  },
  (table) => [
    // One membership per user per organization; the role is a column, not a
    // second row, so there is no "which role wins" ambiguity.
    uniqueIndex('organization_members_unique').on(table.organizationId, table.userId),
    index('organization_members_user_idx').on(table.userId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    /**
     * Whether LIVE mode has been enabled for this project. Kept explicit
     * rather than inferred from the presence of a live key, so the transition
     * is an auditable event.
     */
    liveModeEnabled: boolean('live_mode_enabled').notNull().default(false),
    settlementAddress: text('settlement_address'),
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('projects_org_slug_unique').on(table.organizationId, table.slug),
    index('projects_org_idx').on(table.organizationId),
  ],
);
