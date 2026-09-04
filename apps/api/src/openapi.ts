import type { FastifyInstance } from 'fastify';

/**
 * The OpenAPI document, built from the routes the server actually has.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Fastify knows its own routing table, so the path list here is *derived*
 * rather than written down. A hand-maintained spec drifts the first time
 * someone adds a route and forgets the YAML, and a spec that lies is worse
 * than none — a client generated from it fails in ways that look like server
 * bugs.
 *
 * Descriptions and schemas are still authored: those cannot be inferred, and
 * pretending otherwise would produce a document that is accurate and useless.
 * The test alongside this file fails when a route exists with no description,
 * so the two halves cannot fall out of step.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: Readonly<Record<string, unknown>>;
  readonly servers: readonly { url: string; description: string }[];
  readonly components: Readonly<Record<string, unknown>>;
  readonly security: readonly Readonly<Record<string, readonly string[]>>[];
  readonly paths: Readonly<Record<string, Record<string, unknown>>>;
  readonly tags: readonly { name: string; description: string }[];
}

/** A route as Fastify reports it, narrowed to what we need. */
interface RouteInfo {
  readonly method: string;
  readonly url: string;
}

/**
 * What each route is for.
 *
 * Keyed by `METHOD /path` exactly as Fastify registers it. Anything missing
 * from here shows up as an undocumented route in the test, which is the point.
 */
