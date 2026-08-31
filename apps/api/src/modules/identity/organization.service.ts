import { Meter402Error } from '@meter402/shared';
import type { Database } from '@meter402/database';
import type { Membership } from '@meter402/auth';
import { assertValidSlug, slugify } from '../../lib/slug.js';
import { recordAuditEvent } from '../audit/audit.repository.js';
import { createMembership } from './membership.repository.js';
import { createOrganization, type OrganizationRecord } from './organization.repository.js';

export interface CreateOrganizationInput {
  readonly userId: string;
  readonly name: string;
  readonly slug?: string | undefined;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Create an organization and its founding OWNER membership.
 *
 * Both writes happen in one transaction (product rule 25). If the membership
 * insert failed after the organization committed, the result would be an
 * organization nobody can administer — unreachable through the API and
 * recoverable only by manual database surgery. Since the same transaction also
 * writes the audit event, a created organization always has both an owner and
 * a record of who created it, or neither exists.
 */
export async function createOrganizationWithOwner(
  db: Database,
  input: CreateOrganizationInput,
): Promise<{ organization: OrganizationRecord; membership: Membership }> {
  const slug = input.slug?.trim() ? input.slug.trim() : slugify(input.name);
  assertValidSlug(slug);

  try {
    return await db.transaction(async (tx) => {
      const organization = await createOrganization(tx, { name: input.name.trim(), slug });

      const membership = await createMembership(tx, {
        organizationId: organization.id,
        userId: input.userId,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: 'user',
        actorId: input.userId,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: organization.id,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: { slug, name: organization.name },
      });

      return { organization, membership };
    });
  } catch (error) {
    // The slug unique index is the authority on collisions, not a prior
    // SELECT, which would race two simultaneous creations of the same slug.
    if (isUniqueViolation(error)) {
      throw new Meter402Error('CONFLICT', `The slug "${slug}" is already taken.`, {
        details: { slug },
      });
    }
    throw error;
  }
}

/**
 * Detect a Postgres unique-violation (SQLSTATE 23505).
 *
 * Walks the `cause` chain rather than reading `error.code` directly. Drizzle
 * wraps driver errors in a `DrizzleQueryError`, so the PostgresError carrying
 * the SQLSTATE sits one level down — and checking only the top level silently
 * turned every duplicate slug and duplicate invitation into a 500 instead of a
 * 409. Walking the chain also survives a future change in how many layers of
 * wrapping sit between us and the driver.
 */
const UNIQUE_VIOLATION = '23505';
const MAX_CAUSE_DEPTH = 5;

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
