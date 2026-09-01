import { and, desc, eq, isNull } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { settlementConfigurations } from '@meter402/database';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

/**
 * Settlement destinations.
 *
 * Every function here is tenant-scoped, like every other repository that
 * touches merchant data. There is deliberately no unscoped lookup at all —
 * not even the narrow opaque-owner exception the project and endpoint modules
 * make — because a settlement destination is never addressed by ID from an
 * untrusted route. It is always reached through an organization the caller has
 * already proven membership of.
 */

export type SettlementConfigStatus = 'ACTIVE' | 'DISABLED';

export interface SettlementConfigRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly chainId: number;
  readonly assetSymbol: string;
  readonly recipientAddress: string;
  readonly status: SettlementConfigStatus;
  readonly createdByUserId: string;
  readonly updatedByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const COLUMNS = {
  id: settlementConfigurations.id,
  organizationId: settlementConfigurations.organizationId,
  projectId: settlementConfigurations.projectId,
  chainId: settlementConfigurations.chainId,
  assetSymbol: settlementConfigurations.assetSymbol,
  recipientAddress: settlementConfigurations.recipientAddress,
  status: settlementConfigurations.status,
  createdByUserId: settlementConfigurations.createdByUserId,
  updatedByUserId: settlementConfigurations.updatedByUserId,
  createdAt: settlementConfigurations.createdAt,
  updatedAt: settlementConfigurations.updatedAt,
} as const;

export interface UpsertSettlementConfigInput {
  readonly projectId: string | null;
  readonly chainId: number;
  readonly assetSymbol: string;
  readonly recipientAddress: string;
  readonly actorUserId: string;
}

/**
 * Create or repoint a settlement destination.
 *
 * An upsert rather than an insert, because "where does this project's USDC on
 * Base go" has exactly one answer, and a merchant correcting a typo should not
 * have to discover which of two rows wins.
 *
 * The `where` clauses use `IS NULL` explicitly for the organization-level row:
 * SQL equality against NULL is never true, so `eq(projectId, null)` would
 * match nothing and silently create a duplicate.
 */
export async function upsertSettlementConfiguration(
  executor: Executor,
  scope: TenantScope,
  input: UpsertSettlementConfigInput,
): Promise<SettlementConfigRecord> {
  const existing = await findSettlementConfiguration(executor, scope, {
    projectId: input.projectId,
    chainId: input.chainId,
    assetSymbol: input.assetSymbol,
  });

  if (existing) {
    const [row] = await executor
      .update(settlementConfigurations)
      .set({
        recipientAddress: input.recipientAddress,
        status: 'ACTIVE',
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(settlementConfigurations.id, existing.id),
          eq(settlementConfigurations.organizationId, scope.organizationId),
        ),
      )
      .returning(COLUMNS);
    /* istanbul ignore next -- the row was just read under this scope. */
    if (!row) throw new Error('Settlement configuration update returned no row');
    return row as SettlementConfigRecord;
  }

  const [row] = await executor
    .insert(settlementConfigurations)
    .values({
      id: newId('settlementConfiguration'),
      // From the scope, never from the request body.
      organizationId: scope.organizationId,
      projectId: input.projectId,
      chainId: input.chainId,
      assetSymbol: input.assetSymbol,
      recipientAddress: input.recipientAddress,
      createdByUserId: input.actorUserId,
    })
    .returning(COLUMNS);

  /* istanbul ignore next */
  if (!row) throw new Error('Settlement configuration insert returned no row');
  return row as SettlementConfigRecord;
}

export async function findSettlementConfiguration(
  executor: Executor,
  scope: TenantScope,
  key: { projectId: string | null; chainId: number; assetSymbol: string },
): Promise<SettlementConfigRecord | null> {
  const [row] = await executor
    .select(COLUMNS)
    .from(settlementConfigurations)
    .where(
      and(
        eq(settlementConfigurations.organizationId, scope.organizationId),
        key.projectId === null
          ? isNull(settlementConfigurations.projectId)
          : eq(settlementConfigurations.projectId, key.projectId),
        eq(settlementConfigurations.chainId, key.chainId),
        eq(settlementConfigurations.assetSymbol, key.assetSymbol),
      ),
    )
    .limit(1);

  return (row as SettlementConfigRecord | undefined) ?? null;
}

/**
 * Resolve the destination for a payment.
 *
 * Project-specific wins over the organization default, so a merchant can route
 * one project's revenue separately. Only ACTIVE rows are considered: disabling
 * a destination must actually stop money going there, rather than leaving it
 * as the answer nobody noticed.
 */
export async function resolveSettlementRecipient(
  executor: Executor,
  scope: TenantScope,
  key: { projectId: string; chainId: number; assetSymbol: string },
): Promise<SettlementConfigRecord | null> {
  const specific = await findSettlementConfiguration(executor, scope, {
    projectId: key.projectId,
    chainId: key.chainId,
    assetSymbol: key.assetSymbol,
  });
  if (specific && specific.status === 'ACTIVE') return specific;

  const organizationWide = await findSettlementConfiguration(executor, scope, {
    projectId: null,
    chainId: key.chainId,
    assetSymbol: key.assetSymbol,
  });
  if (organizationWide && organizationWide.status === 'ACTIVE') return organizationWide;

  return null;
}

export async function listSettlementConfigurations(
  executor: Executor,
  scope: TenantScope,
): Promise<readonly SettlementConfigRecord[]> {
  const rows = await executor
    .select(COLUMNS)
    .from(settlementConfigurations)
    .where(eq(settlementConfigurations.organizationId, scope.organizationId))
    .orderBy(desc(settlementConfigurations.createdAt));
  return rows as SettlementConfigRecord[];
}

export async function setSettlementConfigurationStatus(
  executor: Executor,
  scope: TenantScope,
  id: string,
  status: SettlementConfigStatus,
  actorUserId: string,
): Promise<SettlementConfigRecord | null> {
  const [row] = await executor
    .update(settlementConfigurations)
    .set({ status, updatedByUserId: actorUserId, updatedAt: new Date() })
    .where(
      and(
        eq(settlementConfigurations.id, id),
        eq(settlementConfigurations.organizationId, scope.organizationId),
      ),
    )
    .returning(COLUMNS);

  return (row as SettlementConfigRecord | undefined) ?? null;
}