const DESCRIPTIONS: Readonly<Record<string, { summary: string; tag: string; auth: Auth }>> = {
  'GET /health': { summary: 'Liveness. Touches no dependency.', tag: 'Health', auth: 'none' },
  'GET /ready': {
    summary: 'Readiness. Checks the dependencies this deployment needs to serve traffic.',
    tag: 'Health',
    auth: 'none',
  },
  'GET /health/payments': {
    summary: 'Payment-system status, settlement backlog, and metrics.',
    tag: 'Health',
    auth: 'none',
  },

  'POST /v1/dev/sessions': {
    summary: 'Mint a development session token. Not registered in staging or production.',
    tag: 'Development',
    auth: 'none',
  },
  'GET /v1/me': { summary: 'Describe the calling credential.', tag: 'Identity', auth: 'either' },

  'POST /v1/organizations': { summary: 'Create an organization.', tag: 'Identity', auth: 'user' },
  'GET /v1/organizations': {
    summary: "List the caller's organizations.",
    tag: 'Identity',
    auth: 'user',
  },
  'GET /v1/organizations/:organizationId': {
    summary: 'Read an organization.',
    tag: 'Identity',
    auth: 'user',
  },
  'PATCH /v1/organizations/:organizationId': {
    summary: 'Rename an organization.',
    tag: 'Identity',
    auth: 'user',
  },
  'GET /v1/organizations/:organizationId/members': {
    summary: 'List members.',
    tag: 'Identity',
    auth: 'user',
  },
  'POST /v1/organizations/:organizationId/members': {
    summary: 'Invite a member.',
    tag: 'Identity',
    auth: 'user',
  },
  'PATCH /v1/organizations/:organizationId/members/:membershipId': {
    summary: "Change a member's role.",
    tag: 'Identity',
    auth: 'user',
  },
  'DELETE /v1/organizations/:organizationId/members/:membershipId': {
    summary: 'Remove a member.',
    tag: 'Identity',
    auth: 'user',
  },

  'POST /v1/projects': { summary: 'Create a project.', tag: 'Projects', auth: 'user' },
  'GET /v1/projects': { summary: 'List projects.', tag: 'Projects', auth: 'user' },
  'GET /v1/projects/:projectId': { summary: 'Read a project.', tag: 'Projects', auth: 'user' },
  'PATCH /v1/projects/:projectId': { summary: 'Update a project.', tag: 'Projects', auth: 'user' },
  'DELETE /v1/projects/:projectId': {
    summary: 'Archive a project.',
    tag: 'Projects',
    auth: 'user',
  },

  'POST /v1/projects/:projectId/api-keys': {
    summary: 'Issue an API key. The secret is returned exactly once.',
    tag: 'API keys',
    auth: 'user',
  },
  'GET /v1/projects/:projectId/api-keys': {
    summary: 'List API keys. Never includes secrets.',
    tag: 'API keys',
    auth: 'user',
  },
  'POST /v1/projects/:projectId/api-keys/:apiKeyId/rotate': {
    summary: 'Rotate a key. The old secret stops working immediately.',
    tag: 'API keys',
    auth: 'user',
  },
  'DELETE /v1/projects/:projectId/api-keys/:apiKeyId': {
    summary: 'Revoke a key. Takes effect on the next request.',
    tag: 'API keys',
    auth: 'user',
  },

  'POST /v1/endpoints': { summary: 'Register a priced endpoint.', tag: 'Endpoints', auth: 'user' },
  'GET /v1/endpoints': {
    summary: 'List endpoints. An API key sees its own project and environment only.',
    tag: 'Endpoints',
    auth: 'either',
  },
  'GET /v1/endpoints/:endpointId': { summary: 'Read an endpoint.', tag: 'Endpoints', auth: 'user' },
  'PATCH /v1/endpoints/:endpointId': {
    summary: 'Update an endpoint, including its price.',
    tag: 'Endpoints',
    auth: 'user',
  },
  'DELETE /v1/endpoints/:endpointId': {
    summary: 'Archive an endpoint.',
    tag: 'Endpoints',
    auth: 'user',
  },

  'PUT /v1/organizations/:organizationId/settlement': {
    summary: 'Set a settlement destination. Human-only, audited.',
    tag: 'Settlement',
    auth: 'user',
  },
  'GET /v1/organizations/:organizationId/settlement': {
    summary: 'Read settlement destinations.',
    tag: 'Settlement',
    auth: 'user',
  },
  'PATCH /v1/organizations/:organizationId/settlement/:settlementConfigId': {
    summary: 'Change a settlement destination. Human-only, audited.',
    tag: 'Settlement',
    auth: 'user',
  },

  'POST /v1/authorize': {
    summary: 'Decide one inbound request: a 402 to send, or permission to proceed.',
    tag: 'Payments',
    auth: 'apiKey',
  },
  'GET /v1/payments': { summary: 'List payments.', tag: 'Payments', auth: 'either' },
  'GET /v1/payments/:paymentId': { summary: 'Read a payment.', tag: 'Payments', auth: 'either' },
  'GET /v1/receipts': { summary: 'List receipts.', tag: 'Payments', auth: 'either' },
  'GET /v1/receipts/:receiptId': { summary: 'Read a receipt.', tag: 'Payments', auth: 'either' },
  'GET /v1/payment-requests/:paymentRequestId': {
    summary: 'Read a payment request.',
    tag: 'Payments',
    auth: 'either',
  },
  'POST /v1/test/payment-requests/:paymentRequestId/complete': {
    summary: 'Settle a TEST payment through the simulator. TEST credentials only.',
    tag: 'Payments',
    auth: 'either',
  },

  'GET /v1/paid/*': { summary: 'The agent-facing paid surface.', tag: 'Paid', auth: 'apiKey' },
  'POST /v1/paid/*': { summary: 'The agent-facing paid surface.', tag: 'Paid', auth: 'apiKey' },
  'PUT /v1/paid/*': { summary: 'The agent-facing paid surface.', tag: 'Paid', auth: 'apiKey' },
  'PATCH /v1/paid/*': { summary: 'The agent-facing paid surface.', tag: 'Paid', auth: 'apiKey' },
  'DELETE /v1/paid/*': { summary: 'The agent-facing paid surface.', tag: 'Paid', auth: 'apiKey' },
};

type Auth = 'none' | 'user' | 'apiKey' | 'either';

const SECURITY: Readonly<Record<Auth, ReadonlyArray<Record<string, string[]>>>> = {
  none: [],
  user: [{ sessionToken: [] }],
  apiKey: [{ apiKey: [] }],
  either: [{ sessionToken: [] }, { apiKey: [] }],
};

