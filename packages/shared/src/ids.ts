/**
 * Identifiers.
 *
 * Every public identifier is a ULID with a human-readable type prefix, e.g.
 * `pay_01J8ZC4M9K7QW2VYB3N6XR5TDH`.
 *
 * Why not auto-increment integers: sequential IDs leak business volume (a
 * competitor can read your growth rate off two invoice numbers) and make
 * enumeration attacks trivial. Product rule 19 forbids them.
 *
 * Why ULID over UUIDv4: ULIDs are lexicographically sortable by creation time,
 * which keeps B-tree index inserts append-mostly instead of scattering writes
 * across the index. On the payments tables — the highest-write tables in the
 * system — that difference is measurable. The tradeoff is that a ULID reveals
 * its own creation timestamp; it does not reveal position in a sequence, which
 * is the property rule 19 actually cares about.
 *
 * Why a type prefix: it makes IDs self-describing in logs and support
 * tickets, and lets the API reject an endpoint ID passed where a payment ID
 * was expected before that mistake reaches a database query.
 */

import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O, or U, so it survives being read aloud. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS;

function encodeBase32(value: bigint, length: number): string {
  let out = '';
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    const digit = ENCODING[Number(remaining & 31n)];
    /* istanbul ignore next -- masking with 31 cannot exceed the alphabet. */
    if (digit === undefined) {
      throw new Error('ULID encoding produced an out-of-range digit');
    }
    out = digit + out;
    remaining >>= 5n;
  }
  return out;
}

function decodeBase32(value: string): bigint {
  let result = 0n;
  for (const char of value) {
    const index = ENCODING.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid ULID character: ${JSON.stringify(char)}`);
    }
    result = result * 32n + BigInt(index);
  }
  return result;
}

/**
 * Generate a ULID.
 *
 * 48 bits of millisecond timestamp followed by 80 bits from the platform CSPRNG.
 * `randomBytes` is used rather than `Math.random`, which is not
 * cryptographically secure and would make IDs predictable.
 */
export function ulid(timestampMs: number = Date.now()): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error(`Invalid ULID timestamp: ${timestampMs}`);
  }
  const time = BigInt(Math.trunc(timestampMs)) & ((1n << 48n) - 1n);

  let randomness = 0n;
  for (const byte of randomBytes(10)) {
    randomness = (randomness << 8n) | BigInt(byte);
  }

  return encodeBase32(time, TIME_CHARS) + encodeBase32(randomness, RANDOM_CHARS);
}

/** Recover the creation time encoded in a ULID. */
export function ulidTimestamp(value: string): Date {
  if (value.length !== ULID_LENGTH) {
    throw new Error(`Invalid ULID length: ${value.length}`);
  }
  return new Date(Number(decodeBase32(value.slice(0, TIME_CHARS))));
}

/**
 * Type prefixes. Values are permanent once shipped — they appear in customer
 * code, saved webhooks, and support tickets, so renaming one is a breaking
 * change.
 */
export const ID_PREFIXES = {
  user: 'usr',
  organization: 'org',
  membership: 'mem',
  project: 'prj',
  apiKey: 'key',
  endpoint: 'ep',
  pricingRule: 'price',
  paymentRequest: 'preq',
  payment: 'pay',
  paymentAttempt: 'patt',
  receipt: 'rcpt',
  blockchainTransaction: 'btx',
  /** A claimed pre-settlement signed payment authorization. */
  paymentAuthorization: 'pauth',
  /**
   * A merchant settlement destination. `stcfg` rather than `setl`, which
   * already belongs to a settlement batch — two kinds sharing a prefix would
   * make IDs ambiguous exactly where money is involved.
   */
  settlementConfiguration: 'stcfg',
  agent: 'agt',
  customer: 'cus',
  walletReference: 'wal',
  usageEvent: 'ue',
  webhookEndpoint: 'whe',
  webhookDelivery: 'whd',
  riskEvaluation: 'risk',
  policyRule: 'pol',
  settlement: 'setl',
  auditEvent: 'aud',
  idempotencyKey: 'idem',
  subscription: 'sub',
  invoice: 'inv',
  featureFlag: 'flag',
  request: 'req',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

/**
 * A branded template-literal type. `PrefixedId<'payment'>` is assignable from
 * `pay_...` strings only, so passing an endpoint ID to a payment lookup is a
 * compile error rather than an empty result set at runtime.
 */
export type PrefixedId<K extends IdKind = IdKind> = `${(typeof ID_PREFIXES)[K]}_${string}`;

export function newId<K extends IdKind>(kind: K): PrefixedId<K> {
  return `${ID_PREFIXES[kind]}_${ulid()}` as PrefixedId<K>;
}

export function isValidId<K extends IdKind>(kind: K, value: string): value is PrefixedId<K> {
  const prefix = ID_PREFIXES[kind];
  if (!value.startsWith(`${prefix}_`)) {
    return false;
  }
  const body = value.slice(prefix.length + 1);
  if (body.length !== ULID_LENGTH) {
    return false;
  }
  for (const char of body) {
    if (!ENCODING.includes(char)) {
      return false;
    }
  }
  return true;
}

/** Opaque request/trace correlation ID. Not a ULID — never persisted as a key. */
export function newRequestId(): string {
  return `${ID_PREFIXES.request}_${ulid()}`;
}
