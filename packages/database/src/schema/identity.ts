import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import {
  memberRoleEnum,
  membershipStatusEnum,
  organizationStatusEnum,
  planEnum,
  projectStatusEnum,
  userStatusEnum,
} from './enums.js';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** As the user typed it. Shown back to them; never used for lookup. */
    email: text('email').notNull(),
    /**
     * Lowercased and trimmed. This is the column with the unique constraint
     * and the only one ever used to find a user.
     *
     * Uniqueness on the raw address would let `Alice@example.com` and
     * `alice@example.com` both register, which is an account-takeover vector
     * the moment any part of the system treats them as the same person.
     * Normalising in the application and constraining in the database means
     * neither layer can be bypassed by the other.
     */
    emailNormalized: text('email_normalized').notNull(),
    /*
     * The user's display name.
     *
     * Mapped to the existing physical column `name` rather than renamed to
     * `display_name`. The rename is purely cosmetic, and drizzle-kit cannot
     * distinguish a rename from a drop-plus-add without an interactive prompt,
     * which would make migration generation non-reproducible in CI. Paying
     * that cost for a column alias is a bad trade, so the domain gets the name
     * it wants and the database keeps the column it has.
     */
    displayName: text('name'),
    status: userStatusEnum('status').notNull().default('PENDING_VERIFICATION'),
    emailVerifiedAt: tsColumn('email_verified_at'),
    /** Set when the user disables their own account; preserves audit history. */
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [uniqueIndex('users_email_normalized_unique').on(table.emailNormalized)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: organizationStatusEnum('status').notNull().default('ACTIVE'),
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
  (table) => [
    uniqueIndex('organizations_slug_unique').on(table.slug),
    index('organizations_status_idx').on(table.status),
  ],
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
    status: membershipStatusEnum('status').notNull().default('INVITED'),
    invitedByUserId: text('invited_by_user_id'),
    acceptedAt: tsColumn('accepted_at'),
    ...auditTimestamps,
  },
  (table) => [
    /*
     * One membership row per (organization, user), enforced by the database.
     *
     * Two rows for the same person would create a "which role wins" ambiguity
     * that an attacker could resolve in their favour by racing two invitation
     * acceptances. The role and status are columns on a single row precisely so
     * that question can never arise. Removal sets status to REMOVED rather than
     * deleting, so re-invitation reuses the row and the history survives.
     */
    uniqueIndex('organization_members_unique').on(table.organizationId, table.userId),
    index('organization_members_user_idx').on(table.userId),
    // Serves the "who are the active owners" query the owner invariant runs
    // inside every membership-changing transaction.
    index('organization_members_org_role_status_idx').on(
      table.organizationId,
      table.role,
      table.status,
    ),
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
    status: projectStatusEnum('status').notNull().default('ACTIVE'),
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
    index('projects_org_status_idx').on(table.organizationId, table.status),
  ],
);
