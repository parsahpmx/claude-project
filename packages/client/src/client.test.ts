import { describe, expect, it } from 'vitest';
import { Meter402Client, PaymentRefused } from './index.js';
import {
  evaluatePolicy,
  fromMinorUnits,
  normalizeNetwork,
  SpendingLedger,
  toMinorUnits,
  type PaymentTerms,
} from './policy.js';

/**
 * The paying agent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The policy tests are the ones that matter. Everything else here is plumbing;
 * the policy is the only thing standing between an agent and a wallet emptied
 * one 402 at a time.
 *
 * So they are written as attempts to get money out: an inflated price, a
 * mainnet challenge from a testnet agent, a lookalike host, a loop. A passing
 * test means the attempt was refused.
 * ─────────────────────────────────────────────────────────────────────────
 */

const USDC_ON_SEPOLIA = (amountMinorUnits: bigint, overrides: Partial<PaymentTerms> = {}) =>
  ({
    amountMinorUnits,
    decimals: 6,
    asset: 'USDC',
    network: 'eip155:84532',
    host: 'merchant.example',
    ...overrides,
  }) satisfies PaymentTerms;

describe('amount conversion', () => {
  it('converts decimals exactly, without floating point', () => {
    // 0.03 * 1e6 is 30000.000000000004 in IEEE 754.
    expect(toMinorUnits('0.03', 6)).toBe(30000n);
    expect(toMinorUnits('0.1', 6)).toBe(100000n);
    expect(toMinorUnits('1', 6)).toBe(1000000n);
    expect(toMinorUnits('0.000001', 6)).toBe(1n);
    expect(toMinorUnits('1234.567891', 6)).toBe(1234567891n);
  });

  it('treats equivalent spellings as equal', () => {
    expect(toMinorUnits('0.03', 6)).toBe(toMinorUnits('0.030000', 6));
  });

  it.each(['abc', '', '-1', '1e6', '0.03.1', '1,000', ' '])('rejects %o', (value) => {
    expect(toMinorUnits(value, 6)).toBeNull();
  });

  it('rejects more precision than the asset has, rather than rounding it', () => {
    // Rounding here would silently change what the agent agreed to pay.
    expect(toMinorUnits('0.0000001', 6)).toBeNull();
  });

  it('round-trips back to a readable decimal', () => {
    expect(fromMinorUnits(30000n, 6)).toBe('0.03');
    expect(fromMinorUnits(1000000n, 6)).toBe('1');
    expect(fromMinorUnits(1n, 6)).toBe('0.000001');
    expect(fromMinorUnits(0n, 6)).toBe('0');
  });
});

