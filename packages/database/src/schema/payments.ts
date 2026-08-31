import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, minorUnits, tsColumn } from './columns.js';
import { merchantEnvironmentEnum, paymentStatusEnum, refundStatusEnum } from './enums.js';
import { organizations, projects } from './identity.js';
import { endpoints } from './endpoints.js';
import { agents, customers } from './agents.js';

/**
 * A merchant's statement of what must be paid.
 *
 * Asset details (symbol, decimals, address, chain) are denormalised onto the
 * row rather than joined from a registry. That is deliberate: a payment is a
 * financial record, and it must still render and reconcile correctly years
 * later even if the asset registry changes. A historical payment should never
 * change meaning because a lookup table was edited.
 */
export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    environment: merchantEnvironmentEnum('environment').notNull(),

    amountMinorUnits: minorUnits('amount_minor_units').notNull(),
    assetSymbol: text('asset_symbol').notNull(),
    assetAddress: text('asset_address').notNull(),
    assetDecimals: integer('asset_decimals').notNull(),
    chainId: integer('chain_id').notNull(),
    recipientAddress: text('recipient_address').notNull(),

    /** Binds a proof to this specific challenge. Single use. */
    nonce: text('nonce').notNull(),
    /** Short human-facing reference for dashboards and support. */
    reference: text('reference').notNull(),
    protocol: text('protocol').notNull().default('x402'),
    /**
     * Provenance only.
     *
     * Records which pricing rule produced this request's amount, so support
     * can answer "why was this priced at 0.03". It is deliberately NEVER
     * dereferenced during authorization: the amount, asset, decimals, chain,
     * and recipient above are the snapshot, captured as values at issue time.
     * A merchant repricing an endpoint therefore cannot change an outstanding
     * request, because the code path that would re-read the rule does not
     * exist.
     */
    pricingRuleId: text('pricing_rule_id'),

    status: paymentStatusEnum('status').notNull().default('CREATED'),
    expiresAt: tsColumn('expires_at').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    ...auditTimestamps,
  },
  (table) => [
    index('payment_requests_org_created_idx').on(table.organizationId, table.createdAt),
    index('payment_requests_project_status_idx').on(table.projectId, table.status),
    // Drives the expiry sweeper. Kept narrow because it is scanned frequently.
    index('payment_requests_status_expires_idx').on(table.status, table.expiresAt),
    index('payment_requests_agent_idx').on(table.agentId),
    uniqueIndex('payment_requests_nonce_unique').on(table.nonce),
  ],
);

/**
 * Replay protection.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ The UNIQUE (chain_id, transaction_hash) index below IS the replay    │
 * │ protection for the entire platform. It is not a performance index.   │
 * │ It must never be dropped, made non-unique, or have its columns       │
 * │ reordered out of the constraint.                                     │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * `ReplayGuard.claim()` is an INSERT against this constraint. Two concurrent
 * verifications of the same transaction cannot both succeed, because the
 * second one fails at the database. An application-level "SELECT then INSERT"
 * would race, and that race window is exactly what a double-spend attempt
 * aims for.
 */
export const blockchainTransactions = pgTable(
  'blockchain_transactions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),

    chainId: integer('chain_id').notNull(),
    transactionHash: text('transaction_hash').notNull(),
    blockNumber: minorUnits('block_number'),
    blockHash: text('block_hash'),
    fromAddress: text('from_address'),
    toAddress: text('to_address'),
    tokenAddress: text('token_address'),
    amountMinorUnits: minorUnits('amount_minor_units'),
    logIndex: integer('log_index'),
    confirmations: integer('confirmations').notNull().default(0),
    observedAt: tsColumn('observed_at'),
    /**
     * True for a TEST-mode simulated settlement.
     *
     * Simulated settlements share this table on purpose: it means TEST
     * payments are protected by the same UNIQUE (chain_id, transaction_hash)
     * constraint as real ones, so the replay path is genuinely exercised
     * rather than stubbed. The flag keeps the row honest about what it is.
     */
    simulated: boolean('simulated').notNull().default(false),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('blockchain_transactions_chain_hash_unique').on(
      table.chainId,
      table.transactionHash,
    ),
    index('blockchain_transactions_request_idx').on(table.paymentRequestId),
  ],
);

/**
 * A confirmed payment and its ledger view.
 *
 * Fee columns exist from day one even though MVP fees are zero. Adding money
 * columns to a populated payments table later is a migration nobody enjoys,
 * and rule 102 requires fee calculations to be recorded rather than derived
 * at display time — a fee computed on read cannot be reconciled against what
 * was actually charged.
 *
 * Invariant, checked in application code and asserted in tests:
 *   gross = platformFee + networkFee + net
 */
