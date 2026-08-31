import type { MerchantEnvironment } from '@meter402/shared';
import type { Role } from './roles.js';
import type { ApiKeyScope } from './scopes.js';

/**
 * Principals.
 *
 * Two kinds of actor reach this platform, and conflating them is a privilege
 * escalation waiting to happen:
 *
 *  - A **human** acting through the dashboard, whose authority comes from an
 *    organization membership and its role.
 *  - A **machine** acting through an API key, whose authority comes from the
 *    key's scopes and is confined to one project and one environment.
 *
 * A single ambiguous "current user" object would let a machine credential
 * inherit a human's organization-management rights the first time a handler
 * forgot to check which kind it was holding. The discriminated union makes
 * that a compile error instead: RBAC functions accept only a user context,
 * scope functions accept only an API-key principal.
 */

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function isMembershipStatus(value: string): value is MembershipStatus {
  return (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

/** A membership as loaded from the database. Never assembled from request input. */
export interface Membership {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: MembershipStatus;
}

export interface UserPrincipal {
  readonly type: 'user';
  readonly userId: string;
}

export interface ApiKeyPrincipal {
  readonly type: 'api_key';
  readonly apiKeyId: string;
  readonly organizationId: string;
  readonly projectId: string;
  /**
   * The environment this credential may act in. A TEST key can never authorize
   * a LIVE operation; see `requireEnvironment` in scopes.ts.
   */
  readonly environment: MerchantEnvironment;
  readonly scopes: readonly ApiKeyScope[];
}

export type Principal = UserPrincipal | ApiKeyPrincipal;

export function isUserPrincipal(principal: Principal): principal is UserPrincipal {
  return principal.type === 'user';
}

export function isApiKeyPrincipal(principal: Principal): principal is ApiKeyPrincipal {
  return principal.type === 'api_key';
}
