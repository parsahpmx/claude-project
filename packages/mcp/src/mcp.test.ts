import { describe, expect, it } from 'vitest';
import { createMeter402 } from '@meter402/sdk';
import { paidTool, PAYMENT_ARGUMENT } from './index.js';

/**
 * Paid MCP tools.
 *
 * The property under test throughout is that the handler runs when, and only
 * when, the call was paid for — and that the payment proof never reaches the
 * handler or its output.
 */

function meterReturning(body: unknown, status = 200) {
  return createMeter402({
    apiKey: 'k',
    fetch: (async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch,
  });
}

function meterThatIsDown() {
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
      amountMinorUnits: '50000',
      asset: 'USDC',
      simulated: true,
    },
    endpoint: {
      id: 'end_01',
      name: 'deep_research',
      path: '/mcp/tools/deep_research',
      method: 'POST',
    },
  },
};

const UNPAID = {
  data: {
    outcome: 'PAYMENT_REQUIRED',
    paymentRequestId: 'preq_02',
    respondWith: { status: 402, headers: {}, body: { payment: { amount: '50000' } } },
  },
};

describe('paidTool', () => {
  it('runs the handler and reports the payment when authorized', async () => {
    let seenArgs: unknown = null;
    const tool = paidTool(
      meterReturning(AUTHORIZED),
      { name: 'deep_research', price: '0.05' },
      async (args, payment) => {
        seenArgs = args;
        return {
          content: [{ type: 'text' as const, text: `researched with ${payment.payment.id}` }],
        };
      },
    );

    const result = await tool({ topic: 'agent payments' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('pay_01');
    expect(seenArgs).toEqual({ topic: 'agent payments' });
    expect(result._meta?.['meter402/receiptId']).toBe('rcpt_01');
  });

  it('does not run the handler when unpaid, and says how to pay', async () => {
    let handlerRan = false;
    const tool = paidTool(meterReturning(UNPAID), { name: 'deep_research' }, async () => {
      handlerRan = true;
      return { content: [{ type: 'text' as const, text: 'should not happen' }] };
    });

    const result = await tool({ topic: 'x' });

    expect(handlerRan).toBe(false);
    expect(result.isError).toBe(true);
    expect(result._meta?.['meter402/paymentRequired']).toBe(true);
    expect(result._meta?.['meter402/paymentRequestId']).toBe('preq_02');
    // The client is told where to put the proof, not left to guess.
    expect(result.content[0]?.text).toContain(PAYMENT_ARGUMENT);
  });

  it('forwards the proof from the reserved argument', async () => {
    let forwarded: string | undefined;
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        forwarded = JSON.parse(String(init.body)).headers['meter402-payment'];
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const tool = paidTool(meter, { name: 'deep_research' }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    await tool({ topic: 'x', [PAYMENT_ARGUMENT]: 'proof-blob' });
    expect(forwarded).toBe('proof-blob');
  });

  it('keeps the payment proof out of the handler arguments', async () => {
    /*
     * A tool that echoes its input would otherwise echo a payment proof into
     * whatever logs the merchant keeps, and the handler should see exactly the
     * schema it declared.
     */
    let seenArgs: Record<string, unknown> = {};
    const tool = paidTool(meterReturning(AUTHORIZED), { name: 'deep_research' }, async (args) => {
      seenArgs = args;
      return { content: [{ type: 'text' as const, text: JSON.stringify(args) }] };
    });

    const result = await tool({ topic: 'x', [PAYMENT_ARGUMENT]: 'proof-blob' });

    expect(PAYMENT_ARGUMENT in seenArgs).toBe(false);
    expect(result.content[0]?.text).not.toContain('proof-blob');
  });

  it('uses the tool name to derive its endpoint path', async () => {
    let path = '';
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        path = JSON.parse(String(init.body)).path;
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const tool = paidTool(meter, { name: 'deep_research' }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    await tool({});
    expect(path).toBe('/mcp/tools/deep_research');
  });

  it('honours an explicit path over the derived one', async () => {
    let path = '';
    const meter = createMeter402({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        path = JSON.parse(String(init.body)).path;
        return { ok: true, status: 200, json: async () => AUTHORIZED };
      }) as unknown as typeof fetch,
    });

    const tool = paidTool(meter, { name: 'deep_research', path: '/research' }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    await tool({});
    expect(path).toBe('/research');
  });

  it('fails closed when Meter402 is unreachable', async () => {
    let handlerRan = false;
    const tool = paidTool(meterThatIsDown(), { name: 'deep_research' }, async () => {
      handlerRan = true;
      return { content: [{ type: 'text' as const, text: 'free work' }] };
    });

    const result = await tool({});

    expect(handlerRan).toBe(false);
    expect(result.isError).toBe(true);
    expect(result._meta?.['meter402/error']).toBe('unavailable');
    // Transient, and the message says so, so a client can sensibly retry.
    expect(result.content[0]?.text).toContain('temporarily');
  });

  it('distinguishes a misconfiguration from an outage', async () => {
    const tool = paidTool(
      meterReturning({ error: { code: 'INVALID_API_KEY', message: 'no' } }, 401),
      { name: 'deep_research' },
      async () => ({ content: [{ type: 'text' as const, text: 'free work' }] }),
    );

    const result = await tool({});

    expect(result.isError).toBe(true);
    expect(result._meta?.['meter402/error']).toBe('misconfigured');
  });

  it('never puts the API key in a tool result', async () => {
    const secret = 'mk_live_never_show_this';
    const tool = paidTool(
      createMeter402({
        apiKey: secret,
        fetch: (async () => ({
          ok: false,
          status: 401,
          json: async () => ({ error: { code: 'INVALID_API_KEY', message: 'bad' } }),
        })) as unknown as typeof fetch,
      }),
      { name: 'deep_research' },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );

    const result = await tool({});
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('preserves the handler own _meta alongside the payment fields', async () => {
    const tool = paidTool(meterReturning(AUTHORIZED), { name: 'deep_research' }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      _meta: { 'app/traceId': 'trace_1' },
    }));

    const result = await tool({});

    expect(result._meta?.['app/traceId']).toBe('trace_1');
    expect(result._meta?.['meter402/paymentId']).toBe('pay_01');
  });
});
