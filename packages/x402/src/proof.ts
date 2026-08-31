import { err, ok, type Result } from '@meter402/shared';
import { verificationFailure, type VerificationFailure } from '@meter402/payments';
import type { PaymentProof } from '@meter402/payments';
import { MAX_PAYMENT_HEADER_BYTES, X402_PROTOCOL, X402_VERSION } from './constants.js';

/**
 * Decoding the `X-PAYMENT` header.
 *
 * This is an unauthenticated parser sitting in front of a payment endpoint: it
 * runs before we know anything about the caller, on input the caller fully
 * controls. It is written to be total (never throws), bounded (never allocates
 * on demand), and strict (never interprets a malformed payload generously).
 */

/** Strict base64. `Buffer.from(x, 'base64')` silently ignores junk, so validate first. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9\-_]+={0,2}$/;

function decodeBase64(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Base64 expands 3 bytes to 4 characters, so bound the encoded length
  // *before* allocating the decoded buffer.
  if (trimmed.length > Math.ceil((MAX_PAYMENT_HEADER_BYTES * 4) / 3) + 4) {
    return null;
  }

  const isBase64Url = BASE64URL_PATTERN.test(trimmed) && !BASE64_PATTERN.test(trimmed);
  if (!BASE64_PATTERN.test(trimmed) && !BASE64URL_PATTERN.test(trimmed)) {
    return null;
  }

  try {
    const buffer = Buffer.from(trimmed, isBase64Url ? 'base64url' : 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PAYMENT_HEADER_BYTES) {
      return null;
    }
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Parse JSON while refusing prototype-polluting keys.
 *
 * `JSON.parse` will happily produce an object with a `__proto__` key, and a
 * later merge or spread of that object can poison `Object.prototype` for the
 * whole process. The reviver drops those keys outright rather than trying to
 * sanitise them afterwards.
 */
function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Case-insensitive single-value header lookup.
 *
 * A repeated header arrives as an array. That is rejected rather than resolved
 * by picking one: which value a proxy forwards versus which we read is exactly
 * the ambiguity request-smuggling attacks exploit, and there is no legitimate
 * reason to send two payment headers.
 */
export function readSingleHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): { value: string } | { error: 'MISSING' | 'DUPLICATED' } {
  const target = name.toLowerCase();
  let found: string | undefined;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 1) {
        return { error: 'DUPLICATED' };
      }
      const first = value[0];
      if (first === undefined) {
        continue;
      }
      if (found !== undefined) {
        return { error: 'DUPLICATED' };
      }
      found = first;
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (found !== undefined) {
      return { error: 'DUPLICATED' };
    }
    found = value;
  }

  return found === undefined ? { error: 'MISSING' } : { value: found };
}

export interface X402PaymentPayload {
  readonly x402Version: number;
  readonly scheme: string;
  readonly network: string;
  readonly payload: Record<string, unknown>;
}

export function parseX402PaymentHeader(
  headerValue: string,
): Result<PaymentProof, VerificationFailure> {
  const decoded = decodeBase64(headerValue);
  if (decoded === null) {
    return err(
      verificationFailure(
        'MALFORMED_PROOF',
        'The X-PAYMENT header is not valid base64, or exceeds the maximum size.',
      ),
    );
  }

  const parsed = parseJsonSafely(decoded);
  if (!isRecord(parsed)) {
    return err(
      verificationFailure('MALFORMED_PROOF', 'The X-PAYMENT header does not contain a JSON object.'),
    );
  }

  const version = parsed['x402Version'];
  if (version !== X402_VERSION) {
    return err(
      verificationFailure(
        'MALFORMED_PROOF',
        `Unsupported x402 version. This server implements version ${X402_VERSION}.`,
        { received: typeof version === 'number' ? version : null, supported: X402_VERSION },
      ),
    );
  }

  const scheme = readString(parsed, 'scheme');
  const network = readString(parsed, 'network');
  if (scheme === null || network === null) {
    return err(
      verificationFailure('MALFORMED_PROOF', 'The payment payload is missing scheme or network.'),
    );
  }

  const payload = isRecord(parsed['payload']) ? parsed['payload'] : {};

  // The transaction hash may be carried at either level depending on client.
  const transactionHash =
    readString(payload, 'transaction') ??
    readString(payload, 'transactionHash') ??
    readString(parsed, 'transaction');

  if (transactionHash === null) {
    return err(
      verificationFailure(
        'MALFORMED_PROOF',
        'The payment payload does not identify a settlement transaction.',
      ),
    );
  }

  return ok({
    protocol: X402_PROTOCOL,
    transactionHash,
    payer: readString(payload, 'payer') ?? readString(payload, 'from'),
    nonce: readString(payload, 'nonce'),
    // Retained verbatim for audit and dispute resolution. Note this is the
    // decoded payload, not merchant response content — Meter402 stays out of
    // the data plane (product rules 140/141).
    raw: { scheme, network, payload },
  });
}
