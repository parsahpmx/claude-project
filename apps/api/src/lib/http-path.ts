import { Meter402Error } from '@meter402/shared';

/**
 * Endpoint path handling.
 *
 * Two jobs, kept deliberately separate:
 *
 *  - **Validation** rejects anything structurally unsuitable.
 *  - **Normalisation** produces the canonical form the uniqueness invariant is
 *    computed over.
 *
 * What this explicitly does NOT do is filesystem-style resolution. Collapsing
 * `/a/../b` to `/b` is the classic path-traversal normaliser, and every
 * few years someone finds a way to make one disagree with the router in front
 * of it — which is precisely the disagreement traversal attacks exploit. A
 * merchant has no legitimate reason to register a route containing `..`, so we
 * *reject* rather than *resolve*. Refusing an odd input is always safer than
 * rewriting it into something that looks safe.
 */

export const MAX_PATH_LENGTH = 512;

/** Printable ASCII except space, which is what a URL path may contain here. */
const ALLOWED_PATH = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%{}]+$/;

export function assertValidPath(path: string): void {
  const trimmed = path.trim();

  if (trimmed.length === 0) {
    throw new Meter402Error('VALIDATION_FAILED', 'Endpoint path must not be empty.');
  }
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new Meter402Error(
      'VALIDATION_FAILED',
      `Endpoint path must be at most ${MAX_PATH_LENGTH} characters.`,
    );
  }
  if (!trimmed.startsWith('/')) {
    throw new Meter402Error('VALIDATION_FAILED', 'Endpoint path must start with "/".');
  }
  if (trimmed.includes('..')) {
    // Rejected, never resolved. See the note above.
    throw new Meter402Error('VALIDATION_FAILED', 'Endpoint path must not contain "..".', {
      details: { path: trimmed },
    });
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    // A query string or fragment is not part of the path, and accepting one
    // would make two endpoints that differ only in query look distinct.
    throw new Meter402Error(
      'VALIDATION_FAILED',
      'Endpoint path must not contain a query string or fragment.',
    );
  }
  /*
   * `no-control-regex` is disabled deliberately: matching control characters
   * is the entire purpose of this expression. The rule exists to catch them
   * appearing by accident, which is the opposite of what happens here.
   */
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    // A control character — a null byte above all — can truncate the value
    // differently in different consumers, so two endpoints that a router
    // sees as distinct could collide here, or vice versa.
    throw new Meter402Error(
      'VALIDATION_FAILED',
      'Endpoint path must not contain control characters.',
    );
  }
  if (!ALLOWED_PATH.test(trimmed)) {
    throw new Meter402Error(
      'VALIDATION_FAILED',
      'Endpoint path contains characters that are not valid in a URL path.',
    );
  }
}

/**
 * Canonical form for the uniqueness invariant.
 *
 * Lowercased, single leading slash, duplicate slashes collapsed, trailing
 * slash removed. Purely lexical — no segment resolution.
 *
 * Lowercasing means `/Research` and `/research` cannot both be registered.
 * That is stricter than HTTP requires (paths are case-sensitive), and it is
 * the right trade: two endpoints differing only in case is far more likely to
 * be a mistake a merchant wants caught than a deliberate design, and the
 * failure mode of not catching it — payments routed to whichever row a lookup
 * happened to find — is much worse than the inconvenience.
 */
export function normalizePath(path: string): string {
  const collapsed = `/${path.trim()}`.replace(/\/+/g, '/').toLowerCase();
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}
