import type { z } from 'zod';
import { badRequest } from './errors.js';

/**
 * Parse untrusted input with a schema, or fail with a 400 that names the
 * fields. Throwing a raw ZodError would leak the schema's internal shape into
 * the API contract.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw badRequest(
    'invalid_request',
    'Some of the values you sent are not valid.',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  );
}
