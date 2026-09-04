import { describe, expect, it } from 'vitest';
import { createMeter402, type Meter402 } from '../index.js';
import { protect as expressProtect } from './express.js';
import { protect as fastifyProtect } from './fastify.js';
import { withMeter402 } from './next.js';

/**
 * The framework adapters.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Three shapes of the same three steps, so the tests are the same three
 * questions asked three ways:
 *
 *   paid      → the handler runs, and can see what paid for it
 *   unpaid    → the handler does NOT run, and the challenge is sent verbatim
 *   we are down → the handler does NOT run by default
 *
 * The middle one is the one worth being paranoid about. An adapter that sends
 * a 402 but lets the handler run anyway has served the resource for free while
 * looking, in every log and every test that only checks status codes, exactly
 * like it worked.
 * ─────────────────────────────────────────────────────────────────────────
 */

function meterReturning(body: unknown, status = 200): Meter402 {
  return createMeter402({
    apiKey: 'k',
    fetch: (async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch,
  });
}

function meterThatIsDown(): Meter402 {
  return createMeter402({
    apiKey: 'k',
    fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
  });
}

const AUTHORIZED = {
  data: {
    outcome: 'AUTHORIZED',
    paymentRequestId: 'preq_01',
    payment: {
      id: 'pay_01',
      receiptId: 'rcpt_01',
      amountMinorUnits: '30000',
      asset: 'USDC',
      simulated: true,
    },
    endpoint: { id: 'end_01', name: 'Research', path: '/research', method: 'POST' },
  },
};

const UNPAID = {
  data: {
    outcome: 'PAYMENT_REQUIRED',
    paymentRequestId: 'preq_02',
    respondWith: {
      status: 402,
      headers: { 'payment-required': 'challenge-blob' },
      body: { error: 'PAYMENT_REQUIRED' },
    },
  },
};

/* ── Express ────────────────────────────────────────────────────────────── */

function expressDouble() {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown } = {
    headers: {},
  };
  let nextCalled = false;

  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    set(field: string, value: string) {
      sent.headers[field] = value;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
    send(body?: unknown) {
      sent.body = body;
      return res;
    },
  };

  return {
    res,
    sent,
    next: () => {
      nextCalled = true;
    },
    handlerRan: () => nextCalled,
  };
}

