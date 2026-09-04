import { eq } from 'drizzle-orm';
import { coaches, users, type Database } from '@forge/db';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Role = 'member' | 'coach' | 'admin';

export interface Principal {
  userId: string;
  sessionId: string;
  role: Role;
  email: string;
  firstName: string;
  lastName: string;
  unitSystem: 'metric' | 'imperial';
  /** Present only for coach principals. */
  coachId: string | null;
  coachSlug: string | null;
}

export async function loadPrincipal(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<Principal> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw unauthorized('Your session is no longer valid.');

  let coachId: string | null = null;
  let coachSlug: string | null = null;
  if (user.role === 'coach') {
    const coachRows = await db.select({ id: coaches.id, slug: coaches.slug })
      .from(coaches).where(eq(coaches.userId, user.id)).limit(1);
    coachId = coachRows[0]?.id ?? null;
    coachSlug = coachRows[0]?.slug ?? null;
  }

  return {
    userId: user.id,
    sessionId,
    role: user.role as Role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    unitSystem: user.unitSystem === 'imperial' ? 'imperial' : 'metric',
    coachId,
    coachSlug,
  };
}

/**
 * Role checks are explicit at every route rather than inferred from the URL
 * prefix. A `/v1/coach/...` path that someone forgets to guard is a data
 * breach; a missing `requireRole` call is a compile-time-visible omission.
 */
export function requireRole(principal: Principal | null, ...allowed: Role[]): Principal {
  if (!principal) throw unauthorized();
  if (!allowed.includes(principal.role)) {
    throw forbidden(`This area is for ${allowed.join(' and ')} accounts.`);
  }
  return principal;
}

export function requireMember(principal: Principal | null): Principal {
  if (!principal) throw unauthorized();
  return principal;
}

export function requireCoach(principal: Principal | null): Principal & { coachId: string } {
  const coach = requireRole(principal, 'coach', 'admin');
  if (!coach.coachId) throw forbidden('This account is not linked to a coach profile.');
  return coach as Principal & { coachId: string };
}
