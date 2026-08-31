import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '@meter402/config';
import { Meter402Error } from '@meter402/shared';
import { buildApp, type BuildAppOptions } from './app.js';

function testConfig(): AppConfig {
  return loadConfig({
    DEPLOY_ENV: 'local',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://localhost:5432/meter402',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_SECRET: 'a'.repeat(64),
    API_KEY_HASH_PEPPER: 'b'.repeat(64),
    WEBHOOK_SIGNING_SECRET: 'c'.repeat(64),
    BASE_CHAIN_ID: '84532',
    BASE_RPC_URL: 'https://sepolia.base.org',
    USDC_CONTRACT_ADDRESS: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    DASHBOARD_ORIGIN: 'http://localhost:3000',
  } as NodeJS.ProcessEnv);
}

let app: FastifyInstance | undefined;

const HEALTHY_PROBES = {
  database: async () => true,
  redis: async () => true,
  blockchain: async () => true,
};

async function makeApp(options: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    config: testConfig(),
    silent: true,
    probes: HEALTHY_PROBES,
    ...options,
  });
  return app;
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('GET /health — liveness', () => {
  it('returns 200', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('stays healthy when every dependency is down', async () => {
    // The point of separating liveness from readiness. If /health failed during
    // a database incident, the orchestrator would restart healthy processes and
    // turn a degradation into an outage — dropping in-flight payment
    // verifications with it.
    const instance = await makeApp({
      probes: {
        database: async () => false,
        redis: async () => false,
        blockchain: async () => false,
      },
    });
    expect((await instance.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('GET /ready — readiness', () => {
  it('returns 200 when all dependencies are reachable', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      checks: { database: true, redis: true, blockchain: true },
    });
  });

  it.each(['database', 'redis', 'blockchain'] as const)(
    'returns 503 when %s is unreachable',
    async (failing) => {
      const instance = await makeApp({
        probes: { ...HEALTHY_PROBES, [failing]: async () => false },
      });
      const response = await instance.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json().checks[failing]).toBe(false);
    },
  );

  it('reports not-ready rather than 500 when a probe throws', async () => {
    // The readiness endpoint has to stay reliable precisely when everything
    // else is not.
    const instance = await makeApp({
      probes: {
        ...HEALTHY_PROBES,
        database: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const response = await instance.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.database).toBe(false);
  });

  it('reports only the dependencies it actually probes', async () => {
    // A check that always passes is worse than no check: it reports health
    // nobody verified.
    const instance = await makeApp({ probes: { database: async () => true } });
    const response = await instance.inject({ method: 'GET', url: '/ready' });
    expect(response.json().checks).toEqual({ database: true });
  });
});

describe('error envelope', () => {
  it('returns the standard shape for an unmatched route', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      documentationUrl: 'https://docs.meter402.com/errors/resource_not_found',
    });
    expect(body.error.requestId).toMatch(/^req_/);
  });

  it('maps a domain error to its declared status and code', async () => {
    const instance = await makeApp();
    instance.get('/boom', async () => {
      throw new Meter402Error('PAYMENT_ALREADY_USED');
    });
    const response = await instance.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PAYMENT_ALREADY_USED');
  });

  it('never leaks the message of an unexpected error', async () => {
    // An arbitrary throwable can carry a connection string, another tenant's
    // row, or a file path. None of it belongs in a response body.
    const instance = await makeApp();
    instance.get('/leak', async () => {
      throw new Error('postgresql://admin:hunter2@10.0.0.5/meter402 row for org_other');
    });
    const response = await instance.inject({ method: 'GET', url: '/leak' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('postgresql://');
    expect(response.body).not.toContain('org_other');
  });

  it('does not return a stack trace', async () => {
    const instance = await makeApp();
    instance.get('/boom', async () => {
      throw new Error('kaboom');
    });
    const response = await instance.inject({ method: 'GET', url: '/boom' });
    expect(response.body).not.toContain('at ');
    expect(response.json().error).not.toHaveProperty('stack');
  });

  it('reports malformed JSON as a validation failure, not a server error', async () => {
    const instance = await makeApp();
    instance.post('/echo', async () => ({ ok: true }));
    const response = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken": ',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('reports an oversized body as a client error, not a server error', async () => {
    const instance = await makeApp();
    instance.post('/echo', async () => ({ ok: true }));
    const response = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(300 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('does not forward the message of a non-framework error that claims a 4xx status', async () => {
    // Preserving a 4xx status from framework errors must not become a channel
    // for arbitrary handler messages: only errors carrying an FST_ code (or a
    // schema validation result) are trusted to describe themselves.
    const instance = await makeApp();
    instance.get('/sneaky', async () => {
      throw Object.assign(new Error('internal detail for org_other'), { statusCode: 400 });
    });
    const response = await instance.inject({ method: 'GET', url: '/sneaky' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.body).not.toContain('org_other');
  });
});

describe('request correlation', () => {
  it('returns a request ID in both the header and the error body', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/nope' });
    const header = response.headers['x-request-id'];
    expect(header).toMatch(/^req_/);
    expect(response.json().error.requestId).toBe(header);
  });

  it('mints a distinct ID per request', async () => {
    const instance = await makeApp();
    const first = await instance.inject({ method: 'GET', url: '/health' });
    const second = await instance.inject({ method: 'GET', url: '/health' });
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('does not let a client choose its own request ID', async () => {
    // Accepting a client-supplied ID lets a caller collide correlation IDs
    // with another tenant's traffic, or inject junk into log aggregation.
    const response = await (
      await makeApp()
    ).inject({
      method: 'GET',
      url: '/health',
      headers: { 'request-id': 'attacker-controlled' },
    });
    expect(response.headers['x-request-id']).not.toBe('attacker-controlled');
    expect(response.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('security headers', () => {
  it('sets a restrictive content security policy and nosniff', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/health' });
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not advertise the server implementation', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('omits HSTS outside production, where TLS is not guaranteed', async () => {
    const response = await (await makeApp()).inject({ method: 'GET', url: '/health' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows the configured dashboard origin', async () => {
    const response = await (
      await makeApp()
    ).inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not reflect an arbitrary origin', async () => {
    // A wildcard or reflected origin on a credentialed API turns a dashboard
    // XSS into an account takeover.
    const response = await (
      await makeApp()
    ).inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});
