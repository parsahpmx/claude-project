import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, minorUnits, tsColumn } from './columns.js';
import {
  idempotencyStatusEnum,
  outboxStatusEnum,
  riskDecisionEnum,
  settlementStatusEnum,
  usageUnitEnum,
  webhookDeliveryStatusEnum,
} from './enums.js';
import { organizations, projects } from './identity.js';
import { endpoints } from './endpoints.js';
import { agents } from './agents.js';
import { payments, paymentRequests } from './payments.js';

export const usageEvents = pgTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    requestId: text('request_id'),
    unit: usageUnitEnum('unit').notNull().default('REQUEST'),
    /** Integer quantity. Fractional usage is expressed by choosing a finer unit. */
    quantity: minorUnits('quantity').notNull().default('1'),
    occurredAt: tsColumn('occurred_at').notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
    ...auditTimestamps,
  },
  (table) => [
    index('usage_events_project_occurred_idx').on(table.projectId, table.occurredAt),
    index('usage_events_endpoint_idx').on(table.endpointId, table.occurredAt),
  ],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /**
     * Per-endpoint HMAC secret. Per-endpoint rather than global so that
     * rotating one merchant's secret, or containing its compromise, does not
     * affect anyone else.
     */
    signingSecret: text('signing_secret').notNull(),
    description: text('description'),
    eventTypes: text('event_types').array().notNull().default([]),
    active: boolean('active').notNull().default(true),
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [index('webhook_endpoints_project_idx').on(table.projectId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    webhookEndpointId: text('webhook_endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    eventId: text('event_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    responseCode: integer('response_code'),
    /**
     * A bounded excerpt, never the full body. A merchant endpoint can return
     * anything, including its own secrets, and we should not become a
     * long-term store of it.
     */
    responseBodySnippet: text('response_body_snippet'),
    lastAttemptAt: tsColumn('last_attempt_at'),
    nextAttemptAt: tsColumn('next_attempt_at'),
    ...auditTimestamps,
  },
  (table) => [
    // The retry sweeper's query shape.
    index('webhook_deliveries_due_idx').on(table.status, table.nextAttemptAt),
    index('webhook_deliveries_endpoint_idx').on(table.webhookEndpointId, table.createdAt),
  ],
);

/**
 * Transactional outbox (product rule 147).
 *
 * Events are inserted in the same transaction as the state change they
 * describe. A separate worker drains this table. That is what makes
 * "payment committed but webhook lost" structurally impossible — a
 * publish-after-commit design cannot offer that guarantee, because the process
 * can die in the gap.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id'),
    eventType: text('event_type').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    publishedAt: tsColumn('published_at'),
    requestId: text('request_id'),
    ...auditTimestamps,
  },
  (table) => [index('outbox_events_status_created_idx').on(table.status, table.createdAt)],
);

export const riskEvaluations = pgTable(
  'risk_evaluations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentRequestId: text('payment_request_id').references(() => paymentRequests.id, {
      onDelete: 'cascade',
    }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    decision: riskDecisionEnum('decision').notNull(),
    /** 0-100. Deterministic rules only; no model output authorises a payment. */
    riskScore: integer('risk_score').notNull().default(0),
    reasonCodes: text('reason_codes').array().notNull().default([]),
    signals: jsonb('signals').notNull().default({}),
    ...auditTimestamps,
  },
  (table) => [
    index('risk_evaluations_request_idx').on(table.paymentRequestId),
    index('risk_evaluations_decision_idx').on(table.decision, table.createdAt),
  ],
);

export const policyRules = pgTable(
  'policy_rules',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    config: jsonb('config').notNull().default({}),
    active: boolean('active').notNull().default(true),
    ...auditTimestamps,
  },
  (table) => [index('policy_rules_org_idx').on(table.organizationId)],
);

export const settlements = pgTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    destinationAddress: text('destination_address').notNull(),
    chainId: integer('chain_id').notNull(),
    assetSymbol: text('asset_symbol').notNull(),
    grossAmountMinorUnits: minorUnits('gross_amount_minor_units').notNull(),
    feeAmountMinorUnits: minorUnits('fee_amount_minor_units').notNull().default('0'),
    netAmountMinorUnits: minorUnits('net_amount_minor_units').notNull(),
    status: settlementStatusEnum('status').notNull().default('PENDING'),
    periodStart: tsColumn('period_start'),
    periodEnd: tsColumn('period_end'),
    completedAt: tsColumn('completed_at'),
    ...auditTimestamps,
  },
  (table) => [index('settlements_org_created_idx').on(table.organizationId, table.createdAt)],
);

/**
 * Append-only security record.
 *
 * The application database role must not hold UPDATE or DELETE on this table.
 * An audit log an attacker can edit after the fact is not an audit log.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: tsColumn('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_org_created_idx').on(table.organizationId, table.createdAt),
    index('audit_events_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_events_action_idx').on(table.action),
  ],
);

/**
 * Idempotency records (product rule 51).
 *
 * `requestHash` is what distinguishes a legitimate retry from a client bug.
 * Same key + same hash replays the stored response. Same key + a *different*
 * hash is an error, because treating it as a fresh request is precisely how a
 * retry turns into a double charge.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull().default('IN_FLIGHT'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    expiresAt: tsColumn('expires_at').notNull(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('idempotency_keys_org_key_unique').on(table.organizationId, table.key),
    index('idempotency_keys_expires_idx').on(table.expiresAt),
  ],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    description: text('description'),
    enabledGlobally: boolean('enabled_globally').notNull().default(false),
    /** Organizations for which the flag is on regardless of the global default. */
    enabledOrganizationIds: text('enabled_organization_ids').array().notNull().default([]),
    ...auditTimestamps,
  },
  (table) => [uniqueIndex('feature_flags_key_unique').on(table.key)],
);
