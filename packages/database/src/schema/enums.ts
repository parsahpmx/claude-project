import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Native Postgres enums rather than `text` columns.
 *
 * Product rule 134: constraints belong in the database, not only in
 * application checks. An invalid payment status should be impossible to
 * write, not merely unlikely — application-only validation fails the moment
 * anything touches the data outside the application, which eventually
 * everything does (a migration, a backfill script, a support fix).
 *
 * The cost is that adding a value requires a migration. For a payment status
 * that is a feature: it forces the state machine change to be reviewed.
 */

export const merchantEnvironmentEnum = pgEnum('merchant_environment', ['TEST', 'LIVE']);

export const memberRoleEnum = pgEnum('member_role', [
  'OWNER',
  'ADMIN',
  'DEVELOPER',
  'ANALYST',
  'BILLING',
  'VIEWER',
]);

export const planEnum = pgEnum('plan', ['FREE', 'STARTUP', 'GROWTH', 'ENTERPRISE']);

/** Mirrors PaymentStatus in @meter402/payments. The two must not drift. */
export const paymentStatusEnum = pgEnum('payment_status', [
  'CREATED',
  'CHALLENGE_ISSUED',
  'PENDING',
  'SUBMITTED',
  'CONFIRMING',
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
]);

export const pricingKindEnum = pgEnum('pricing_kind', ['FIXED']);

export const agentStatusEnum = pgEnum('agent_status', ['ACTIVE', 'BLOCKED', 'REVIEW']);

export const usageUnitEnum = pgEnum('usage_unit', [
  'REQUEST',
  'TOKEN',
  'BYTE',
  'SECOND',
  'COMPUTE_UNIT',
  'GPU_SECOND',
  'CUSTOM',
]);

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'PENDING',
  'DELIVERED',
  'FAILED',
  'EXHAUSTED',
]);

export const riskDecisionEnum = pgEnum('risk_decision', ['ALLOW', 'REVIEW', 'DENY']);

export const settlementStatusEnum = pgEnum('settlement_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'REQUESTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const idempotencyStatusEnum = pgEnum('idempotency_status', ['IN_FLIGHT', 'COMPLETED']);

export const outboxStatusEnum = pgEnum('outbox_status', ['PENDING', 'PUBLISHED', 'FAILED']);
