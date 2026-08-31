/**
 * Result type.
 *
 * Used where failure is an ordinary, expected outcome that the caller must
 * handle rather than an exceptional condition — most importantly blockchain
 * verification, where "this proof is invalid" is a normal business result that
 * needs to be recorded with a reason code, not an exception to unwind the
 * stack with.
 *
 * Exceptions remain the right tool for programmer errors and genuinely
 * unexpected failures. This is not an attempt to remove `throw` from the
 * codebase.
 */

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/** Extract the value, throwing if the result is an error. Use in tests and at trust boundaries. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Attempted to unwrap a failed Result: ${JSON.stringify(result.error)}`);
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
