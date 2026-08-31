import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { agentStatusEnum } from './enums.js';
import { organizations } from './identity.js';

/**
 * An agent is a counterparty we have observed paying, identified by a wallet
 * and/or an external ID the merchant supplies.
 *
 * Nothing here asserts legal identity, and no column should ever imply that we
 * have verified one. We record what we saw; KYC/KYB is a separate,
 * unimplemented integration point.
 */
export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Merchant-assigned identifier, if they have one. */
    externalId: text('external_id'),
    displayName: text('display_name'),
    agentType: text('agent_type'),
    /** Lowercased payer address. Our most reliable correlation key. */
    walletAddress: text('wallet_address'),
    status: agentStatusEnum('status').notNull().default('ACTIVE'),
    metadata: jsonb('metadata').notNull().default({}),
    firstSeenAt: tsColumn('first_seen_at').notNull().defaultNow(),
    lastSeenAt: tsColumn('last_seen_at').notNull().defaultNow(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('agents_org_wallet_unique').on(table.organizationId, table.walletAddress),
    index('agents_org_external_idx').on(table.organizationId, table.externalId),
    index('agents_status_idx').on(table.status),
  ],
);

/** A customer groups agents under a billing relationship the merchant recognises. */
export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    name: text('name').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('customers_org_external_unique').on(table.organizationId, table.externalId),
    index('customers_org_idx').on(table.organizationId),
  ],
);

export const walletReferences = pgTable(
  'wallet_references',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    chainId: text('chain_id').notNull(),
    address: text('address').notNull(),
    label: text('label'),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('wallet_references_unique').on(table.organizationId, table.chainId, table.address),
  ],
);
