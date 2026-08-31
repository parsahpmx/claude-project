import { and, desc, eq, ne } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { organizationMembers, organizations } from '@meter402/database';
import type { Role } from '@meter402/auth';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface OrganizationRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: OrganizationStatus;
  readonly plan: string;
  readonly settlementAddress: string | null;
  readonly createdAt: Date;
}

const ORGANIZATION_COLUMNS = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  status: organizations.status,
  plan: organizations.plan,
  settlementAddress: organizations.settlementAddress,
  createdAt: organizations.createdAt,
} as const;

export async function createOrganization(
  executor: Executor,
  input: { name: string; slug: string },
): Promise<OrganizationRecord> {
  const [row] = await executor
    .insert(organizations)
    .values({ id: newId('organization'), name: input.name, slug: input.slug })
    .returning(ORGANIZATION_COLUMNS);

  /* istanbul ignore next */
  if (!row) {
    throw new Error('Organization insert returned no row');
  }
  return row;
}

/**
 * Read the organization a scope refers to.
 *
 * Requires a `TenantScope`, so there is no way to fetch an organization the
 * caller has not already proven membership of. There is deliberately no
 * `findOrganizationById(id)` in this module.
 */
export async function findOrganization(
  executor: Executor,
  scope: TenantScope,
): Promise<OrganizationRecord | null> {
  const [row] = await executor
    .select(ORGANIZATION_COLUMNS)
    .from(organizations)
    .where(and(eq(organizations.id, scope.organizationId), ne(organizations.status, 'DELETED')))
    .limit(1);

  return row ?? null;
}

/**
 * Every organization the user can act in.
 *
 * Driven from the membership table rather than from organizations, so the
 * result set is bounded by what the user actually belongs to. Only ACTIVE
 * memberships are listed: an invitation the user has not accepted, or a
 * suspended membership, does not put an organization on their list.
 */
export async function listOrganizationsForUser(
  executor: Executor,
  userId: string,
): Promise<readonly (OrganizationRecord & { role: Role })[]> {
  const rows = await executor
    .select({ ...ORGANIZATION_COLUMNS, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, 'ACTIVE'),
        ne(organizations.status, 'DELETED'),
      ),
    )
    .orderBy(desc(organizations.createdAt));

  return rows;
}

export async function updateOrganization(
  executor: Executor,
  scope: TenantScope,
  patch: { name?: string; settlementAddress?: string | null },
): Promise<OrganizationRecord | null> {
  const [row] = await executor
    .update(organizations)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.settlementAddress !== undefined
        ? { settlementAddress: patch.settlementAddress }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(organizations.id, scope.organizationId), ne(organizations.status, 'DELETED')))
    .returning(ORGANIZATION_COLUMNS);

  return row ?? null;
}
