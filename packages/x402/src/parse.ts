import { err, ok, type Result } from '@meter402/shared';
import { verificationFailure, type VerificationFailure } from '@meter402/payments';
import {
  MAX_PAYMENT_HEADER_BYTES,
  MAX_PAYMENT_HEADER_ENCODED_BYTES,
  NONCE_HEX_LENGTH,
  SIGNATURE_HEX_LENGTH,
  X402_VERSION,
} from './constants.js';
import type {
  X402ExactEvmAuthorization,
  X402ExactEvmPayload,
  X402PaymentPayload,
  X402PaymentRequirements,
} from './wire.js';

/**
 * Parsing the `PAYMENT-SIGNATURE` header.
 *
 * Everything in this module treats its input as hostile, because it is: this
 * runs before any payment has been established, on a request that anyone can
 * make. The rules it follows throughout:
 *
 *  - **Bound before allocating.** The encoded length is checked before the
 *    base64 decode, and the decoded length before the JSON parse.
 *  - **Reject, never coerce.** A malformed field is an error, not something to
 *    normalise into a valid-looking value. Coercion is how `"30000abc"`
 *    becomes 30000.
 *  - **Total.** Every function returns a Result. Nothing throws, so a
 *    malformed header cannot become a 500.
 */

/** Case-insensitive single-value header read. `'DUPLICATED'` on repeats. */
export function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null | 'DUPLICATED' {
  const target = name.toLowerCase();
  let found: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(value)) {
      if (value.length > 1 || found !== undefined) return 'DUPLICATED';
      found = value[0];
      continue;
    }
    if (value === undefined) continue;
    if (found !== undefined) return 'DUPLICATED';
    found = value;
  }
  return found ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A decimal string of atomic units. No sign, no exponent, no leading zeros. */
const ATOMIC_AMOUNT = /^(0|[1-9][0-9]{0,77})$/;
/** Unix seconds. Same rules; `"0"` is legal for `validAfter`. */
const UNIX_SECONDS = /^(0|[1-9][0-9]{0,18})$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

function fail(message: string, details?: Record<string, unknown>) {
  return err(verificationFailure('MALFORMED_PROOF', message, details));
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Decode the base64 header into JSON.
 *
 * Base64 is validated by re-encoding rather than by a regex: Node's decoder is
 * lenient and silently ignores characters it does not recognise, so
 * `"!!!!"` decodes to an empty buffer instead of failing. Round-tripping is
 * what turns that leniency back into a rejection.
 */
export function decodeHeaderJson(raw: string): Result<unknown, VerificationFailure> {
  if (raw.length > MAX_PAYMENT_HEADER_ENCODED_BYTES) {
    return fail('Payment header is too large.', { encodedBytes: raw.length });
  }

  const trimmed = raw.trim();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(trimmed, 'base64');
  } catch {
    return fail('Payment header is not valid base64.');
  }

  if (buffer.byteLength === 0) {
    return fail('Payment header is empty.');
  }
  if (buffer.byteLength > MAX_PAYMENT_HEADER_BYTES) {
    return fail('Payment header is too large.', { decodedBytes: buffer.byteLength });
  }

  // Accept both standard and URL-safe base64, but require an exact round-trip.
  const canonical = buffer.toString('base64');
  const normalised = trimmed.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (canonical.replace(/=+$/, '') !== normalised) {
    return fail('Payment header is not valid base64.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'), (key, value: unknown) =>
      // Drop prototype-polluting keys before they can reach an object.
      key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
    ) as unknown;
  } catch {
    return fail('Payment header is not valid JSON.');
  }

  return ok(parsed);
}

/** Parse the `accepted` requirement echoed by the client. Shape only. */
function parseRequirements(value: unknown): Result<X402PaymentRequirements, VerificationFailure> {
  if (!isRecord(value)) {
    return fail('Payment payload `accepted` is not an object.');
  }

  const scheme = readString(value, 'scheme');
  const network = readString(value, 'network');
  const asset = readString(value, 'asset');
  const amount = readString(value, 'amount');
  const payTo = readString(value, 'payTo');
  const maxTimeoutSeconds = value['maxTimeoutSeconds'];

  if (!scheme || !network || !asset || !amount || !payTo) {
    return fail('Payment payload `accepted` is missing required fields.');
  }
  if (!ATOMIC_AMOUNT.test(amount)) {
    // Rejected rather than parsed: "0030000", "3e4" and "30000 " must not
    // become 30000 here and something else in the facilitator.
    return fail('Payment `accepted.amount` is not a canonical atomic amount.');
  }
  if (!HEX_ADDRESS.test(asset) || !HEX_ADDRESS.test(payTo)) {
    return fail('Payment `accepted` carries a malformed address.');
  }
  if (typeof maxTimeoutSeconds !== 'number' || !Number.isSafeInteger(maxTimeoutSeconds)) {
    return fail('Payment `accepted.maxTimeoutSeconds` is not an integer.');
  }

  const extra = value['extra'];
  if (extra !== undefined && !isRecord(extra)) {
    return fail('Payment `accepted.extra` is not an object.');
  }

  return ok({
    scheme,
    network: network as `${string}:${string}`,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds,
    extra: (extra ?? {}) as Readonly<Record<string, unknown>>,
  });
}

