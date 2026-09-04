import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { authSessions, type Database } from '@forge/db';
import { randomId } from '@forge/core';
import { unauthorized } from '../lib/errors.js';

/**
 * Session handling.
 *
 * The token the browser holds is 32 random bytes. What the database holds is
 * its SHA-256 — so a leaked database backup cannot be replayed as a live
 * session, and a support engineer reading the sessions table cannot
 * impersonate a member. Lookup is by hash, which is still a single indexed
 * equality query.
 */

export const SESSION_COOKIE = 'forge_session';

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueSession(
  db: Database,
  userId: string,
  ttlHours: number,
  userAgent: string | undefined,
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const sessionId = randomId('session');
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

  await db.insert(authSessions).values({
    id: sessionId,
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 255) ?? null,
  });

  return { token, sessionId, expiresAt };
}

export async function resolveSession(
  db: Database,
  token: string | undefined,
): Promise<{ userId: string; sessionId: string } | null> {
  if (!token) return null;
  const hash = hashToken(token);

  const rows = await db
    .select({ id: authSessions.id, userId: authSessions.userId, expiresAt: authSessions.expiresAt, tokenHash: authSessions.tokenHash })
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Belt and braces against a future index change turning this into a scan.
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(authSessions).where(eq(authSessions.id, row.id));
    return null;
  }

  return { userId: row.userId, sessionId: row.id };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.id, sessionId));
}

/** Housekeeping: expired rows are useless and grow forever without this. */
export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}

export function requireToken(token: string | undefined): string {
  if (!token) throw unauthorized();
  return token;
}