describe('spending policy', () => {
  const ledger = () => new SpendingLedger();

  it('allows a payment inside every limit', () => {
    const decision = evaluatePolicy({ maxPerRequest: '0.50' }, USDC_ON_SEPOLIA(30000n), ledger());
    expect(decision.allowed).toBe(true);
  });

  it('refuses a payment over the per-request cap', () => {
    const decision = evaluatePolicy({ maxPerRequest: '0.50' }, USDC_ON_SEPOLIA(600000n), ledger());
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.rule).toBe('maxPerRequest');
    // The message names both numbers, so an agent can log something useful.
    expect(decision.allowed === false && decision.reason).toContain('0.6');
    expect(decision.allowed === false && decision.reason).toContain('0.50');
  });

  it('allows exactly the cap, and refuses one unit more', () => {
    expect(
      evaluatePolicy({ maxPerRequest: '0.03' }, USDC_ON_SEPOLIA(30000n), ledger()).allowed,
    ).toBe(true);
    expect(
      evaluatePolicy({ maxPerRequest: '0.03' }, USDC_ON_SEPOLIA(30001n), ledger()).allowed,
    ).toBe(false);
  });

  it('defaults to a testnet, so an unconfigured agent cannot spend real money', () => {
    const mainnet = evaluatePolicy(
      { maxPerRequest: '100' },
      USDC_ON_SEPOLIA(30000n, { network: 'eip155:8453' }),
      ledger(),
    );

    expect(mainnet.allowed).toBe(false);
    expect(mainnet.allowed === false && mainnet.rule).toBe('allowedNetworks');
  });

  it('defaults to USDC only', () => {
    const decision = evaluatePolicy(
      { maxPerRequest: '100' },
      USDC_ON_SEPOLIA(30000n, { asset: 'WETH' }),
      ledger(),
    );
    expect(decision.allowed === false && decision.rule).toBe('allowedAssets');
  });

  it('accepts friendly network names as well as CAIP-2', () => {
    expect(normalizeNetwork('base-sepolia')).toBe('eip155:84532');
    expect(normalizeNetwork('Base')).toBe('eip155:8453');
    expect(normalizeNetwork('eip155:84532')).toBe('eip155:84532');

    const decision = evaluatePolicy(
      { maxPerRequest: '1', allowedNetworks: ['base-sepolia'] },
      USDC_ON_SEPOLIA(30000n),
      ledger(),
    );
    expect(decision.allowed).toBe(true);
  });

  describe('host allowlist', () => {
    const policy = { maxPerRequest: '1', allowedHosts: ['merchant.example', '.trusted.example'] };

    it('allows an exact host and a subdomain of a dotted entry', () => {
      for (const host of ['merchant.example', 'api.trusted.example', 'trusted.example']) {
        const decision = evaluatePolicy(policy, USDC_ON_SEPOLIA(1000n, { host }), ledger());
        expect(decision.allowed, host).toBe(true);
      }
    });

    it('refuses a host that merely ends with an allowed one', () => {
      /*
       * The lookalike case. `evilmerchant.example` ends with
       * `merchant.example`, and a suffix check would pay it. So would a naive
       * `.com` entry match every `.com` in existence.
       */
      for (const host of [
        'evilmerchant.example',
        'merchant.example.evil.com',
        'notmerchant.example',
      ]) {
        const decision = evaluatePolicy(policy, USDC_ON_SEPOLIA(1000n, { host }), ledger());
        expect(decision.allowed, host).toBe(false);
        expect(decision.allowed === false && decision.rule).toBe('allowedHosts');
      }
    });

    it('is case-insensitive about hosts', () => {
      const decision = evaluatePolicy(
        policy,
        USDC_ON_SEPOLIA(1000n, { host: 'MERCHANT.EXAMPLE' }),
        ledger(),
      );
      expect(decision.allowed).toBe(true);
    });

    it('allows everything when no allowlist is set', () => {
      const decision = evaluatePolicy(
        { maxPerRequest: '1' },
        USDC_ON_SEPOLIA(1000n, { host: 'anywhere.example' }),
        ledger(),
      );
      expect(decision.allowed).toBe(true);
    });
  });

  it('bounds total spending, which no per-request cap would catch', () => {
    const spent = new SpendingLedger();
    const policy = { maxPerRequest: '0.03', maxTotal: '0.10' };

    // Each of these is individually fine. Together they are the loop case.
    let allowed = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const decision = evaluatePolicy(policy, USDC_ON_SEPOLIA(30000n), spent);
      if (!decision.allowed) break;
      spent.record(30000n);
      allowed += 1;
    }

    expect(allowed).toBe(3);
    expect(spent.totalSpentMinorUnits).toBe(90000n);
  });

  it('refuses a malformed cap rather than treating it as unlimited', () => {
    const decision = evaluatePolicy({ maxPerRequest: 'lots' }, USDC_ON_SEPOLIA(30000n), ledger());
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.rule).toBe('malformed');
  });
});

/* ── The client ─────────────────────────────────────────────────────────── */

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const CHALLENGE_BODY = {
  error: 'PAYMENT_REQUIRED',
  payment: {
    paymentRequestId: 'preq_01',
    amount: '30000',
    asset: { symbol: 'USDC', decimals: 6 },
    chain: { id: 84532 },
    recipient: '0x2096',
  },
};

