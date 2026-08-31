import { and, eq } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { organizationMembers } from '@meter402/database';
import type { Membership, MembershipStatus, Role } from '@meter402/auth';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

/**
 * Memberships.
 *
 * Membership is the sole source of organization access (product rule 5). It is
 * never derived from an email domain, a request header, or anything else the
 * user controls — only from a row in this table.
 */

function toMembership(row: {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
}): Membership {
  return {
    membershipId: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    status: row.status,
  };
}

const MEMBERSHIP_COLUMNS = {
  id: organizationMembers.id,
  organizationId: organizationMembers.organizationId,
  userId: organizationMembers.userId,
  role: organizationMembers.role,
  status: organizationMembers.status,
} as const;

/**
 * The membership lookup that gates every organization-scoped request.
 *
 * Takes the user and organization as separate arguments rather than a scope,
 * because this is the function that *establishes* scope — it runs before any
 * TenantScope exists. Returns null when the user has no membership at all,
 * which callers turn into a 404 rather than a 403 so that a probe cannot
 * confirm the organization exists.
 */
export async function findMembership(
  executor: Executor,
  userId: string,
  organizationId: string,
): Promise<Membership | null> {
  const [row] = await executor
    .select(MEMBERSHIP_COLUMNS)
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
      ),
    )
    .limit(1);

  return row ? toMembership(row) : null;
}

export async function findMembershipById(
  executor: Executor,
  scope: TenantScope,
  membershipId: string,
): Promise<Membership | null> {
  const [row] = await executor
    .select(MEMBERSHIP_COLUMNS)
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.id, membershipId),
        eq(organizationMembers.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  return row ? toMembership(row) : null;
}

export async function listMemberships(
  executor: Executor,
  scope: TenantScope,
): Promise<readonly Membership[]> {
  const rows = await executor
    .select(MEMBERSHIP_COLUMNS)
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, scope.organizationId));

  return rows.map(toMembership);
}

/**
 * Read the whole membership set under a row lock, for use inside a
 * transaction that is about to change one of them.
 *
 * `FOR UPDATE` is what makes the owner invariant safe under concurrency. Two
 * simultaneous demotions of two different owners would otherwise each read a
 * snapshot in which the *other* owner is still active, both conclude the
 * invariant holds, and both commit — leaving an organization with no owner.
 * Locking the rows serialises the two transactions so the second sees the
 * first's effect. This is the same reasoning that put replay protection behind
 * a database constraint rather than an application check.
 */
export async function listMembershipsForUpdate(
  executor: Executor,
  scope: TenantScope,
): Promise<readonly Membership[]> {
  const rows = await executor
    .select(MEMBERSHIP_COLUMNS)
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, scope.organizationId))
    .for('update');

  return rows.map(toMembership);
}

export interface CreateMembershipInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: MembershipStatus;
  readonly invitedByUserId?: string | null;
}

export async function createMembership(
  executor: Executor,
  input: CreateMembershipInput,
): Promise<Membership> {
  const [row] = await executor
    .insert(organizationMembers)
    .values({
      id: newId('membership'),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      status: input.status,
      invitedByUserId: input.invitedByUserId ?? null,
      acceptedAt: input.status === 'ACTIVE' ? new Date() : null,
    })
    .returning(MEMBERSHIP_COLUMNS);

  /* istanbul ignore next */
  if (!row) {
    throw new Error('Membership insert returned no row');
  }
  return toMembership(row);
}

export async function updateMembership(
  executor: Executor,
  scope: TenantScope,
  membershipId: string,
  patch: { role?: Role; status?: MembershipStatus },
): Promise<Membership | null> {
  const [row] = await executor
    .update(organizationMembers)
    .set({
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.status === 'ACTIVE' ? { acceptedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizationMembers.id, membershipId),
        // Scoped even though the ID is unique: an UPDATE that matched on ID
        // alone would let a crafted request modify another tenant's row if the
        // ID ever leaked.
        eq(organizationMembers.organizationId, scope.organizationId),
      ),
    )
    .returning(MEMBERSHIP_COLUMNS);

  return row ? toMembership(row) : null;
}
