/**
 * Domain events.
 *
 * These are the internal events the modular monolith publishes (product rule
 * 146) and, for the public subset, the webhook event types merchants
 * subscribe to (rule 36). They are the same vocabulary on purpose: a webhook
 * is a domain event that crossed the trust boundary.
 *
 * Events are written to a transactional outbox in the same database
 * transaction as the state change that produced them (rule 147), so a
 * committed payment can never lose its webhook. Delivery is a separate,
 * retrying worker.
 *
 * Every event carries an explicit `schemaVersion`. Consumers are merchant
 * code we do not control and cannot redeploy, so the payload shape for a
 * given version is frozen once shipped; additive changes bump nothing,
 * breaking changes publish a new version alongside the old.
 */

export const DOMAIN_EVENT_TYPES = [
  'payment.created',
  'payment.challenge_issued',
  'payment.submitted',
  'payment.confirming',
  'payment.confirmed',
  'payment.failed',
  'payment.expired',
  'payment.refunded',
  'receipt.created',
  'endpoint.created',
  'endpoint.updated',
  'endpoint.deleted',
  'api_key.created',
  'api_key.revoked',
  'settlement.created',
  'settlement.completed',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export function isDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

export interface DomainEvent<TData = Record<string, unknown>> {
  readonly id: string;
  readonly type: DomainEventType;
  readonly schemaVersion: number;
  /** Tenant scope. Every event belongs to exactly one organization. */
  readonly organizationId: string;
  readonly projectId: string | null;
  /** RFC 3339 UTC timestamp. */
  readonly occurredAt: string;
  /** Correlates the event with the API request that caused it. */
  readonly requestId: string | null;
  readonly data: TData;
}

export const CURRENT_EVENT_SCHEMA_VERSION = 1;
