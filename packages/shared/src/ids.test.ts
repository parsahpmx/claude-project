import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, isValidId, newId, newRequestId, ulid, ulidTimestamp } from './ids.js';

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes its creation timestamp recoverably', () => {
    const when = Date.UTC(2026, 0, 15, 12, 30, 45);
    expect(ulidTimestamp(ulid(when)).getTime()).toBe(when);
  });

  it('sorts lexicographically in creation order', () => {
    // This is the property that keeps index inserts append-mostly.
    const early = ulid(1_700_000_000_000);
    const late = ulid(1_700_000_001_000);
    expect(early < late).toBe(true);
  });

  it('does not collide across a large batch', () => {
    const count = 10_000;
    const seen = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      seen.add(ulid());
    }
    expect(seen.size).toBe(count);
  });

  it('produces different randomness within the same millisecond', () => {
    const fixed = 1_700_000_000_000;
    const a = ulid(fixed);
    const b = ulid(fixed);
    expect(a).not.toBe(b);
    // Same timestamp component, different random component.
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a.slice(10)).not.toBe(b.slice(10));
  });

  it('rejects invalid timestamps', () => {
    expect(() => ulid(-1)).toThrow();
    expect(() => ulid(Number.NaN)).toThrow();
  });
});

describe('prefixed identifiers', () => {
  it('formats as <prefix>_<ulid>', () => {
    expect(newId('payment')).toMatch(/^pay_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newId('organization')).toMatch(/^org_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('validates its own output for every registered kind', () => {
    for (const kind of Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>) {
      expect(isValidId(kind, newId(kind))).toBe(true);
    }
  });

  it('rejects an ID of the wrong type', () => {
    // Passing an endpoint ID where a payment ID is expected must be caught
    // before it becomes an empty database result.
    expect(isValidId('payment', newId('endpoint'))).toBe(false);
  });

  it.each([
    ['pay_', 'missing body'],
    ['pay_TOOSHORT', 'short body'],
    ['pay_01J8ZC4M9K7QW2VYB3N6XR5TDHEXTRA', 'long body'],
    ['01J8ZC4M9K7QW2VYB3N6XR5TDH', 'missing prefix'],
    ['pay_01J8ZC4M9K7QW2VYB3N6XR5TDI', 'ambiguous character I'],
    ['pay_01j8zc4m9k7qw2vyb3n6xr5tdh', 'lowercase'],
    ["pay_01J8ZC4M9K7QW2VYB3N6XR5T'; DROP TABLE payments;--", 'injection attempt'],
  ])('rejects malformed identifier %s (%s)', (candidate) => {
    expect(isValidId('payment', candidate)).toBe(false);
  });

  it('uses a distinct prefix for every kind', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('mints request IDs', () => {
    expect(newRequestId()).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
