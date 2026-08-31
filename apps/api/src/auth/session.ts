import { createHmac, timingSafeEqual } from 'node:crypto';
import { Meter402Error } from '@meter402/shared';

/**
 * Human session tokens — a DEVELOPMENT ADAPTER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  STATUS: this is NOT a production identity system, and Meter402 does not
 *  claim to have one yet. There is no password, no MFA, no account recovery,
 *  no device management, and no session revocation list. Phase 1 keeps the
 *  identity domain provider-neutral behind `SessionIssuer` so that a real
 *  provider (Better Auth / Auth0 / Clerk) can be dropped in without touching
 *  routes, repositories, or RBAC. See docs/ARCHITECTURE.md, where human
 *  authentication is marked PLANNED.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * What this *is*: a minimal, honestly-scoped bearer token so that Phase 1's
 * authorization and tenant-isolation work can be exercised end to end over
 * real HTTP. It uses HMAC-SHA256 from node:crypto — a standard construction,
 * not invented cryptography — and it is verified in constant time.
 *
 * The route that mints these tokens is registered only outside staging and
 * production; see `routes/v1/dev-sessions.ts`.
 */

export interface SessionIssuer {
  issue(userId: string, ttlSeconds?: number): string;
  /** Returns the user ID, or null for any malformed, tampered, or expired token. */
  verify(token: string): { userId: string } | null;
}

const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_SECONDS = 3600;
const MAX_TOKEN_BYTES = 4096;

interface SessionPayload {
  readonly userId: string;
  /** Unix seconds. */
  readonly exp: number;
}

function sign(secret: string, encodedPayload: string): string {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url');
}

export class DevelopmentSessionIssuer implements SessionIssuer {
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error('Session secret must be at least 32 characters');
    }
  }

  issue(userId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
    const payload: SessionPayload = {
      userId,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${TOKEN_VERSION}.${encoded}.${sign(this.secret, encoded)}`;
  }

  verify(token: string): { userId: string } | null {
    if (token.length > MAX_TOKEN_BYTES) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [version, encoded, signature] = parts;
    if (version !== TOKEN_VERSION || !encoded || !signature) {
      return null;
    }

    /*
     * Verify the signature BEFORE parsing the payload. Parsing first would run
     * JSON.parse over attacker-controlled bytes that have not been
     * authenticated — a smaller attack surface than most, but the ordering
     * costs nothing and is the habit worth keeping.
     */
    const expected = Buffer.from(sign(this.secret, encoded), 'utf8');
    const provided = Buffer.from(signature, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return null;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as SessionPayload).userId !== 'string' ||
      typeof (payload as SessionPayload).exp !== 'number'
    ) {
      return null;
    }

    const typed = payload as SessionPayload;
    if (typed.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (typed.userId.length === 0) {
      return null;
    }

    return { userId: typed.userId };
  }
}

export function invalidCredentials(): Meter402Error {
  return new Meter402Error('INVALID_CREDENTIALS');
}
