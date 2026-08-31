import { describe, expect, it } from 'vitest';
import { MerchantEnvironment } from '@meter402/shared';
import {
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  parseApiKey,
  verifyApiKey,
} from './api-key.js';

const PEPPER = 'a'.repeat(64);
const OTHER_PEPPER = 'b'.repeat(64);

describe('generateApiKey', () => {
  it('produces an environment-prefixed key', () => {
    expect(generateApiKey(MerchantEnvironment.Test, PEPPER).secret).toMatch(
      /^meter_test_[A-Za-z0-9_-]{43}$/,
    );
    expect(generateApiKey(MerchantEnvironment.Live, PEPPER).secret).toMatch(
      /^meter_live_[A-Za-z0-9_-]{43}$/,
    );
  });

  it('carries at least 256 bits of entropy', () => {
    // 43 base64url characters is 32 bytes. Brute force against this is
    // infeasible, which is the premise that makes a fast keyed hash correct.
    //
    // Note the secret cannot be split on '_': base64url's alphabet includes
    // underscore, so the random portion legitimately contains them. Slice past
    // the known prefix instead.
    const secret = generateApiKey(MerchantEnvironment.Test, PEPPER).secret;
    expect(secret.slice('meter_test_'.length)).toHaveLength(43);
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      seen.add(generateApiKey(MerchantEnvironment.Test, PEPPER).secret);
    }
    expect(seen.size).toBe(2_000);
  });

  it('exposes only the last four characters for recognition', () => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    expect(key.lastFour).toHaveLength(4);
    expect(key.secret).toContain(key.lastFour);
    // Short enough to be useless to an attacker.
    expect(key.lastFour.length).toBeLessThan(8);
  });

  it('returns a hash that is not the secret', () => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    expect(key.keyHash).not.toContain(key.secret);
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashApiKey', () => {
  it('is deterministic for the same secret and pepper', () => {
    expect(hashApiKey('meter_test_abc', PEPPER)).toBe(hashApiKey('meter_test_abc', PEPPER));
  });

  it('depends on the pepper', () => {
    // The pepper lives in the secret store, not the database. A database dump
    // alone must not let an attacker verify guessed keys offline.
    expect(hashApiKey('meter_test_abc', PEPPER)).not.toBe(
      hashApiKey('meter_test_abc', OTHER_PEPPER),
    );
  });

  it('refuses an empty pepper', () => {
    // Silently degrading to an unsalted hash would make a database dump
    // directly useful.
    expect(() => hashApiKey('meter_test_abc', '')).toThrow(/pepper/);
  });
});

describe('verifyApiKey', () => {
  it('accepts the correct secret', () => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    expect(verifyApiKey(key.secret, key.keyHash, PEPPER)).toBe(true);
  });

  it('rejects a different secret', () => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    const other = generateApiKey(MerchantEnvironment.Test, PEPPER);
    expect(verifyApiKey(other.secret, key.keyHash, PEPPER)).toBe(false);
  });

  it('rejects the right secret under the wrong pepper', () => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    expect(verifyApiKey(key.secret, key.keyHash, OTHER_PEPPER)).toBe(false);
  });

  it('rejects a secret differing in a single character', () => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    const tampered = `${key.secret.slice(0, -1)}${key.secret.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyApiKey(tampered, key.keyHash, PEPPER)).toBe(false);
  });

  it.each([
    ['', 'empty hash'],
    ['not-hex', 'non-hex hash'],
    ['abcd', 'wrong-length hash'],
  ])('rejects rather than throwing on a malformed stored hash (%s)', (storedHash) => {
    const key = generateApiKey(MerchantEnvironment.Test, PEPPER);
    expect(verifyApiKey(key.secret, storedHash, PEPPER)).toBe(false);
  });
});

describe('parseApiKey', () => {
  it('extracts prefix and environment without a database lookup', () => {
    expect(parseApiKey(generateApiKey(MerchantEnvironment.Test, PEPPER).secret)).toEqual({
      prefix: 'meter_test',
      environment: MerchantEnvironment.Test,
    });
    expect(parseApiKey(generateApiKey(MerchantEnvironment.Live, PEPPER).secret)).toEqual({
      prefix: 'meter_live',
      environment: MerchantEnvironment.Live,
    });
  });

  it.each([
    ['', 'empty'],
    ['meter_test_', 'no secret'],
    ['meter_test_short', 'secret too short'],
    ['meter_prod_aaaaaaaaaaaaaaaaaaaaaaaa', 'unknown environment'],
    // A foreign vendor's prefix. Deliberately not a real provider's format:
    // a Stripe-shaped literal here trips secret scanners on every push, and
    // training people to click past those is how a real leak gets waved
    // through.
    ['othervendor_key_aaaaaaaaaaaaaaaaaaaaa', 'wrong vendor prefix'],
    ['meter_test_aaaa aaaa aaaaaaaaaaaaaaa', 'whitespace in secret'],
    ["meter_test_aaaaaaaaaaaaaaaaaaaaa'--", 'injection characters'],
  ])('rejects a malformed key %s (%s)', (candidate) => {
    expect(parseApiKey(candidate)).toBeNull();
  });
});

describe('extractBearerToken', () => {
  it('extracts a bearer token', () => {
    expect(extractBearerToken('Bearer meter_test_abc')).toBe('meter_test_abc');
  });

  it('accepts any casing of the scheme, per RFC 7235', () => {
    expect(extractBearerToken('bearer meter_test_abc')).toBe('meter_test_abc');
    expect(extractBearerToken('BEARER meter_test_abc')).toBe('meter_test_abc');
  });

  const badHeaders: Array<[string | undefined, string]> = [
    [undefined, 'absent'],
    ['', 'empty'],
    ['meter_test_abc', 'no scheme'],
    ['Basic dXNlcjpwYXNz', 'wrong scheme'],
    ['Bearer', 'no token'],
    ['Bearer a b', 'two tokens'],
  ];

  it.each(badHeaders)('returns null for %s (%s)', (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});
