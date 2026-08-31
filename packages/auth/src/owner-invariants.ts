import { Meter402Error } from '@meter402/shared';
import type { Membership, MembershipStatus } from './principal.js';
import type { Role } from './roles.js';

/**
 * Owner invariants.
 *
 * An organization must always retain at least one ACTIVE OWNER. Without this
 * rule an account can be locked out permanently — nobody left who can invite,
 * promote, or delete — and recovering it requires manual database surgery by
 * us, which is both a support cost and an insider-risk surface.
 *
 * The rule is expressed once, as a function of the whole membership set plus
 * the proposed change, rather than as three separate special cases ("can't
 * remove yourself", "can't demote the last owner", "can't suspend the last
 * owner"). Those are all the same rule, and writing them separately is how one
 * of them ends up missing a path.
 */

export interface ProposedMembershipChange {
  readonly membershipId: string;
  /** Omit to leave unchanged. */
  readonly nextRole?: Role;
  /** Omit to leave unchanged. */
  readonly nextStatus?: MembershipStatus;
}

function isActiveOwner(membership: { role: Role; status: MembershipStatus }): boolean {
  return membership.role === 'OWNER' && membership.status === 'ACTIVE';
}

/**
 * Apply the proposed change to a snapshot and report whether any active owner
 * would remain.
 *
 * `members` must be the complete membership set for the organization, read
 * inside the same transaction as the write. Evaluating this against a stale or
 * partial read is how two concurrent demotions can each believe the other
 * owner still exists — see the concurrency tests.
 */
export function countActiveOwnersAfterChange(
  members: readonly Membership[],
  change: ProposedMembershipChange,
): number {
  return members.filter((member) => {
    if (member.membershipId !== change.membershipId) {
      return isActiveOwner(member);
    }
    return isActiveOwner({
      role: change.nextRole ?? member.role,
      status: change.nextStatus ?? member.status,
    });
  }).length;
}

export function wouldLeaveOrganizationWithoutOwner(
  members: readonly Membership[],
  change: ProposedMembershipChange,
): boolean {
  return countActiveOwnersAfterChange(members, change) === 0;
}

/**
 * Enforce the invariant, throwing if the change would strand the organization.
 *
 * Callers must run this inside the transaction that performs the write, with
 * the membership set read under a row lock. Checking outside the transaction
 * is a check-then-write race: two owners demoting each other simultaneously
 * would both observe the other as still active.
 */
export function assertOwnerInvariant(
  members: readonly Membership[],
  change: ProposedMembershipChange,
): void {
  if (wouldLeaveOrganizationWithoutOwner(members, change)) {
    throw new Meter402Error(
      'LAST_OWNER_REQUIRED',
      'An organization must always have at least one active owner. ' +
        'Promote another member to OWNER before making this change.',
      { details: { membershipId: change.membershipId } },
    );
  }
}
