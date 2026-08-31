import { Meter402Error } from '@meter402/shared';

/**
 * Slugs.
 *
 * Slugs appear in URLs and in customer-visible identifiers, so the character
 * set is deliberately narrow: lowercase alphanumerics and single hyphens. That
 * rules out path traversal, homograph confusion between visually identical
 * names, and the whitespace ambiguities that make two organizations look
 * identical in a list.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 48;

/**
 * Words that must not become slugs because they would collide with routes or
 * impersonate us. `api` and `admin` are routing hazards; the rest are phishing
 * hazards in a URL like meter402.com/<slug>.
 */
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'admin',
  'dashboard',
  'app',
  'www',
  'meter402',
  'support',
  'billing',
  'security',
  'login',
  'signup',
  'settings',
  'internal',
  'system',
  'null',
  'undefined',
]);

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export function isValidSlug(value: string): boolean {
  return (
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value) &&
    !RESERVED_SLUGS.has(value)
  );
}

export function assertValidSlug(value: string, field = 'slug'): void {
  if (!isValidSlug(value)) {
    throw new Meter402Error(
      'VALIDATION_FAILED',
      RESERVED_SLUGS.has(value)
        ? `The ${field} "${value}" is reserved.`
        : `The ${field} must be ${SLUG_MIN_LENGTH}-${SLUG_MAX_LENGTH} characters of ` +
            `lowercase letters, digits, and single hyphens.`,
      { details: { field, value } },
    );
  }
}

/** Lowercase and trim an email for storage in `email_normalized`. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
