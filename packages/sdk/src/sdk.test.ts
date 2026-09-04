import { describe, expect, it } from 'vitest';
import {
  createMeter402,
  Meter402Client,
  isMeter402SdkError,
  type Meter402SdkError,
} from './index.js';

/**
 * The SDK, tested against a stub Meter402.
 *
 * These are about the contract a merchant integrates against: what gets sent,
 * what comes back, and — the part that decides whether an outage costs money —
 * what happens when Meter402 does not answer.
 */

/**
 * Await a call expected to fail, and hand back the SDK error it produced.
 *
 * Written as a helper because `promise.catch(e => e)` types as
 * `Result | Error`, and every assertion after it would otherwise need a cast
 * that would also happily hide a call that unexpectedly succeeded.
 */
async function failureOf(promise: Promise<unknown>): Promise<Meter402SdkError> {
  try {
    await promise;
  } catch (error) {
    if (isMeter402SdkError(error)) return error;
    throw error;
  }
  throw new Error('Expected the call to fail, but it succeeded.');
}

function stubFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const { status, body } = handler(String(input), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
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

const PAYMENT_REQUIRED = {
  data: {
    outcome: 'PAYMENT_REQUIRED',
    paymentRequestId: 'preq_02',
    respondWith: {
      status: 402,
      headers: { 'x-challenge': 'yes' },
      body: { error: 'PAYMENT_REQUIRED' },
    },
  },
};

describe('createMeter402', () => {
  it('refuses to be constructed without an API key', () => {
    expect(() => createMeter402({ apiKey: '' })).toThrow(/API key/i);
    expect(() => createMeter402({ apiKey: '   ' })).toThrow(/API key/i);
  });

  it('sends the credential as a bearer token and the route as given', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const meter = createMeter402({
      apiKey: 'mk_test_secret',
      baseUrl: 'https://meter.example',
      fetch: stubFetch((url, init) => {
        seen = { url, init };
        return { status: 200, body: AUTHORIZED };
      }),
    });

    await meter.authorize({ method: 'post', path: '/research', headers: {} });

    expect(seen!.url).toBe('https://meter.example/v1/authorize');
    expect((seen!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer mk_test_secret',
    );
    // Uppercased on the way out, so a merchant's `req.method` casing is not
    // something they have to think about.
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({
      method: 'POST',
      path: '/research',
    });
  });

  it('forwards only payment headers, never the merchant own credentials', async () => {
    let sentHeaders: Record<string, string> = {};
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch((_url, init) => {
        sentHeaders = JSON.parse(String(init.body)).headers;
        return { status: 200, body: AUTHORIZED };
      }),
    });

    await meter.authorize({
      method: 'POST',
      path: '/research',
      headers: {
        'meter402-payment': 'proof',
        // Everything below belongs to the merchant and its customer. None of
        // it is our business, and sending it would put it in our logs.
        authorization: 'Bearer merchant-customer-token',
        cookie: 'session=abc123',
        'x-internal-user-id': 'user_42',
      },
    });

    expect(sentHeaders).toEqual({ 'meter402-payment': 'proof' });
  });

  it('returns a ready-to-send response for an unpaid caller, without throwing', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({ status: 200, body: PAYMENT_REQUIRED })),
    });

    const result = await meter.authorize({ method: 'POST', path: '/research', headers: {} });

    // Unpaid is a normal outcome, not an error.
    expect(result.outcome).toBe('PAYMENT_REQUIRED');
    if (result.outcome !== 'PAYMENT_REQUIRED') throw new Error('unreachable');
    expect(result.respondWith.status).toBe(402);
  });

  it('never puts the API key in an error', async () => {
    const secret = 'mk_live_do_not_leak_me';
    const meter = createMeter402({
      apiKey: secret,
      fetch: stubFetch(() => ({
        status: 401,
        body: { error: { code: 'INVALID_API_KEY', message: 'bad key', requestId: 'req_1' } },
      })),
    });

    await expect(
      meter.authorize({ method: 'POST', path: '/research', headers: {} }),
    ).rejects.toSatisfy((error: unknown) => {
      const serialised = JSON.stringify(error, Object.getOwnPropertyNames(error));
      return !serialised.includes(secret) && !String(error).includes(secret);
    });
  });
});

describe('error classification', () => {
  it.each([
    [500, 'unavailable', true],
    [502, 'unavailable', true],
    [429, 'unavailable', true],
    [401, 'authentication', false],
    [403, 'authentication', false],
    [422, 'rejected', false],
  ])('maps HTTP %i to %s', async (status, kind, retryable) => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({ status, body: { error: { code: 'X', message: 'm' } } })),
    });

    const error = await failureOf(meter.authorize({ method: 'POST', path: '/x', headers: {} }));

    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });

  it('turns an unregistered endpoint into an actionable configuration error', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 404,
        body: { error: { code: 'ENDPOINT_NOT_FOUND', message: 'No endpoint.' } },
      })),
    });

    const error = await failureOf(
      meter.authorize({ method: 'POST', path: '/research', headers: {} }),
    );

    expect(error.kind).toBe('configuration');
    // It tells the developer what to do, not just what went wrong.
    expect(error.message).toMatch(/meter402 endpoints create/);
  });

  it('treats a network failure as unavailable rather than as a rejection', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });

    const error = await failureOf(meter.authorize({ method: 'POST', path: '/x', headers: {} }));

    expect(error.kind).toBe('unavailable');
    expect(error.retryable).toBe(true);
  });

  it('times out rather than hanging a merchant request forever', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      timeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch,
    });

    const error = await failureOf(meter.authorize({ method: 'POST', path: '/x', headers: {} }));

    expect(error.kind).toBe('unavailable');
    expect(error.message).toMatch(/did not respond within 20ms/);
  });

  it('does not silently accept a response shape it does not understand', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({ status: 200, body: { data: { outcome: 'SOMETHING_NEW' } } })),
    });

    await expect(meter.authorize({ method: 'POST', path: '/x', headers: {} })).rejects.toThrow(
      /upgrading @meter402\/sdk/,
    );
  });
});

