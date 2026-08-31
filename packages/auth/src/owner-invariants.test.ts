import { describe, expect, it } from 'vitest';
import { Meter402Error } from '@meter402/shared';
import {
  assertOwnerInvariant,
  countActiveOwnersAfterChange,
  wouldLeaveOrganizationWithoutOwner,
} from './owner-invariants.js';
import type { Membership } from './principal.js';
import type { Role } from './roles.js';
import type { MembershipStatus } from './principal.js';

function member(id: string, role: Role, status: MembershipStatus = 'ACTIVE'): Membership {
  return {
    membershipId: id,
    organizationId: 'org_test',
    userId: `usr_${id}`,
    role,
    status,
  };
}

describe('owner invariants', () => {
  it('permits demoting an owner when another active owner remains', () => {
    const members = [member('m1', 'OWNER'), member('m2', 'OWNER')];
    expect(
      wouldLeaveOrganizationWithoutOwner(members, { membershipId: 'm1', nextRole: 'ADMIN' }),
    ).toBe(false);
    expect(() =>
      assertOwnerInvariant(members, { membershipId: 'm1', nextRole: 'ADMIN' }),
    ).not.toThrow();
  });

  it('refuses to demote the last owner', () => {
    const members = [member('m1', 'OWNER'), member('m2', 'ADMIN')];
    expect(() => assertOwnerInvariant(members, { membershipId: 'm1', nextRole: 'ADMIN' })).toThrow(
      Meter402Error,
    );
  });

  it('refuses to remove the last owner', () => {
    // "The last owner cannot remove themselves" is the same rule, not a
    // separate special case.
    const members = [member('m1', 'OWNER'), member('m2', 'DEVELOPER')];
    expect(() =>
      assertOwnerInvariant(members, { membershipId: 'm1', nextStatus: 'REMOVED' }),
    ).toThrow(/at least one active owner/);
  });

  it('refuses to suspend the last owner', () => {
    const members = [member('m1', 'OWNER')];
    expect(() =>
      assertOwnerInvariant(members, { membershipId: 'm1', nextStatus: 'SUSPENDED' }),
    ).toThrow(Meter402Error);
  });

  it('does not count a suspended owner as satisfying the invariant', () => {
    // A suspended owner cannot act, so an organization whose only other owner
    // is suspended is already one demotion from being stranded.
    const members = [member('m1', 'OWNER'), member('m2', 'OWNER', 'SUSPENDED')];
    expect(() => assertOwnerInvariant(members, { membershipId: 'm1', nextRole: 'ADMIN' })).toThrow(
      Meter402Error,
    );
  });

  it('does not count an invited owner as satisfying the invariant', () => {
    // An invitation that has not been accepted is not a person who can act.
    const members = [member('m1', 'OWNER'), member('m2', 'OWNER', 'INVITED')];
    expect(() =>
      assertOwnerInvariant(members, { membershipId: 'm1', nextStatus: 'REMOVED' }),
    ).toThrow(Meter402Error);
  });

  it('does not count a removed owner', () => {
    const members = [member('m1', 'OWNER'), member('m2', 'OWNER', 'REMOVED')];
    expect(countActiveOwnersAfterChange(members, { membershipId: 'm9' })).toBe(1);
  });

  it('permits removing a non-owner regardless of owner count', () => {
    const members = [member('m1', 'OWNER'), member('m2', 'VIEWER')];
    expect(() =>
      assertOwnerInvariant(members, { membershipId: 'm2', nextStatus: 'REMOVED' }),
    ).not.toThrow();
  });

  it('permits promoting someone to owner', () => {
    const members = [member('m1', 'OWNER'), member('m2', 'VIEWER')];
    expect(countActiveOwnersAfterChange(members, { membershipId: 'm2', nextRole: 'OWNER' })).toBe(
      2,
    );
  });

  it('counts correctly when the change reactivates a suspended owner', () => {
    const members = [member('m1', 'ADMIN'), member('m2', 'OWNER', 'SUSPENDED')];
    expect(
      countActiveOwnersAfterChange(members, { membershipId: 'm2', nextStatus: 'ACTIVE' }),
    ).toBe(1);
  });

  it('applies both a role and a status change together', () => {
    const members = [member('m1', 'OWNER'), member('m2', 'VIEWER', 'INVITED')];
    // Promoting an invited member to OWNER does not yet give an active owner.
    expect(countActiveOwnersAfterChange(members, { membershipId: 'm2', nextRole: 'OWNER' })).toBe(
      1,
    );
    // Accepting and promoting together does.
    expect(
      countActiveOwnersAfterChange(members, {
        membershipId: 'm2',
        nextRole: 'OWNER',
        nextStatus: 'ACTIVE',
      }),
    ).toBe(2);
  });

  it('treats a change to an unknown membership as a no-op on the count', () => {
    const members = [member('m1', 'OWNER')];
    expect(countActiveOwnersAfterChange(members, { membershipId: 'nonexistent' })).toBe(1);
  });

  it('reports the offending membership in the error details', () => {
    try {
      assertOwnerInvariant([member('m1', 'OWNER')], { membershipId: 'm1', nextRole: 'VIEWER' });
      expect.unreachable('expected invariant violation');
    } catch (error) {
      const typed = error as Meter402Error;
      expect(typed.code).toBe('LAST_OWNER_REQUIRED');
      expect(typed.httpStatus).toBe(409);
      expect(typed.details).toMatchObject({ membershipId: 'm1' });
    }
  });
});
