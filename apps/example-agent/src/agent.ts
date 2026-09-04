import { Meter402Client, PaymentRefused, fromMinorUnits } from '@meter402/client';

/**
 * An agent that pays for what it uses.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The whole loop, with nothing else in the way: call, meet a 402, check the
 * price against a policy this agent set for itself, pay, be served.
 *
 * Note what the agent does *not* do: it does not trust the merchant's price,
 * it does not pay an asset or a network it did not agree to, and it stops
 * after a fixed total. Those are the difference between an agent with a wallet
 * and an agent that has given its wallet away.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MERCHANT = process.env['MERCHANT_URL'] ?? 'http://127.0.0.1:3000/research';
const METER402_URL = process.env['METER402_URL'] ?? 'http://127.0.0.1:4100';
const API_KEY = process.env['METER402_API_KEY'];

if (!API_KEY) {
  console.error('\nSet METER402_API_KEY (a TEST key). Run `meter402 init` to get one.\n');
  process.exit(1);
}

/**
 * How this agent pays.
 *
 * A TEST agent, so it asks Meter402's simulator to settle and presents the
 * reference it gets back. A real agent replaces exactly this function with a
 * wallet signing an EIP-3009 authorization — the policy above it, and the loop
 * below it, do not change.
 */
async function payWithSimulator(paymentRequestId: string): Promise<Record<string, string>> {
  const response = await fetch(
    `${METER402_URL}/v1/test/payment-requests/${paymentRequestId}/complete`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    },
  );

  if (!response.ok) {
    throw new Error(`The simulator refused to settle: ${response.status}`);
  }

  const body = (await response.json()) as { data: { reference: string } };
  const proof = Buffer.from(
    JSON.stringify({ paymentRequestId, reference: body.data.reference }),
    'utf8',
  ).toString('base64');

  return { 'meter402-payment': proof };
}

const client = new Meter402Client({
  policy: {
    /* Per call. A merchant asking more than this is refused, not negotiated with. */
    maxPerRequest: '0.10',
    /* For the whole run. Bounds the loop case no per-request cap can see. */
    maxTotal: '0.50',
    allowedAssets: ['USDC'],
    allowedNetworks: ['base-sepolia'],
  },

  pay: async (challenge) => payWithSimulator(challenge.paymentRequestId),

  onDecision: ({ challenge, decision }) => {
    const price = `${fromMinorUnits(challenge.amountMinorUnits, challenge.decimals)} ${challenge.asset}`;
    console.log(
      decision.allowed
        ? `  → asked for ${price} on ${challenge.network}; within policy, paying`
        : `  → refused (${decision.rule}): ${decision.reason}`,
    );
  },
});

async function main(): Promise<void> {
  console.log(`\nCalling ${MERCHANT}\n`);

  const response = await client.fetch(MERCHANT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'machine-native payments' }),
  });

  if (!response.ok) {
    console.error(`\nThe merchant returned ${response.status}.\n`);
    process.exitCode = 1;
    return;
  }

  const result = (await response.json()) as {
    summary: string;
    paidWith: { paymentId: string; receiptId: string } | null;
  };

  console.log(`\n${result.summary}\n`);
  if (result.paidWith) {
    console.log(`  payment  ${result.paidWith.paymentId}`);
    console.log(`  receipt  ${result.paidWith.receiptId}`);
  }
  console.log(`\n  spent this run: ${fromMinorUnits(client.totalSpentMinorUnits, 6)} USDC\n`);
}

main().catch((error: unknown) => {
  if (error instanceof PaymentRefused) {
    /*
     * Not a crash. The agent was asked for something outside what it agreed
     * to, and declined — which is the system working.
     */
    console.error(`\nDid not pay: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
