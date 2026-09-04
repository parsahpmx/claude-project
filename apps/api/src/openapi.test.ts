import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildOpenApiDocument, listRoutes } from './openapi.js';
import { createHarness, hasDatabase, type Harness } from './test-support/harness.js';

/**
 * The OpenAPI document.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The reason this file exists is drift. A specification maintained by hand
 * describes the server someone remembered; this one is generated from
 * Fastify's routing table, and these tests fail when the two halves — the
 * routes and their descriptions — fall out of step.
 *
 * The undocumented-routes test is the important one. It fails on a route that
 * exists with nothing written about it, which is exactly the moment to write
 * something rather than six months later when a client generated from the
 * spec mysteriously cannot reach it.
 * ─────────────────────────────────────────────────────────────────────────
 */

/*
 * Built through the harness rather than a bare `buildApp`, because the whole
 * point is to compare the document against the *complete* routing table. An
 * app without the v1 routes would make the drift check pass by having almost
 * nothing to check.
 */
describe.skipIf(!hasDatabase)('OpenAPI document', () => {
  let harness: Harness;
  let instance: FastifyInstance;

  beforeAll(async () => {
    harness = await createHarness({ settlement: true });
    instance = harness.app;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('describes every route the server has', async () => {
    const document = buildOpenApiDocument(instance, 'https://api.example');

    const described = new Set<string>();
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations)) {
        described.add(`${method.toUpperCase()} ${path}`);
      }
    }

    const undocumented = listRoutes(instance)
      .map((route) => ({
        key: `${route.method} ${route.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\*$/, '{path}')}`,
        raw: `${route.method} ${route.url}`,
      }))
      // The spec route describes itself; nothing else is exempt.
      .filter((route) => route.raw !== 'GET /openapi.json')
      .filter((route) => !described.has(route.key))
      .map((route) => route.raw);

    expect(
      undocumented,
      `These routes have no description in openapi.ts. Add one:\n  ${undocumented.join('\n  ')}`,
    ).toEqual([]);
  });

  it('does not describe routes the server does not have', async () => {
    const document = buildOpenApiDocument(instance, 'https://api.example');
    const real = new Set(
      listRoutes(instance).map(
        (route) =>
          `${route.method} ${route.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\*$/, '{path}')}`,
      ),
    );

    const phantom: string[] = [];
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations)) {
        const key = `${method.toUpperCase()} ${path}`;
        if (!real.has(key)) phantom.push(key);
      }
    }

    // A spec naming a route that does not exist produces a generated client
    // that fails in a way that looks like a server bug.
    expect(phantom).toEqual([]);
  });

  it('marks the paid and authorize surfaces as API-key only', async () => {
    const document = buildOpenApiDocument(instance, 'https://api.example');

    for (const path of ['/v1/authorize', '/v1/paid/{path}']) {
      const operations = document.paths[path];
      expect(operations, path).toBeTruthy();
      for (const operation of Object.values(operations!)) {
        const security = (operation as { security: Array<Record<string, unknown>> }).security;
        expect(
          security.map((scheme) => Object.keys(scheme)[0]),
          path,
        ).toEqual(['apiKey']);
      }
    }
  });

  it('marks health routes as needing no credential', async () => {
    const document = buildOpenApiDocument(instance, 'https://api.example');
    for (const path of ['/health', '/ready']) {
      const get = document.paths[path]?.['get'] as { security: unknown[] } | undefined;
      expect(get?.security, path).toEqual([]);
    }
  });

  it('is served, and is valid enough to generate a client from', async () => {
    const response = await instance.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);

    const document = response.json();
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('Meter402');
    expect(Object.keys(document.paths).length).toBeGreaterThan(20);

    // Every operation names a tag that the document declares.
    const tags = new Set((document.tags as Array<{ name: string }>).map((tag) => tag.name));
    for (const operations of Object.values(document.paths as Record<string, object>)) {
      for (const operation of Object.values(operations)) {
        for (const tag of (operation as { tags: string[] }).tags) {
          expect(tags.has(tag), `undeclared tag: ${tag}`).toBe(true);
        }
      }
    }
  });

  it('says plainly that mainnet is disabled', async () => {
    const document = buildOpenApiDocument(instance, 'https://api.example');
    // The first thing anyone evaluating this API needs to know.
    expect(String(document.info['description'])).toMatch(/mainnet is disabled/i);
  });
});
