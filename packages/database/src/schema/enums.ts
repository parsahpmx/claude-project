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

/* --- Phase 1: lifecycle states for identity and access ------------------- */

/**
 * A user is PENDING_VERIFICATION until their email is confirmed, and DISABLED
 * rather than deleted when access is withdrawn — deleting the row would take
 * their audit history with it.
 */
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DISABLED', 'PENDING_VERIFICATION']);

export const organizationStatusEnum = pgEnum('organization_status', [
  'ACTIVE',
  'SUSPENDED',
  'DELETED',
]);

/**
 * Membership is the sole source of organization access. Only ACTIVE authorizes
 * anything: INVITED has not accepted, SUSPENDED and REMOVED have had authority
 * withdrawn. Mirrors MembershipStatus in @meter402/auth.
 */
export const membershipStatusEnum = pgEnum('membership_status', [
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
  'REMOVED',
]);

export const projectStatusEnum = pgEnum('project_status', ['ACTIVE', 'ARCHIVED', 'SUSPENDED']);

/**
 * EXPIRED is materialised by a sweeper for reporting; authentication computes
 * expiry from `expires_at` on every request rather than trusting this column,
 * so a key whose sweep has not yet run still fails closed.
 */
export const apiKeyStatusEnum = pgEnum('api_key_status', ['ACTIVE', 'REVOKED', 'EXPIRED']);

/* --- Phase 2: paid endpoints and payment execution --------------------- */

/**
 * The closed HTTP method vocabulary a merchant may price.
 *
 * A database enum rather than free text: an arbitrary method string reaching
 * a route-matching comparison is a correctness hazard, and "GET " with a
 * trailing space silently defining a second endpoint is exactly the kind of
 * near-duplicate the uniqueness invariant is meant to prevent.
 */
export const httpMethodEnum = pgEnum('http_method', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * DISABLED stops new payment requests but leaves history intact and can be
 * reversed; ARCHIVED is the terminal retirement state. Neither deletes the
 * row, because endpoints own payments and receipts.
 */
export const endpointStatusEnum = pgEnum('endpoint_status', ['ACTIVE', 'DISABLED', 'ARCHIVED']);
