import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import {
  endpointStatusEnum,
  settlementProtocolEnum,
  httpMethodEnum,
  merchantEnvironmentEnum,
  pricingKindEnum,
} from './enums.js';
import { organizations, projects } from './identity.js';

/**
 * Pricing rules.
 *
 * A rule is endpoint *configuration*. It is mutable — a merchant may reprice
 * whenever they like — which is precisely why a PaymentRequest snapshots the
 * resulting amount as a value rather than pointing at the rule. Nothing in the
 * payment authorization path ever reads this table.
 */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * A rule belongs to one environment. Without this a TEST rule could be
     * read as a LIVE one during a mis-scoped lookup, which is the sort of
     * confusion that ends with a testnet price on a mainnet charge.
     */
    environment: merchantEnvironmentEnum('environment').notNull(),
    kind: pricingKindEnum('kind').notNull().default('FIXED'),
    /**
     * Stored as the merchant entered it ("0.03"), not as minor units.
     *
     * The rule is configuration, and preserving the authored form means the
     * dashboard shows what the merchant typed. Conversion to exact minor units
     * happens in `Money.fromDecimalString`, which rejects any precision the
     * asset cannot represent rather than truncating it.
     */
    amount: text('amount').notNull(),
    assetSymbol: text('asset_symbol').notNull(),
    /** Denormalised so a rule is self-describing without an asset-registry lookup. */
    assetDecimals: integer('asset_decimals').notNull().default(6),
    chainId: integer('chain_id').notNull(),
    ...auditTimestamps,
  },
  (table) => [
    index('pricing_rules_project_idx').on(table.projectId),
    index('pricing_rules_project_env_idx').on(table.projectId, table.environment),
  ],
);

/**
 * Paid endpoints.
 *
 * A merchant's declaration that a given route costs money. The route identity
 * is (project, environment, method, normalized_path).
 */
export const endpoints = pgTable(
  'endpoints',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** As the merchant wrote it, for display. */
    path: text('path').notNull(),
    /**
     * The canonical form the uniqueness invariant is computed over: lowercased,
     * single leading slash, no trailing slash, no duplicate slashes.
     *
     * Stored rather than derived on read so the unique index can be a plain
     * B-tree over a column, and so the normalisation that decided uniqueness is
     * visible in the row rather than hidden in whichever code version last
     * wrote it.
     */
    normalizedPath: text('normalized_path').notNull(),
    method: httpMethodEnum('method').notNull(),
    environment: merchantEnvironmentEnum('environment').notNull(),
    status: endpointStatusEnum('status').notNull().default('ACTIVE'),
    /**
     * How this endpoint takes payment: a simulated TEST settlement, or a real
     * x402 payment. Defaults to `test`, so an endpoint created before Phase 3
     * — or by a merchant who has not opted in — keeps behaving exactly as it
     * did, and real settlement is something a merchant switches on knowingly.
     */
    settlementProtocol: settlementProtocolEnum('settlement_protocol').notNull().default('test'),
    pricingRuleId: text('pricing_rule_id').references(() => pricingRules.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').notNull().default({}),
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [
    /*
     * One definition per (project, environment, method, normalized path).
     *
     * Environment is part of the key because the same route legitimately
     * exists in both TEST and LIVE. Normalised path is used rather than the
     * authored path so that "/research" and "/Research/" cannot both be
     * defined and then differ on which one a lookup finds.
     */
    uniqueIndex('endpoints_route_unique').on(
      table.projectId,
      table.environment,
      table.method,
      table.normalizedPath,
    ),
    index('endpoints_project_idx').on(table.projectId),
    index('endpoints_org_idx').on(table.organizationId),
    index('endpoints_project_status_idx').on(table.projectId, table.status),
  ],
);