describe('verifyRoute', () => {
  const endpoints = (price: { amount: string; decimals: number } | null) => ({
    data: [
      {
        id: 'end_01',
        path: '/research',
        method: 'POST',
        status: 'ACTIVE',
        price: price ? { ...price, asset: 'USDC' } : null,
      },
    ],
  });

  it('accepts a route whose declared price matches the registered one', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 200,
        body: endpoints({ amount: '0.03', decimals: 6 }),
      })),
    });

    await expect(
      meter.verifyRoute({ path: '/research', method: 'POST', price: '0.03' }),
    ).resolves.toBeUndefined();
  });

  it('refuses to start when the code and the server disagree about the price', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 200,
        body: endpoints({ amount: '0.50', decimals: 6 }),
      })),
    });

    /*
     * The important half of this is that it does not auto-correct in either
     * direction: silently using the server's price charges agents something
     * the code does not say, and silently pushing the code's price changes
     * what agents pay as a side effect of a deploy.
     */
    await expect(
      meter.verifyRoute({ path: '/research', method: 'POST', price: '0.03' }),
    ).rejects.toThrow(/Price mismatch/);
  });

  it('names the missing endpoint and the command that creates it', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({ status: 200, body: { data: [] } })),
    });

    await expect(meter.verifyRoute({ path: '/research', method: 'POST' })).rejects.toThrow(
      /meter402 endpoints create --path \/research --method POST/,
    );
  });

  it('refuses a disabled endpoint at startup rather than at 3am', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 200,
        body: {
          data: [{ id: 'e', path: '/research', method: 'POST', status: 'DISABLED', price: null }],
        },
      })),
    });

    await expect(meter.verifyRoute({ path: '/research', method: 'POST' })).rejects.toThrow(
      /DISABLED/,
    );
  });

  it('compares prices exactly, without floating point', async () => {
    // 0.03 * 1e6 is 30000.000000000004 in IEEE 754. A price comparison that
    // went through a float would reject a correct configuration.
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 200,
        body: endpoints({ amount: '0.03', decimals: 6 }),
      })),
    });

    for (const price of ['0.03', '0.030', '0.030000']) {
      await expect(
        meter.verifyRoute({ path: '/research', method: 'POST', price }),
      ).resolves.toBeUndefined();
    }
  });

  it('rejects a price with more precision than the asset has', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 200,
        body: endpoints({ amount: '0.03', decimals: 6 }),
      })),
    });

    await expect(
      meter.verifyRoute({ path: '/research', method: 'POST', price: '0.0000001' }),
    ).rejects.toThrow(/precision/);
  });

  it.each(['abc', '', '0.03.1', '-0.03', '1e-6'])(
    'rejects the malformed price %o',
    async (price) => {
      const meter = createMeter402({
        apiKey: 'k',
        fetch: stubFetch(() => ({
          status: 200,
          body: endpoints({ amount: '0.03', decimals: 6 }),
        })),
      });

      await expect(
        meter.verifyRoute({ path: '/research', method: 'POST', price }),
      ).rejects.toThrow();
    },
  );

  it('matches a route regardless of trailing slash or method casing', async () => {
    const meter = createMeter402({
      apiKey: 'k',
      fetch: stubFetch(() => ({
        status: 200,
        body: endpoints({ amount: '0.03', decimals: 6 }),
      })),
    });

    await expect(
      meter.verifyRoute({ path: '/research/', method: 'post', price: '0.03' }),
    ).resolves.toBeUndefined();
  });
});

describe('Meter402Client construction', () => {
  it('trims a trailing slash from the base URL so paths do not double up', async () => {
    let seenUrl = '';
    const client = new Meter402Client({
      apiKey: 'k',
      baseUrl: 'https://meter.example///',
      fetch: stubFetch((url) => {
        seenUrl = url;
        return { status: 200, body: AUTHORIZED };
      }),
    });

    await client.authorize({ method: 'POST', path: '/x', headers: {} });
    expect(seenUrl).toBe('https://meter.example/v1/authorize');
  });

  it('reports a missing fetch as configuration, not as a crash', () => {
    const original = globalThis.fetch;
    // @ts-expect-error deliberately removing it
    delete globalThis.fetch;
    try {
      expect(() => new Meter402Client({ apiKey: 'k' })).toThrow(/fetch/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});