/** Fastify path parameters to OpenAPI ones: `:id` becomes `{id}`. */
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\*$/, '{path}');
}

/**
 * Every route the server has registered.
 *
 * Collected through Fastify's `onRoute` hook rather than parsed out of
 * `printRoutes`, whose output is a tree of path *fragments* — a router mounted
 * under a prefix shows up as `/members`, not `/v1/organizations/:id/members`.
 * The hook reports the full URL each route was registered with, which is the
 * only form worth comparing a specification against.
 */
const ROUTES = new WeakMap<FastifyInstance, RouteInfo[]>();

/** Start recording. Must run before any route is registered. */
export function recordRoutes(app: FastifyInstance): void {
  const collected: RouteInfo[] = [];
  ROUTES.set(app, collected);

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const normalized = method.toUpperCase();
      if (normalized === 'HEAD' || normalized === 'OPTIONS') continue;
      collected.push({ method: normalized, url: route.url });
    }
  });
}

export function listRoutes(app: FastifyInstance): readonly RouteInfo[] {
  return ROUTES.get(app) ?? [];
}

export function buildOpenApiDocument(app: FastifyInstance, baseUrl: string): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of listRoutes(app)) {
    const key = `${route.method} ${route.url}`;
    const described = DESCRIPTIONS[key];
    // Undocumented routes are omitted rather than guessed at; the test names
    // them so they get a description instead of an invented one.
    if (!described) continue;

    const path = toOpenApiPath(route.url);
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      summary: described.summary,
      tags: [described.tag],
      security: SECURITY[described.auth],
      responses: {
        '200': { description: 'Success.', content: jsonContent('Envelope') },
        '4XX': { description: 'The request was refused.', content: jsonContent('Error') },
        '5XX': { description: 'Something went wrong on our side.', content: jsonContent('Error') },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Meter402',
      version: '0.1.0',
      description:
        'Billing infrastructure for autonomous software.\n\n' +
        'Base mainnet is disabled; see docs/MAINNET_READINESS.md.',
    },
    servers: [{ url: baseUrl, description: 'This deployment' }],
    tags: [
      { name: 'Health', description: 'Liveness, readiness, and payment-system status.' },
      { name: 'Identity', description: 'Users, organizations, and membership.' },
      { name: 'Projects', description: 'Projects, the unit of TEST/LIVE separation.' },
      { name: 'API keys', description: 'Machine credentials, scoped to one project.' },
      { name: 'Endpoints', description: 'Priced routes.' },
      { name: 'Settlement', description: 'Where money goes. Human-only.' },
      { name: 'Payments', description: 'Authorization, payments, and receipts.' },
      { name: 'Paid', description: 'The agent-facing surface.' },
      { name: 'Development', description: 'Absent outside development.' },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'A Meter402 API key. Scoped to one project and one environment.',
        },
        sessionToken: {
          type: 'http',
          scheme: 'bearer',
          description: "A human session token. Carries a person's role, not a project.",
        },
      },
      schemas: {
        Envelope: {
          type: 'object',
          description: 'Every successful response wraps its payload in `data`.',
          properties: { data: {} },
          required: ['data'],
        },
        Error: {
          type: 'object',
          description: 'Every failure has this shape, whatever went wrong.',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Stable, machine-readable.' },
                message: { type: 'string' },
                requestId: { type: 'string', description: 'Quote this in support requests.' },
                documentationUrl: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
    security: [{ apiKey: [] }],
    paths,
  };
}

function jsonContent(schema: string): Record<string, unknown> {
  return { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } };
}

/**
 * Serve the document at `/openapi.json`.
 *
 * Generated per request from the live routing table. A stale file committed to
 * the repository is the failure mode this avoids: what is served is what the
 * server has.
 */
export function registerOpenApiRoute(app: FastifyInstance, baseUrl: string): void {
  app.get('/openapi.json', async () => buildOpenApiDocument(app, baseUrl));
}
