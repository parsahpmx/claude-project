import { type z } from 'zod';
import { Meter402Error } from '@meter402/shared';

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
