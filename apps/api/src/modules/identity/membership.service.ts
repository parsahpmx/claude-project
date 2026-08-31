import { Meter402Error } from '@meter402/shared';
import type { Database } from '@meter402/database';
import {
  assertOwnerInvariant,
  type Membership,
  type MembershipStatus,
  type Role,
} from '@meter402/auth';
import type { TenantScope } from '../../lib/tenant.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import {
  createMembership,
  findMembershipById,
  listMembershipsForUpdate,
  updateMembership,
} from './membership.repository.js';
import { findUserByEmail, createUser } from './user.repository.js';
import { isUniqueViolation } from './organization.service.js';

export interface ActorContext {
  readonly actorUserId: string;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Invite a person to an organization.
 *
 * The membership is created INVITED, not ACTIVE. Nothing in Phase 1 sends an
 * email — see docs/ARCHITECTURE.md, where invitation delivery is marked
 * PLANNED. What exists is the domain half: a row that grants no authority
 * until it is accepted, so an invitation cannot be used to act on someone's
 * behalf before they agree to join.
 */
export async function inviteMember(
  db: Database,
  scope: TenantScope,
  actor: ActorContext,
  input: { email: string; role: Role },
): Promise<Membership> {
  try {
    return await db.transaction(async (tx) => {
      // A person may be invited before they have ever signed in, so create a
      // placeholder identity when none exists. It is PENDING_VERIFICATION and
      // carries no credentials.
      const existing = await findUserByEmail(tx, input.email);
      const user = existing ?? (await createUser(tx, { email: input.email }));

      const membership = await createMembership(tx, {
        organizationId: scope.organizationId,
        userId: user.id,
        role: input.role,
        status: 'INVITED',
        invitedByUserId: actor.actorUserId,
      });

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorType: 'user',
        actorId: actor.actorUserId,
        action: 'member.added',
        resourceType: 'membership',
        resourceId: membership.membershipId,
        requestId: actor.requestId ?? null,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        metadata: { role: input.role, invitedUserId: user.id },
      });

      return membership;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Meter402Error('CONFLICT', 'That person is already a member of this organization.');
    }
    throw error;
  }
}

/**
 * Change a member's role or status.
 *
 * The owner invariant is evaluated inside the transaction, against a membership
 * set read `FOR UPDATE`. Doing it outside — or against an unlocked read — is a
 * check-then-write race: two owners demoting each other at the same moment
 * would each see the other as still active and both succeed, leaving an
 * organization nobody can administer.
 */
export async function changeMembership(
  db: Database,
  scope: TenantScope,
  actor: ActorContext,
  input: { membershipId: string; role?: Role; status?: MembershipStatus },
): Promise<Membership> {
  return db.transaction(async (tx) => {
    const members = await listMembershipsForUpdate(tx, scope);
    const target = members.find((member) => member.membershipId === input.membershipId);

    if (!target) {
      // Also covers a membership ID belonging to another organization: the
      // scoped read simply does not contain it.
      throw new Meter402Error('MEMBERSHIP_NOT_FOUND');
    }

    assertOwnerInvariant(members, {
      membershipId: input.membershipId,
      ...(input.role ? { nextRole: input.role } : {}),
      ...(input.status ? { nextStatus: input.status } : {}),
    });

    const updated = await updateMembership(tx, scope, input.membershipId, {
      ...(input.role ? { role: input.role } : {}),
      ...(input.status ? { status: input.status } : {}),
    });

    /* istanbul ignore next -- the row was just read under lock. */
    if (!updated) {
      throw new Meter402Error('MEMBERSHIP_NOT_FOUND');
    }

    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: actor.actorUserId,
      action: input.status === 'REMOVED' ? 'member.removed' : 'member.role_changed',
      resourceType: 'membership',
      resourceId: input.membershipId,
      requestId: actor.requestId ?? null,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: {
        previousRole: target.role,
        previousStatus: target.status,
        ...(input.role ? { newRole: input.role } : {}),
        ...(input.status ? { newStatus: input.status } : {}),
      },
    });

    return updated;
  });
}

export async function getMembership(
  db: Database,
  scope: TenantScope,
  membershipId: string,
): Promise<Membership> {
  const membership = await findMembershipById(db, scope, membershipId);
  if (!membership) {
    throw new Meter402Error('MEMBERSHIP_NOT_FOUND');
  }
  return membership;
}
