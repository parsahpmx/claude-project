import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { reconciliationStatusEnum } from './enums.js';
import { organizations } from './identity.js';
import { paymentRequests } from './payments.js';

/**
 * Reconciliation of uncertain settlements.
 *
 * ── The problem ──────────────────────────────────────────────────────────
 * A facilitator `/settle` call can succeed remotely while the response is
 * lost. Meter402 correctly refuses to guess and moves the request to PENDING.
 * But PENDING must not be terminal-by-neglect: on a testnet an unresolved
 * PENDING is an annoyance, on mainnet it is a customer whose money may have
 * moved and whose request was never served.
 *
 * This table is the durable work queue that closes them out.
 *
 * ── Why a table and not an in-memory queue ───────────────────────────────
 * The uncertainty is created by a process that may itself be about to crash —
 * that is often *why* the response was lost. A queue that lives in the same
 * process would be lost with it. The row is written in the same transaction
 * that records the uncertainty, so a payment cannot become uncertain without
 * simultaneously becoming scheduled for resolution.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 * `UNIQUE (payment_request_id)` means one payment request has exactly one
 * reconciliation record, forever. Enqueuing twice is a no-op rather than a
 * second job, so a retry storm cannot multiply the work — or the effects.
 */
export const settlementReconciliations = pgTable(
  'settlement_reconciliations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),

    status: reconciliationStatusEnum('status').notNull().default('PENDING'),

    /*
     * Everything needed to ask the chain what happened, without re-reading a
     * signed payload. These are the identifying facts of the authorization,
     * not the authorization itself: the signature is deliberately absent, as
     * a stored signature is a bearer instrument.
     */
    facilitator: text('facilitator'),
    chainId: integer('chain_id').notNull(),
    assetAddress: text('asset_address').notNull(),
    payerAddress: text('payer_address').notNull(),
    authorizationNonce: text('authorization_nonce').notNull(),
    recipientAddress: text('recipient_address').notNull(),
    amountMinorUnits: text('amount_minor_units').notNull(),

    /** The authorization deadline. After it passes, an unused nonce is final. */
    validBefore: tsColumn('valid_before'),

    /** Known only once reconciliation or settlement finds it. */
    transactionHash: text('transaction_hash'),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(12),
    /** Exponential backoff. A worker only claims rows whose time has come. */
    nextAttemptAt: tsColumn('next_attempt_at').notNull().defaultNow(),
    lastAttemptAt: tsColumn('last_attempt_at'),
    /** Human-readable outcome of the last attempt. Never a secret. */
    lastResult: text('last_result'),

    resolvedAt: tsColumn('resolved_at'),

    ...auditTimestamps,
  },
  (table) => [
    /*
     * The idempotency guarantee. One reconciliation per payment request, so
     * enqueuing is safe to repeat and can never fan out into duplicate
     * economic effects.
     */
    uniqueIndex('settlement_reconciliations_request_unique').on(table.paymentRequestId),
    /*
     * The claim index. Workers select PENDING rows whose nextAttemptAt has
     * passed, oldest first — so this composite is the one the queue query
     * actually uses.
     */
    index('settlement_reconciliations_claim_idx').on(table.status, table.nextAttemptAt),
    index('settlement_reconciliations_org_idx').on(table.organizationId, table.status),
  ],
);
