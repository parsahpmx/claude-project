import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { auditTimestamps, minorUnits, tsColumn } from './columns.js';
import { planEnum } from './enums.js';
import { organizations } from './identity.js';

/**
 * Meter402's own SaaS billing.
 *
 * Deliberately an abstraction over an external billing provider rather than a
 * billing engine. Building our own subscription billing while also building
 * payment infrastructure would be two products; this table holds the state we
 * need to enforce plan limits, and the provider owns invoicing.
 *
 * Plan prices are configuration, not constants in code (product rule 103).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    plan: planEnum('plan').notNull().default('FREE'),
    status: text('status').notNull().default('active'),
    externalProvider: text('external_provider'),
    externalSubscriptionId: text('external_subscription_id'),
    currentPeriodStart: tsColumn('current_period_start'),
    currentPeriodEnd: tsColumn('current_period_end'),
    cancelAt: tsColumn('cancel_at'),
    /** Plan limits, denormalised so enforcement needs no provider round trip. */
    limits: jsonb('limits').notNull().default({}),
    ...auditTimestamps,
  },
  (table) => [index('subscriptions_org_idx').on(table.organizationId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    number: text('number').notNull(),
    /** Fiat minor units (cents), same integer discipline as on-chain amounts. */
    amountMinorUnits: minorUnits('amount_minor_units').notNull(),
    currency: text('currency').notNull().default('USD'),
    currencyDecimals: integer('currency_decimals').notNull().default(2),
    status: text('status').notNull().default('draft'),
    periodStart: tsColumn('period_start'),
    periodEnd: tsColumn('period_end'),
    dueAt: tsColumn('due_at'),
    paidAt: tsColumn('paid_at'),
    ...auditTimestamps,
  },
  (table) => [index('invoices_org_created_idx').on(table.organizationId, table.createdAt)],
);
