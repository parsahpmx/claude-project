import { describe, expect, it } from 'vitest';
import { Meter402Error, MerchantEnvironment } from '@meter402/shared';
import {
  API_KEY_SCOPES,
  hasScope,
  isApiKeyScope,
  parseScopes,
  requireEnvironment,
  requireScope,
} from './scopes.js';
import type { ApiKeyPrincipal } from './principal.js';

function key(overrides: Partial<ApiKeyPrincipal> = {}): ApiKeyPrincipal {
  return {
    type: 'api_key',
    apiKeyId: 'key_test',
    organizationId: 'org_test',
    projectId: 'prj_test',
    environment: MerchantEnvironment.Test,
    scopes: ['payments:read'],
    ...overrides,
  };
}

describe('scope vocabulary', () => {
  it('has no duplicates', () => {
    expect(new Set(API_KEY_SCOPES).size).toBe(API_KEY_SCOPES.length);
  });

  it('recognises real scopes and rejects invented ones', () => {
    expect(isApiKeyScope('payments:write')).toBe(true);
    expect(isApiKeyScope('organization:delete')).toBe(false);
    expect(isApiKeyScope('*')).toBe(false);
    expect(isApiKeyScope('')).toBe(false);
  });

  it('grants machines no authority over people, billing, or other credentials', () => {
    // A credential that could mint further credentials would make revocation
    // meaningless; one that could change members would make a leaked key an
    // account takeover rather than a data exposure.
    const forbidden = ['members:', 'billing:', 'api_keys:', 'organization:', 'audit:'];
    for (const scope of API_KEY_SCOPES) {
      for (const prefix of forbidden) {
        expect(scope.startsWith(prefix), `${scope} must not exist`).toBe(false);
      }
    }
  });
});

describe('parseScopes', () => {
  it('accepts a valid list', () => {
    expect(parseScopes(['payments:read', 'endpoints:write'])).toEqual([
      'payments:read',
      'endpoints:write',
    ]);
  });

  it('accepts an empty list, which grants nothing', () => {
    expect(parseScopes([])).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(parseScopes(['payments:read', 'payments:read'])).toEqual(['payments:read']);
  });

  it('rejects an unknown scope rather than silently dropping it', () => {
    // Dropping it would let a client believe it holds authority it does not,
    // and surface the failure later somewhere confusing.
    expect(() => parseScopes(['payments:read', 'payments:delete'])).toThrow(Meter402Error);
    try {
      parseScopes(['nonsense']);
    } catch (error) {
      const typed = error as Meter402Error;
      expect(typed.code).toBe('INVALID_SCOPE');
      expect(typed.httpStatus).toBe(422);
      expect(typed.details).toMatchObject({ invalid: ['nonsense'] });
    }
  });

  it.each([
    'members:remove',
    'organization:delete',
    'api_keys:create',
    'billing:manage',
    '*',
    'payments:*',
    'PAYMENTS:READ',
  ])('rejects privilege-escalating or malformed scope %s', (scope) => {
    expect(() => parseScopes([scope])).toThrow(Meter402Error);
  });
});

describe('requireScope', () => {
  it('permits a held scope', () => {
    expect(() => requireScope(key({ scopes: ['payments:read'] }), 'payments:read')).not.toThrow();
  });

  it('denies a scope the key does not hold', () => {
    // Belonging to a valid project is not authority (product rule 19).
    try {
      requireScope(key({ scopes: ['payments:read'] }), 'payments:write');
      expect.unreachable('expected scope denial');
    } catch (error) {
      const typed = error as Meter402Error;
      expect(typed.code).toBe('PERMISSION_DENIED');
      expect(typed.details).toMatchObject({ requiredScope: 'payments:write' });
    }
  });

  it('denies every scope for a key with none', () => {
    for (const scope of API_KEY_SCOPES) {
      expect(hasScope(key({ scopes: [] }), scope)).toBe(false);
    }
  });

  it('does not treat a read scope as implying write', () => {
    expect(hasScope(key({ scopes: ['endpoints:read'] }), 'endpoints:write')).toBe(false);
    expect(hasScope(key({ scopes: ['webhooks:read'] }), 'webhooks:write')).toBe(false);
  });
});

describe('requireEnvironment', () => {
  it('permits a matching environment', () => {
    expect(() =>
      requireEnvironment(key({ environment: MerchantEnvironment.Test }), MerchantEnvironment.Test),
    ).not.toThrow();
  });

  it('refuses a TEST key for a LIVE operation', () => {
    // Product rule 20. This is the last thing standing between a test
    // credential and real money.
    try {
      requireEnvironment(key({ environment: MerchantEnvironment.Test }), MerchantEnvironment.Live);
      expect.unreachable('expected environment rejection');
    } catch (error) {
      const typed = error as Meter402Error;
      expect(typed.code).toBe('ENVIRONMENT_MISMATCH');
      expect(typed.httpStatus).toBe(403);
    }
  });

  it('refuses a LIVE key for a TEST operation', () => {
    expect(() =>
      requireEnvironment(key({ environment: MerchantEnvironment.Live }), MerchantEnvironment.Test),
    ).toThrow(Meter402Error);
  });
});
