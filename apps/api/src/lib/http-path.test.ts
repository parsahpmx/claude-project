import { describe, expect, it } from 'vitest';
import { Meter402Error } from '@meter402/shared';
import { assertValidPath, isHttpMethod, normalizePath, MAX_PATH_LENGTH } from './http-path.js';

describe('assertValidPath', () => {
  it('accepts ordinary endpoint paths', () => {
    for (const path of ['/research', '/v1/agents/search', '/a-b_c.d~e', '/items/{id}']) {
      expect(() => assertValidPath(path)).not.toThrow();
    }
  });

  const rejected: ReadonlyArray<[string, string]> = [
    ['', 'empty'],
    ['   ', 'blank'],
    ['research', 'missing leading slash'],
    ['/a/../b', 'traversal'],
    ['/..', 'traversal at the end'],
    ['/search?q=1', 'query string'],
    ['/page#anchor', 'fragment'],
    ['/a b', 'space'],
    ['/a\\b', 'backslash'],
    ['/héllo', 'non-ASCII'],
  ];

  it.each(rejected)('rejects %j (%s)', (path) => {
    expect(() => assertValidPath(path)).toThrow(Meter402Error);
  });

  it('rejects a path carrying a null byte', () => {
    // A null byte truncates differently in different consumers, so two paths
    // a router sees as distinct could collide here — or the reverse.
    expect(() => assertValidPath('/research\u0000.json')).toThrow(/control characters/);
  });

  it('rejects an embedded control character', () => {
    // Embedded, not trailing: surrounding whitespace is trimmed first, so a
    // path ending in a newline is simply the trimmed path and is fine.
    expect(() => assertValidPath('/rese\u000aarch')).toThrow(/control characters/);
    expect(() => assertValidPath('/rese\u001farch')).toThrow(/control characters/);
    expect(() => assertValidPath('/rese\u007farch')).toThrow(/control characters/);
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    expect(() => assertValidPath('  /research\n')).not.toThrow();
  });

  it('rejects a path longer than the limit', () => {
    expect(() => assertValidPath(`/${'a'.repeat(MAX_PATH_LENGTH)}`)).toThrow(/at most/);
  });

  it('rejects rather than resolves traversal', () => {
    /*
     * The security property, stated as a test: `/a/../b` must not become
     * `/b`. A normaliser that resolves segments can disagree with the router
     * in front of it, and that disagreement is what traversal attacks
     * exploit. Refusing an odd input is always safer than rewriting it into
     * something that looks safe.
     */
    expect(() => assertValidPath('/a/../b')).toThrow();
    expect(normalizePath('/a/b')).toBe('/a/b');
  });
});

describe('normalizePath', () => {
  it.each([
    ['/Research', '/research'],
    ['/research/', '/research'],
    ['//research//deep//', '/research/deep'],
    ['research', '/research'],
    ['  /research  ', '/research'],
    ['/', '/'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const path of ['/Research/', '//a//b//', '/x']) {
      const once = normalizePath(path);
      expect(normalizePath(once)).toBe(once);
    }
  });

  it('collapses case so /Research and /research cannot both be registered', () => {
    expect(normalizePath('/Research')).toBe(normalizePath('/research'));
  });

  it('does not merge paths that differ in a real segment', () => {
    expect(normalizePath('/research')).not.toBe(normalizePath('/research2'));
  });
});

describe('isHttpMethod', () => {
  it('accepts the supported methods', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isHttpMethod(method)).toBe(true);
    }
  });

  it('rejects anything else, including lowercase', () => {
    for (const method of ['get', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', '']) {
      expect(isHttpMethod(method)).toBe(false);
    }
  });
});