describe('express adapter', () => {
  it('runs the handler and attaches the payment when authorized', async () => {
    const { res, next, handlerRan } = expressDouble();
    const req = { method: 'POST', path: '/research', headers: {} } as never;

    await expressProtect(meterReturning(AUTHORIZED))(req, res as never, next);

    expect(handlerRan()).toBe(true);
    expect((req as { meter402?: { payment: { id: string } } }).meter402?.payment.id).toBe('pay_01');
  });

  it('sends the challenge verbatim and does not run the handler', async () => {
    const { res, sent, next, handlerRan } = expressDouble();

    await expressProtect(meterReturning(UNPAID))(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(handlerRan()).toBe(false);
    expect(sent.status).toBe(402);
    expect(sent.headers['payment-required']).toBe('challenge-blob');
    expect(sent.body).toEqual({ error: 'PAYMENT_REQUIRED' });
  });

  it('fails closed when Meter402 is unreachable', async () => {
    const { res, sent, next, handlerRan } = expressDouble();

    await expressProtect(meterThatIsDown())(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(handlerRan()).toBe(false);
    expect(sent.status).toBe(503);
    expect(sent.headers['retry-after']).toBe('5');
  });

  it('fails open only when the merchant asked for it', async () => {
    const { res, next, handlerRan } = expressDouble();

    await expressProtect(meterThatIsDown(), { onUnavailable: 'open' })(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(handlerRan()).toBe(true);
  });

  it('does not fail open on a configuration error, even when asked to', async () => {
    /*
     * `onUnavailable: 'open'` is about outages. A wrong API key is not an
     * outage — serving every request for free because of it would hide the
     * one problem the merchant most needs to see.
     */
    const { res, sent, next, handlerRan } = expressDouble();
    const badCredential = meterReturning(
      { error: { code: 'INVALID_API_KEY', message: 'no' } },
      401,
    );

    await expressProtect(badCredential, { onUnavailable: 'open' })(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(handlerRan()).toBe(false);
    expect(sent.status).toBe(500);
  });

  it('passes a rejected payment through with its own status, not a 500', async () => {
    /*
     * The replay case, which is the one that actually happens: an agent
     * presents one payment twice. That is a 409 about the agent. Answering 500
     * would tell it the merchant is broken and invite a retry — the exact
     * wrong response to "you already spent this".
     */
    const { res, sent, next, handlerRan } = expressDouble();
    const alreadyUsed = meterReturning(
      { error: { code: 'PAYMENT_ALREADY_USED', message: 'This payment has already been used.' } },
      409,
    );

    await expressProtect(alreadyUsed)(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(handlerRan()).toBe(false);
    expect(sent.status).toBe(409);
    expect((sent.body as { error: { code: string } }).error.code).toBe('PAYMENT_ALREADY_USED');
  });

  it('still answers 500 for a merchant configuration problem, and says nothing specific', async () => {
    const { res, sent, next } = expressDouble();
    const badCredential = meterReturning(
      { error: { code: 'INVALID_API_KEY', message: 'key mk_live_abc is revoked' } },
      401,
    );

    await expressProtect(badCredential)(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(sent.status).toBe(500);
    // The caller learns nothing about the merchant's account.
    expect(JSON.stringify(sent.body)).not.toContain('mk_live_abc');
  });

  it('reports errors to onError without letting them escape', async () => {
    const { res, next } = expressDouble();
    const seen: unknown[] = [];

    await expressProtect(meterThatIsDown(), { onError: (error) => seen.push(error) })(
      { method: 'POST', path: '/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(seen).toHaveLength(1);
  });

  it('uses the mount-relative path, not the full original URL', async () => {
    let sentPath = '';
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        sentPath = JSON.parse(String(init.body)).path;
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const { res, next } = expressDouble();
    await expressProtect(meter)(
      // A router mounted at /api: the endpoint was registered as /research.
      { method: 'POST', path: '/research', originalUrl: '/api/research', headers: {} } as never,
      res as never,
      next,
    );

    expect(sentPath).toBe('/research');
  });
});

/* ── Fastify ────────────────────────────────────────────────────────────── */

function fastifyDouble() {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown } = {
    headers: {},
  };
  const reply = {
    code(status: number) {
      sent.status = status;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    async send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  return { reply, sent };
}

describe('fastify adapter', () => {
  it('lets the request through and attaches the payment', async () => {
    const { reply } = fastifyDouble();
    const request = { method: 'POST', url: '/research', headers: {} } as never;

    await fastifyProtect(meterReturning(AUTHORIZED))(request, reply as never);

    expect((request as { meter402?: { payment: { id: string } } }).meter402?.payment.id).toBe(
      'pay_01',
    );
  });

  it('sends the challenge with its headers', async () => {
    const { reply, sent } = fastifyDouble();

    await fastifyProtect(meterReturning(UNPAID))(
      { method: 'POST', url: '/research', headers: {} } as never,
      reply as never,
    );

    expect(sent.status).toBe(402);
    expect(sent.headers['payment-required']).toBe('challenge-blob');
  });

  it('fails closed when Meter402 is unreachable', async () => {
    const { reply, sent } = fastifyDouble();

    await fastifyProtect(meterThatIsDown())(
      { method: 'POST', url: '/research', headers: {} } as never,
      reply as never,
    );

    expect(sent.status).toBe(503);
  });

  it('sends the registered route pattern, not the concrete URL', async () => {
    let sentPath = '';
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        sentPath = JSON.parse(String(init.body)).path;
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const { reply } = fastifyDouble();
    await fastifyProtect(meter)(
      {
        method: 'POST',
        url: '/research/42',
        routeOptions: { url: '/research/:id' },
        headers: {},
      } as never,
      reply as never,
    );

    // Otherwise every distinct id would look like an unregistered endpoint.
    expect(sentPath).toBe('/research/:id');
  });
});

/* ── Next ───────────────────────────────────────────────────────────────── */

function fetchRequest(url: string, headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    url,
    headers: {
      forEach(callback: (value: string, key: string) => void) {
        for (const [key, value] of Object.entries(headers)) callback(value, key);
      },
    },
  };
}

describe('next adapter', () => {
  it('runs the handler with the payment as its second argument', async () => {
    let seenPaymentId: string | null = null;

    const route = withMeter402(meterReturning(AUTHORIZED), {}, async (_request, payment) => {
      seenPaymentId = payment?.payment.id ?? null;
      return { ok: true };
    });

    const result = await route(fetchRequest('https://merchant.example/research'));

    expect(seenPaymentId).toBe('pay_01');
    expect(result).toEqual({ ok: true });
  });

  it('returns a Response and never calls the handler when unpaid', async () => {
    let handlerRan = false;

    const route = withMeter402(meterReturning(UNPAID), {}, async () => {
      handlerRan = true;
      return { ok: true };
    });

    const response = (await route(fetchRequest('https://merchant.example/research'))) as Response;

    expect(handlerRan).toBe(false);
    expect(response.status).toBe(402);
    expect(response.headers.get('payment-required')).toBe('challenge-blob');
  });

  it('fails closed when Meter402 is unreachable', async () => {
    let handlerRan = false;

    const route = withMeter402(meterThatIsDown(), {}, async () => {
      handlerRan = true;
      return { ok: true };
    });

    const response = (await route(fetchRequest('https://merchant.example/research'))) as Response;

    expect(handlerRan).toBe(false);
    expect(response.status).toBe(503);
  });

  it('derives the path from an absolute URL', async () => {
    let sentPath = '';
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        sentPath = JSON.parse(String(init.body)).path;
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const route = withMeter402(meter, {}, async () => ({ ok: true }));
    await route(fetchRequest('https://merchant.example/research?q=climate'));

    expect(sentPath).toBe('/research');
  });

  it('lowercases forwarded header names so proof is found whatever the casing', async () => {
    let sentHeaders: Record<string, string> = {};
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        sentHeaders = JSON.parse(String(init.body)).headers;
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const route = withMeter402(meter, {}, async () => ({ ok: true }));
    await route(fetchRequest('https://merchant.example/research', { 'Meter402-Payment': 'proof' }));

    expect(sentHeaders).toEqual({ 'meter402-payment': 'proof' });
  });
});
