import { z } from 'zod';
import { Meter402Error, isValidAddress } from '@meter402/shared';

/**
 * Boundary validation.
 *
 * Everything crossing the HTTP boundary is `unknown` until it passes through
 * one of these. Zod failures become VALIDATION_FAILED with per-field detail,
 * which is safe to return: the caller supplied the input, so describing what
 * was wrong with it discloses nothing they did not already know.
 */

function toIssueDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Meter402Error('VALIDATION_FAILED', `Invalid ${what}.`, {
      details: toIssueDetails(result.error),
    });
  }
  return result.data;
}

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseWith(schema, value ?? {}, 'request body');
}

export function parseParams<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseWith(schema, value, 'path parameters');
}

export function parseQuery<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseWith(schema, value ?? {}, 'query parameters');
}

/**
 * A merchant settlement address.
 *
 * Validated where it is written rather than only where it is read. This is the
 * column that decides where a merchant's revenue lands, so accepting a
 * malformed value and discovering it at payment time — when an agent's request
 * fails for reasons the merchant cannot see — is the wrong trade. Stored
 * lowercased so that address comparison never depends on EIP-55 casing.
 *
 * Null is permitted and means "not configured": a TEST payment can still be
 * simulated without one, a LIVE payment cannot.
 */
const addressSchema = z
  .string()
  .trim()
  .refine((value) => isValidAddress(value), {
    message: 'Must be a 20-byte hex address (0x followed by 40 hex characters).',
  })
  .transform((value) => value.toLowerCase());

/** An address, or null to clear it. */
export const settlementAddressSchema = addressSchema.nullable();

/**
 * An address that must be present.
 *
 * Used where the address *is* the resource — a settlement destination without
 * one is not a destination — as opposed to a nullable field on some larger
 * object, where null legitimately means "not configured".
 */
export const requiredSettlementAddressSchema = addressSchema;
