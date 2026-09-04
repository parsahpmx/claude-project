import Fastify from 'fastify';
import { createMeter402 } from '@meter402/sdk';
import { protect } from '@meter402/sdk/fastify';

/**
 * A paid API, complete.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This file is the product demo, so it is written to be read in a minute. The
 * only Meter402-specific lines are the two imports, the client, and the
 * `preHandler`. Everything else is an ordinary Fastify server, and the
 * research handler has no idea it is being paid for.
 *
 * That is the claim being demonstrated: monetising an existing route is a
 * three-line change, and the handler does not become payment-aware.
 * ─────────────────────────────────────────────────────────────────────────
 */

const PORT = Number(process.env['PORT'] ?? 3000);
const METER402_URL = process.env['METER402_URL'] ?? 'http://127.0.0.1:4100';
const API_KEY = process.env['METER402_API_KEY'];

if (!API_KEY) {
  console.error('\nSet METER402_API_KEY. Run `meter402 init` to get one.\n');
  process.exit(1);
}

const meter = createMeter402({ apiKey: API_KEY, baseUrl: METER402_URL });

const app = Fastify({ logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });

/** The merchant's actual work. Knows nothing about payments. */
async function research(topic: string): Promise<{ topic: string; summary: string }> {
  return {
    topic,
    summary:
      `A short synthesis of recent work on ${topic}. In a real service this is ` +
      `the expensive part — the model call, the index query, the proprietary data.`,
  };
}

app.post(
  '/research',
  { preHandler: protect(meter, { price: '0.03' }) },
  async (request: {
    body?: unknown;
    meter402?: { payment: { id: string; receiptId: string } };
  }) => {
    const body = (request.body ?? {}) as { topic?: string };
    const result = await research(body.topic ?? 'machine-native payments');

    /*
     * `request.meter402` carries the payment that bought this call. Optional
     * to use — most handlers ignore it — but it is what a merchant records
     * against their own usage, or returns so an agent can reconcile.
     */
    return {
      ...result,
      paidWith: request.meter402
        ? { paymentId: request.meter402.payment.id, receiptId: request.meter402.payment.receiptId }
        : null,
    };
  },
);

/** Unpriced, to show that protection is per route rather than per server. */
app.get('/health', async () => ({ status: 'ok' }));

async function main(): Promise<void> {
  /*
   * Fail at boot rather than at the first agent request. Without this, a
   * missing or mispriced endpoint shows up as a 500 to whoever happens to
   * call first — which, for a machine-native API, is a paying customer.
   */
  try {
    await meter.verifyRoute({ method: 'POST', path: '/research', price: '0.03' });
    app.log.info('Meter402: POST /research is registered at 0.03 USDC');
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  await app.listen({ port: PORT, host: '127.0.0.1' });
  app.log.info(`Try: curl -X POST http://127.0.0.1:${PORT}/research`);
}

void main();
