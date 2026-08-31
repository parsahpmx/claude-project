import { and, eq, isNull } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { users } from '@meter402/database';
import type { Executor } from '../../lib/executor.js';
import { normalizeEmail } from '../../lib/slug.js';

/**
 * Users.
 *
 * Users are the one entity in Phase 1 that is *not* tenant-owned — a person
 * exists independently of any organization and may belong to several. So
 * `findById` is legitimate here, unlike on organization-owned tables.
 *
 * Access to anything organizational still requires a membership; identity
 * alone grants nothing.
 */

export type UserStatus = 'ACTIVE' | 'DISABLED' | 'PENDING_VERIFICATION';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly status: UserStatus;
  readonly emailVerifiedAt: Date | null;
}

export interface CreateUserInput {
  readonly email: string;
  readonly displayName?: string | null;
  readonly status?: UserStatus;
}

function toRecord(row: {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
  };
}

export async function createUser(executor: Executor, input: CreateUserInput): Promise<UserRecord> {
  const [row] = await executor
    .insert(users)
    .values({
      id: newId('user'),
      email: input.email.trim(),
      // The unique constraint is on the normalised form, so `Alice@x.com` and
      // `alice@x.com` cannot both exist.
      emailNormalized: normalizeEmail(input.email),
      displayName: input.displayName ?? null,
      status: input.status ?? 'PENDING_VERIFICATION',
    })
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
    });

  /* istanbul ignore next -- INSERT ... RETURNING always yields a row or throws. */
  if (!row) {
    throw new Error('User insert returned no row');
  }
  return toRecord(row);
}

export async function findUserById(executor: Executor, userId: string): Promise<UserRecord | null> {
  const [row] = await executor
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  return row ? toRecord(row) : null;
}

export async function findUserByEmail(
  executor: Executor,
  email: string,
): Promise<UserRecord | null> {
  const [row] = await executor
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(and(eq(users.emailNormalized, normalizeEmail(email)), isNull(users.deletedAt)))
    .limit(1);

  return row ? toRecord(row) : null;
}
