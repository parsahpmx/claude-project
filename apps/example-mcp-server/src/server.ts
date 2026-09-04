import { createMeter402 } from '@meter402/sdk';
import { paidTool, PAYMENT_ARGUMENT, type McpToolResult } from '@meter402/mcp';

/**
 * An MCP server with one paid tool.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Deliberately written against a tiny local tool registry rather than a real
 * MCP SDK. The point of this example is the *payment* wiring — `paidTool`
 * wrapping a handler — and that wiring is identical whichever MCP server
 * library you use. Pulling in an SDK here would add a dependency, a transport,
 * and a protocol version to keep current, and would obscure the four lines
 * that matter.
 *
 * With `@modelcontextprotocol/sdk` the registration reads:
 *
 *     server.tool(
 *       'deep_research',
 *       'Research a topic in depth.',
 *       { topic: z.string() },
 *       paidTool(meter, { name: 'deep_research', price: '0.05' }, handler),
 *     );
 *
 * — the same wrapper, handed to that server's `tool()` instead of ours.
 * ─────────────────────────────────────────────────────────────────────────
 */

const METER402_URL = process.env['METER402_URL'] ?? 'http://127.0.0.1:4100';
const API_KEY = process.env['METER402_API_KEY'];

if (!API_KEY) {
  console.error('\nSet METER402_API_KEY. Run `meter402 init` to get one.\n');
  process.exit(1);
}

const meter = createMeter402({ apiKey: API_KEY, baseUrl: METER402_URL });

/** The tool's actual work. Knows nothing about payments. */
async function research(topic: string): Promise<string> {
  return (
    `Deep research on ${topic}: in a real server this is the expensive call — ` +
    `the model, the index, the proprietary corpus.`
  );
}

const deepResearch = paidTool<{ topic?: string }>(
  meter,
  { name: 'deep_research', price: '0.05' },
  async (args, payment): Promise<McpToolResult> => ({
    content: [
      {
        type: 'text',
        text: await research(args.topic ?? 'machine-native payments'),
      },
    ],
    _meta: { 'app/paidWith': payment.payment.receiptId },
  }),
);

/**
 * A stand-in for an MCP client's `tools/call`.
 *
 * Shows the full round trip: the first call is refused with a challenge, the
 * caller pays, and the second call carries the proof.
 */
async function callTool(args: Record<string, unknown>): Promise<McpToolResult> {
  return deepResearch(args as { topic?: string });
}

async function paySimulated(paymentRequestId: string): Promise<string> {
  const response = await fetch(
    `${METER402_URL}/v1/test/payment-requests/${paymentRequestId}/complete`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!response.ok) throw new Error(`The simulator refused to settle: ${response.status}`);

  const body = (await response.json()) as { data: { reference: string } };
  return Buffer.from(
    JSON.stringify({ paymentRequestId, reference: body.data.reference }),
    'utf8',
  ).toString('base64');
}

async function main(): Promise<void> {
  console.log('\nCalling deep_research without paying\n');

  const unpaid = await callTool({ topic: 'agent payments' });
  console.log(`  ${unpaid.content[0]?.text}\n`);

  const paymentRequestId = unpaid._meta?.['meter402/paymentRequestId'];
  if (typeof paymentRequestId !== 'string') {
    console.error('  Expected a payment challenge and did not get one.');
    process.exitCode = 1;
    return;
  }

  console.log('Paying, then calling again\n');
  const proof = await paySimulated(paymentRequestId);

  const paid = await callTool({ topic: 'agent payments', [PAYMENT_ARGUMENT]: proof });
  if (paid.isError) {
    console.error(`  ${paid.content[0]?.text}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  ${paid.content[0]?.text}\n`);
  console.log(`  payment  ${String(paid._meta?.['meter402/paymentId'])}`);
  console.log(`  receipt  ${String(paid._meta?.['meter402/receiptId'])}\n`);
}

void main();