function scriptedFetch(responses: Array<() => Response>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return next!();
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('Meter402Client', () => {
  it('refuses to be constructed without a spending policy', () => {
    expect(() => new Meter402Client({ policy: {} as never, pay: async () => ({}) })).toThrow(
      /maxPerRequest is required/,
    );
  });

  it('refuses a malformed cap at construction, not at the first payment', () => {
    expect(
      () => new Meter402Client({ policy: { maxPerRequest: 'free' }, pay: async () => ({}) }),
    ).toThrow(/not a valid amount/);
  });

  it('passes a non-402 response straight through without paying', async () => {
    let paid = false;
    const { fetch: fetchImpl, calls } = scriptedFetch([() => jsonResponse(200, { ok: true })]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '1' },
      pay: async () => {
        paid = true;
        return {};
      },
      fetch: fetchImpl,
    });

    const response = await client.fetch('https://merchant.example/research');

    expect(response.status).toBe(200);
    expect(paid).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('pays a 402 and retries exactly once', async () => {
    const { fetch: fetchImpl, calls } = scriptedFetch([
      () => jsonResponse(402, CHALLENGE_BODY),
      () => jsonResponse(200, { result: 'served' }),
    ]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '0.50' },
      pay: async () => ({ 'meter402-payment': 'proof' }),
      fetch: fetchImpl,
    });

    const response = await client.fetch('https://merchant.example/research', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect((calls[1]!.init.headers as Record<string, string>)['meter402-payment']).toBe('proof');
    // The original request's own options survive the retry.
    expect(calls[1]!.init.method).toBe('POST');
  });

  it('does not retry more than once, even when the merchant keeps asking', async () => {
    /*
     * A merchant that answers 402 to a valid payment would drain a wallet one
     * request at a time if the client looped. The agent should see the second
     * 402 and decide for itself.
     */
    let payCalls = 0;
    const { fetch: fetchImpl, calls } = scriptedFetch([() => jsonResponse(402, CHALLENGE_BODY)]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '1' },
      pay: async () => {
        payCalls += 1;
        return { 'meter402-payment': 'proof' };
      },
      fetch: fetchImpl,
    });

    const response = await client.fetch('https://merchant.example/research');

    expect(response.status).toBe(402);
    expect(payCalls).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('refuses an over-cap challenge without calling the payer at all', async () => {
    let payCalled = false;
    const { fetch: fetchImpl } = scriptedFetch([() => jsonResponse(402, CHALLENGE_BODY)]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '0.01' },
      pay: async () => {
        payCalled = true;
        return {};
      },
      fetch: fetchImpl,
    });

    await expect(client.fetch('https://merchant.example/research')).rejects.toBeInstanceOf(
      PaymentRefused,
    );
    // The wallet was never asked to sign anything.
    expect(payCalled).toBe(false);
  });

  it('reports which rule refused, so an agent can react differently to each', async () => {
    const { fetch: fetchImpl } = scriptedFetch([() => jsonResponse(402, CHALLENGE_BODY)]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '1', allowedHosts: ['other.example'] },
      pay: async () => ({}),
      fetch: fetchImpl,
    });

    const error = await client
      .fetch('https://merchant.example/research')
      .then(() => null)
      .catch((caught: unknown) => caught as PaymentRefused);

    expect(error?.rule).toBe('allowedHosts');
    expect(error?.challenge.host).toBe('merchant.example');
  });

  it('treats a payer returning null as a refusal', async () => {
    const { fetch: fetchImpl, calls } = scriptedFetch([() => jsonResponse(402, CHALLENGE_BODY)]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '1' },
      pay: async () => null,
      fetch: fetchImpl,
    });

    await expect(client.fetch('https://merchant.example/research')).rejects.toThrow(/declined/);
    expect(calls).toHaveLength(1);
  });

  it('does not pay a 402 it cannot fully understand', async () => {
    /*
     * Every field in a challenge is an instruction about money. A body we
     * cannot parse is one whose amount, asset and network we do not know, so
     * there is nothing for the policy to check.
     */
    let payCalled = false;
    const { fetch: fetchImpl } = scriptedFetch([
      () => jsonResponse(402, { error: 'PAYMENT_REQUIRED', somethingElse: true }),
    ]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '100' },
      pay: async () => {
        payCalled = true;
        return {};
      },
      fetch: fetchImpl,
    });

    const response = await client.fetch('https://merchant.example/research');

    expect(response.status).toBe(402);
    expect(payCalled).toBe(false);
  });

  it('counts spending only when the retry actually succeeded', async () => {
    const { fetch: fetchImpl } = scriptedFetch([
      () => jsonResponse(402, CHALLENGE_BODY),
      () => jsonResponse(500, { error: 'merchant blew up' }),
    ]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '1', maxTotal: '1' },
      pay: async () => ({ 'meter402-payment': 'proof' }),
      fetch: fetchImpl,
    });

    await client.fetch('https://merchant.example/research');

    // Counting a failed call against the budget would slowly starve an agent
    // that is behaving correctly against a flaky merchant.
    expect(client.totalSpentMinorUnits).toBe(0n);
  });

  it('accumulates spending across calls and then stops', async () => {
    /*
     * Responds to the request rather than to a script position: unpaid calls
     * get a 402, calls carrying proof get served. A fixed script would let the
     * second `fetch` skip the challenge entirely and prove nothing.
     */
    const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      return headers['meter402-payment']
        ? jsonResponse(200, { ok: true })
        : jsonResponse(402, CHALLENGE_BODY);
    }) as unknown as typeof fetch;

    const client = new Meter402Client({
      policy: { maxPerRequest: '0.03', maxTotal: '0.06' },
      pay: async () => ({ 'meter402-payment': 'proof' }),
      fetch: fetchImpl,
    });

    // Two succeed, the third is over budget.
    await client.fetch('https://merchant.example/a');
    await client.fetch('https://merchant.example/b');
    expect(client.totalSpentMinorUnits).toBe(60000n);

    await expect(client.fetch('https://merchant.example/c')).rejects.toThrow(/total spending/);
  });

  it('reports every decision it made, paid or refused', async () => {
    const seen: string[] = [];
    const { fetch: fetchImpl } = scriptedFetch([
      () => jsonResponse(402, CHALLENGE_BODY),
      () => jsonResponse(200, { ok: true }),
    ]);

    const client = new Meter402Client({
      policy: { maxPerRequest: '0.50' },
      pay: async () => ({ 'meter402-payment': 'proof' }),
      fetch: fetchImpl,
      onDecision: ({ decision }) => seen.push(decision.allowed ? 'allowed' : decision.rule),
    });

    await client.fetch('https://merchant.example/research');
    expect(seen).toEqual(['allowed']);
  });

  it('reads an x402 challenge from its header', async () => {
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:84532',
            maxAmountRequired: '30000',
            payTo: '0x2096',
            resource: 'https://merchant.example/research?preq=preq_01',
            extra: { name: 'USDC', decimals: 6 },
          },
        ],
      }),
      'utf8',
    ).toString('base64');

    const { fetch: fetchImpl } = scriptedFetch([
      () => new Response('', { status: 402, headers: { 'payment-required': header } }),
      () => jsonResponse(200, { ok: true }),
    ]);

    let seenAmount = 0n;
    const client = new Meter402Client({
      policy: { maxPerRequest: '0.50' },
      pay: async (challenge) => {
        seenAmount = challenge.amountMinorUnits;
        return { 'payment-signature': 'signed' };
      },
      fetch: fetchImpl,
    });

    const response = await client.fetch('https://merchant.example/research');

    expect(response.status).toBe(200);
    expect(seenAmount).toBe(30000n);
  });
});
