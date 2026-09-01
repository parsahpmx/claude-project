import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { settlementConfigStatusEnum } from './enums.js';
import { organizations, projects, users } from './identity.js';
import { paymentRequests } from './payments.js';

/**
 * Where a merchant's money goes.
 *
 * Phase 2 stored a single `settlement_address` on the organization and the
 * project. That was enough when nothing settled for real. It is not enough
 * now: a merchant testing on Base Sepolia and earning on Base mainnet needs
 * different destinations, and conflating them is how testnet configuration
 * ends up receiving production revenue.
 *
 * So a settlement destination is keyed by `(organization, project, chain,
 * asset)`. A row with a null `project_id` is the organization-wide default for
 * that chain and asset.
 *
 * Mutation of this table is **human-only** and audited. An API key must never
 * be able to change it: a compromised machine credential that could repoint
 * settlement would turn a leaked key into a direct theft of all future
 * revenue, which is a categorically worse outcome than the same key spending
 * its own balance.
 */
export const settlementConfigurations = pgTable(
  'settlement_configurations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null means "the organization default for this chain and asset". */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),

    chainId: integer('chain_id').notNull(),
    assetSymbol: text('asset_symbol').notNull(),
    recipientAddress: text('recipient_address').notNull(),

    status: settlementConfigStatusEnum('status').notNull().default('ACTIVE'),

    /**
     * The human who created it. Not nullable by accident: every settlement
     * destination must be attributable to a person, because "who pointed our
     * revenue at this address" is the first question asked after an incident.
     */
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),

    ...auditTimestamps,
  },
  (table) => [
    /*
     * One destination per (organization, project, chain, asset). Postgres
     * treats NULLs as distinct in a unique index, so the organization-level
     * row (project_id IS NULL) needs its own partial index to stay unique —
     * without it a merchant could accumulate several conflicting org-level
     * defaults and settlement would depend on row order.
     */
    uniqueIndex('settlement_config_project_unique')
      .on(table.organizationId, table.projectId, table.chainId, table.assetSymbol)
      .where(sql`${table.projectId} IS NOT NULL`),
    uniqueIndex('settlement_config_org_unique')
      .on(table.organizationId, table.chainId, table.assetSymbol)
      .where(sql`${table.projectId} IS NULL`),
    index('settlement_config_org_idx').on(table.organizationId, table.chainId),
  ],
);

/**
 * Claimed signed payment authorizations.
 *
 * This is the replay guard for the **pre-settlement** half of the x402
 * authorization flow, and it protects something the existing transaction-hash
 * guard cannot.
 *
 * The problem it solves: an EIP-3009 authorization is a bearer instrument. It
 * is signed by the payer and valid until `validBefore`, and anyone who
 * observes one can present it again. The transaction-hash guard only engages
 * *after* settlement produces a hash, which leaves a window in which the same
 * signed authorization could be submitted against several payment requests
 * concurrently — each passing verification, each proceeding to settle.
 *
 * The uniqueness identity is the one the EIP-3009 scheme itself uses to make
 * an authorization single-use on-chain: `(chain, token, payer, nonce)`. The
 * token contract will reject the second submission, but by then we would
 * already have served the resource, so we claim it here first.
 */
export const paymentAuthorizations = pgTable(
  'payment_authorizations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),

    protocol: text('protocol').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    scheme: text('scheme').notNull(),

    chainId: integer('chain_id').notNull(),
    assetAddress: text('asset_address').notNull(),
    payerAddress: text('payer_address').notNull(),
    /** The EIP-3009 authorization nonce. 32 bytes, lowercase hex. */
    authorizationNonce: text('authorization_nonce').notNull(),

    validAfter: tsColumn('valid_after'),
    validBefore: tsColumn('valid_before'),

    facilitator: text('facilitator'),

    ...auditTimestamps,
  },
  (table) => [
    /*
     * The guarantee. An atomic INSERT ... ON CONFLICT DO NOTHING against this
     * index is what makes claiming an authorization a single indivisible step
     * rather than a check followed by a write.
     *
     * Note what is NOT in the key: the payment request. Including it would let
     * the same authorization be claimed once per request, which is exactly the
     * attack.
     */
    uniqueIndex('payment_authorizations_unique').on(
      table.chainId,
      table.assetAddress,
      table.payerAddress,
      table.authorizationNonce,
    ),
    index('payment_authorizations_request_idx').on(table.paymentRequestId),
    index('payment_authorizations_payer_idx').on(table.organizationId, table.payerAddress),
  ],
);