/** Parse the EIP-3009 authorization and its signature. Shape only. */
export function parseExactEvmPayload(
  value: unknown,
): Result<X402ExactEvmPayload, VerificationFailure> {
  if (!isRecord(value)) {
    return fail('Payment payload is not an object.');
  }

  const signature = readString(value, 'signature');
  if (!signature || !HEX_SIGNATURE.test(signature)) {
    return fail('Payment signature is not a 65-byte hex string.', {
      expectedLength: SIGNATURE_HEX_LENGTH,
    });
  }

  const authorization = value['authorization'];
  if (!isRecord(authorization)) {
    return fail('Payment payload `authorization` is not an object.');
  }

  const from = readString(authorization, 'from');
  const to = readString(authorization, 'to');
  const amount = readString(authorization, 'value');
  const validAfter = readString(authorization, 'validAfter');
  const validBefore = readString(authorization, 'validBefore');
  const nonce = readString(authorization, 'nonce');

  if (!from || !to || !amount || !validAfter || !validBefore || !nonce) {
    return fail('Payment authorization is missing required fields.');
  }
  if (!HEX_ADDRESS.test(from) || !HEX_ADDRESS.test(to)) {
    return fail('Payment authorization carries a malformed address.');
  }
  if (!ATOMIC_AMOUNT.test(amount)) {
    return fail('Payment authorization value is not a canonical atomic amount.');
  }
  if (!UNIX_SECONDS.test(validAfter) || !UNIX_SECONDS.test(validBefore)) {
    return fail('Payment authorization validity window is malformed.');
  }
  if (!HEX_32.test(nonce)) {
    return fail('Payment authorization nonce is not a 32-byte hex string.', {
      expectedLength: NONCE_HEX_LENGTH,
    });
  }

  const authorizationValue: X402ExactEvmAuthorization = {
    from,
    to,
    value: amount,
    validAfter,
    validBefore,
    nonce,
  };
  return ok({ authorization: authorizationValue, signature });
}

/**
 * Parse a full `PaymentPayload`.
 *
 * The version check happens here, before anything else is interpreted. A v1
 * payload is refused outright rather than read with v2 eyes.
 */
export function parsePaymentPayload(raw: string): Result<X402PaymentPayload, VerificationFailure> {
  const decoded = decodeHeaderJson(raw);
  if (!decoded.ok) return decoded;

  const body = decoded.value;
  if (!isRecord(body)) {
    return fail('Payment payload is not an object.');
  }

  const version = body['x402Version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return fail('Payment payload has no integer x402Version.');
  }
  if (version !== X402_VERSION) {
    return err(
      verificationFailure(
        'MALFORMED_PROOF',
        `Unsupported x402 version ${version}. This server speaks version ${X402_VERSION}.`,
        { received: version, supported: X402_VERSION },
      ),
    );
  }

  const accepted = parseRequirements(body['accepted']);
  if (!accepted.ok) return accepted;

  const payload = body['payload'];
  if (!isRecord(payload)) {
    return fail('Payment payload `payload` is not an object.');
  }

  const resource = body['resource'];
  if (resource !== undefined && !isRecord(resource)) {
    return fail('Payment payload `resource` is not an object.');
  }
  const extensions = body['extensions'];
  if (extensions !== undefined && !isRecord(extensions)) {
    return fail('Payment payload `extensions` is not an object.');
  }

  const url = resource ? readString(resource, 'url') : null;

  return ok({
    x402Version: version,
    accepted: accepted.value,
    payload: payload as Readonly<Record<string, unknown>>,
    ...(url ? { resource: { url } } : {}),
    ...(extensions ? { extensions: extensions as Readonly<Record<string, unknown>> } : {}),
  });
}