export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    blockchainTransactionId: text('blockchain_transaction_id').references(
      () => blockchainTransactions.id,
      { onDelete: 'restrict' },
    ),
    environment: merchantEnvironmentEnum('environment').notNull(),
    status: paymentStatusEnum('status').notNull(),
    protocol: text('protocol').notNull().default('x402'),
    /** Who paid, as the protocol reports them. Null when the protocol cannot say. */
    payerReference: text('payer_reference'),
    /** On-chain transaction hash, or the synthetic reference in TEST mode. */
    externalTransactionReference: text('external_transaction_reference'),
    /**
     * Whether this payment was settled by the TEST simulator rather than a
     * real transfer. A strongly-typed column rather than an inference from
     * environment or a null transaction hash: analytics, reconciliation, and
     * support all need to exclude simulated value, and each inferring it
     * separately is how one of them eventually gets it wrong.
     */
    simulated: boolean('simulated').notNull().default(false),

    grossAmountMinorUnits: minorUnits('gross_amount_minor_units').notNull(),
    platformFeeMinorUnits: minorUnits('platform_fee_minor_units').notNull().default('0'),
    networkFeeMinorUnits: minorUnits('network_fee_minor_units').notNull().default('0'),
    netAmountMinorUnits: minorUnits('net_amount_minor_units').notNull(),

    assetSymbol: text('asset_symbol').notNull(),
    assetDecimals: integer('asset_decimals').notNull(),
    chainId: integer('chain_id').notNull(),

    confirmedAt: tsColumn('confirmed_at'),
    settlementId: text('settlement_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ...auditTimestamps,
  },
  (table) => [
    // One payment per request. A second would mean charging twice for one
    // challenge.
    uniqueIndex('payments_request_unique').on(table.paymentRequestId),
    index('payments_org_created_idx').on(table.organizationId, table.createdAt),
    index('payments_endpoint_created_idx').on(table.endpointId, table.createdAt),
    index('payments_agent_idx').on(table.agentId),
    index('payments_status_idx').on(table.status),
  ],
);

/**
 * Every verification attempt, successful or not.
 *
 * Failed attempts are the point: repeated invalid proofs against one request
 * are a risk signal, and this is the table support reads when a merchant asks
 * why a payment did not go through.
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'cascade' }),
    transactionHash: text('transaction_hash'),
    succeeded: boolean('succeeded').notNull(),
    failureReason: text('failure_reason'),
    failureDetails: jsonb('failure_details'),
    requestId: text('request_id'),
    sourceIp: text('source_ip'),
    ...auditTimestamps,
  },
  (table) => [
    index('payment_attempts_request_idx').on(table.paymentRequestId, table.createdAt),
    index('payment_attempts_reason_idx').on(table.failureReason),
  ],
);

/** Immutable once written. A receipt that can change is not evidence. */
export const paymentReceipts = pgTable(
  'payment_receipts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),
    projectId: text('project_id'),
    endpointId: text('endpoint_id'),
    environment: merchantEnvironmentEnum('environment'),
    protocol: text('protocol'),
    /*
     * Denormalised snapshot.
     *
     * A receipt is evidence. It must render identically in five years without
     * joining tables whose rows may since have been repriced, archived, or
     * had their asset registry entry changed. Everything needed to read the
     * receipt lives on the receipt.
     */
    amountMinorUnits: minorUnits('amount_minor_units'),
    assetSymbol: text('asset_symbol'),
    assetDecimals: integer('asset_decimals'),
    chainId: integer('chain_id'),
    externalTransactionReference: text('external_transaction_reference'),
    simulated: boolean('simulated').notNull().default(false),
    issuedAt: tsColumn('issued_at').notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('payment_receipts_payment_unique').on(table.paymentId),
    index('payment_receipts_org_idx').on(table.organizationId),
  ],
);

/** Post-MVP. The schema reserves room so the flow does not require a migration later. */
export const refunds = pgTable(
  'refunds',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    amountMinorUnits: minorUnits('amount_minor_units').notNull(),
    status: refundStatusEnum('status').notNull().default('REQUESTED'),
    reason: text('reason'),
    approvedByUserId: text('approved_by_user_id'),
    transactionHash: text('transaction_hash'),
    ...auditTimestamps,
  },
  (table) => [index('refunds_payment_idx').on(table.paymentId)],
);
