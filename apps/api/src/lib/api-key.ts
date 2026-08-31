import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { API_KEY_PREFIX, environmentFromApiKeyPrefix } from '@meter402/shared';
import type { MerchantEnvironment } from '@meter402/shared';

/**
 * API key generation and verification.
 *
 * Format: `meter_test_<43 base64url characters>` — 32 bytes of CSPRNG output.
 *
 * On the choice of hash. The reflexive answer is bcrypt or Argon2, and it is
 * wrong here. Those exist to make brute force expensive against *low-entropy
 * human-chosen passwords*. This secret is 256 bits from `randomBytes`: brute
 * force is already infeasible, so a slow KDF buys nothing against the actual
 * threat. It would cost a great deal — keys are verified on every single API
 * request, and a deliberately slow hash on that path is a self-inflicted
 * denial of service.
 *
 * So: HMAC-SHA256 under a server-side pepper. The pepper lives in the secret
 * store rather than the database, so a database dump alone does not let an
 * attacker verify guessed keys offline. Verification is constant-time.
 */

/** 32 bytes → 43 base64url characters, no padding. */
const SECRET_BYTES = 32;

export interface GeneratedApiKey {
  /** The full secret. Returned to the caller exactly once, never stored. */
  readonly secret: string;
  readonly prefix: string;
  /** Last four characters, for recognition in a list. Useless to an attacker. */
  readonly lastFour: string;
  readonly keyHash: string;
  readonly environment: MerchantEnvironment;
}

export function generateApiKey(environment: MerchantEnvironment, pepper: string): GeneratedApiKey {
  const prefix = API_KEY_PREFIX[environment];
  const random = randomBytes(SECRET_BYTES).toString('base64url');
  const secret = `${prefix}_${random}`;

  return {
    secret,
    prefix,
    lastFour: random.slice(-4),
    keyHash: hashApiKey(secret, pepper),
    environment,
  };
}

export function hashApiKey(secret: string, pepper: string): string {
  if (pepper.length === 0) {
    // An empty pepper silently degrades this to a plain unsalted hash, which
    // makes a database dump directly useful to an attacker.
    throw new Error('API key pepper must not be empty');
  }
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

/**
 * Constant-time verification.
 *
 * A byte-by-byte early-exit comparison leaks how much of a candidate matched.
 * Repeated across enough requests that is enough to reconstruct a valid hash,
 * so the comparison must not short-circuit.
 *
 * Both sides are hashed to a fixed 32-byte digest before comparison, so
 * `timingSafeEqual`'s length requirement is always satisfied and the length of
 * the supplied secret is not itself a side channel.
 */
export function verifyApiKey(secret: string, expectedHash: string, pepper: string): boolean {
  let candidate: Buffer;
  let expected: Buffer;
  try {
    candidate = Buffer.from(hashApiKey(secret, pepper), 'hex');
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }

  if (candidate.length !== expected.length || candidate.length === 0) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

export interface ParsedApiKey {
  readonly prefix: string;
  readonly environment: MerchantEnvironment;
}

/**
 * Extract the prefix and environment from a presented key.
 *
 * Purely structural — it says nothing about whether the key is real. The
 * prefix is the database lookup key, and knowing the environment before the
 * lookup lets us reject a live key on a test-only route without a query.
 */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const trimmed = raw.trim();

  // Matched with an anchored pattern rather than split on '_': base64url's
  // alphabet includes underscore, so the secret portion legitimately contains
  // them and splitting would truncate it.
  const match = /^(meter_(?:test|live))_([A-Za-z0-9_-]{20,})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const prefix = match[1];
  if (prefix === undefined) {
    return null;
  }
  const environment = environmentFromApiKeyPrefix(prefix);
  if (environment === undefined) {
    return null;
  }
  return { prefix, environment };
}

/**
 * Pull a bearer token out of an Authorization header.
 *
 * The scheme is compared case-insensitively (RFC 7235 makes it
 * case-insensitive) but the token is taken verbatim.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme === undefined || scheme.toLowerCase() !== 'bearer' || rest.length !== 1) {
    return null;
  }
  return rest[0] ?? null;
}
