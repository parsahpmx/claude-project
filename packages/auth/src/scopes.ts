import { Meter402Error } from '@meter402/shared';
import type { MerchantEnvironment } from '@meter402/shared';
import type { ApiKeyPrincipal } from './principal.js';

/**
 * API key scopes.
 *
 * Scopes are the machine analogue of permissions, and they are evaluated
 * *separately* from human RBAC (product rule 19). Belonging to a valid project
 * is not authority: a key minted for reading analytics must not be able to
 * create endpoints, even though both live in the same project.
 *
 * The scope vocabulary is deliberately smaller than the permission vocabulary.
 * Machines consume the payment surface; they do not manage members, billing,
 * or other API keys. A credential that could mint further credentials would
 * make revocation meaningless.
 */

export const API_KEY_SCOPES = [
  'payments:read',
  'payments:write',
  'endpoints:read',
  'endpoints:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set<string>(API_KEY_SCOPES);

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return SCOPE_SET.has(value);
}

/**
 * Validate a requested scope list, rejecting anything unknown.
 *
 * Unknown scopes are rejected rather than dropped. Silently ignoring an
 * unrecognised scope would let a client believe it had been granted authority
 * it does not hold, and the resulting failure would surface later at a
 * confusing place.
 */
export function parseScopes(values: readonly string[]): readonly ApiKeyScope[] {
  const invalid = values.filter((value) => !isApiKeyScope(value));
  if (invalid.length > 0) {
    throw new Meter402Error('INVALID_SCOPE', `Unknown scope(s): ${invalid.join(', ')}.`, {
      details: { invalid, supported: [...API_KEY_SCOPES] },
    });
  }
  // De-duplicate; a repeated scope grants nothing extra and only confuses
  // display.
  return [...new Set(values as readonly ApiKeyScope[])];
}

export function hasScope(principal: ApiKeyPrincipal, scope: ApiKeyScope): boolean {
  return principal.scopes.includes(scope);
}

export function requireScope(principal: ApiKeyPrincipal, scope: ApiKeyScope): void {
  if (!hasScope(principal, scope)) {
    throw new Meter402Error('PERMISSION_DENIED', `This API key does not have the ${scope} scope.`, {
      details: { requiredScope: scope },
    });
  }
}

/**
 * Environment confinement (product rule 20).
 *
 * A TEST key must never authorize a LIVE operation. This is the last line of
 * a defence that also exists in the chain/asset registry, but it belongs here
 * too: by the time a request reaches a handler, the only thing standing
 * between a test credential and real money is this check.
 */
export function requireEnvironment(
  principal: ApiKeyPrincipal,
  required: MerchantEnvironment,
): void {
  if (principal.environment !== required) {
    throw new Meter402Error(
      'ENVIRONMENT_MISMATCH',
      `This ${principal.environment} API key cannot be used for ${required} operations.`,
      { details: { keyEnvironment: principal.environment, required } },
    );
  }
}
