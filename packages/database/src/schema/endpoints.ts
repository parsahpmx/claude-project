import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditTimestamps, tsColumn } from './columns.js';
import { merchantEnvironmentEnum, pricingKindEnum } from './enums.js';
import { organizations, projects } from './identity.js';

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
    chainId: integer('chain_id').notNull(),
    ...auditTimestamps,
  },
  (table) => [index('pricing_rules_project_idx').on(table.projectId)],
);

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
    path: text('path').notNull(),
    method: text('method').notNull(),
    environment: merchantEnvironmentEnum('environment').notNull(),
    active: boolean('active').notNull().default(true),
    pricingRuleId: text('pricing_rule_id').references(() => pricingRules.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').notNull().default({}),
    deletedAt: tsColumn('deleted_at'),
    ...auditTimestamps,
  },
  (table) => [
    // One definition per (project, method, path, environment). The same path
    // legitimately exists in both TEST and LIVE, so environment is part of the
    // key rather than a filter.
    uniqueIndex('endpoints_route_unique').on(
      table.projectId,
      table.method,
      table.path,
      table.environment,
    ),
    index('endpoints_project_idx').on(table.projectId),
    index('endpoints_org_idx').on(table.organizationId),
  ],
);
