import {
  evaluatePolicy,
  SpendingLedger,
  toMinorUnits,
  type PaymentTerms,
  type PolicyDecision,
  type SpendingPolicy,
} from './policy.js';

export * from './policy.js';

/**
 * @meter402/client — the paying side.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *     const client = new Meter402Client({
 *       policy: { maxPerRequest: '0.50' },
 *       pay: async (challenge) => { ... },
 *     });
 *
 *     const response = await client.fetch('https://merchant.example/research', {
 *       method: 'POST',
 *     });
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `fetch`, with one addition: when the server answers 402, the client reads
 * the challenge, checks it against a local spending policy, pays, and retries
 * once.
 *
 * Two decisions shape everything here.
 *
 * **The policy is not optional.** There is no "just pay it" mode, because an
 * agent with no ceiling is an agent that will eventually pay a mistyped price
 * ten thousand times.
 *
 * **Paying is injected, not built in.** This package holds no key and signs
 * nothing. Which is the honest architecture — the agent's wallet is the
 * agent's — and also what makes the policy testable without a chain.
 */

export class PaymentRefused extends Error {
  constructor(
    readonly rule: string,
    message: string,
    readonly challenge: PaymentChallenge,
  ) {
    super(message);
    this.name = 'PaymentRefused';
  }
}

/** A 402 that has been parsed, with the numbers in a form policy can compare. */
export interface PaymentChallenge {
  readonly paymentRequestId: string;
  readonly amountMinorUnits: bigint;
  readonly decimals: number;
  readonly asset: string;
  /** CAIP-2. */
  readonly network: string;
  readonly recipient: string | null;
  readonly host: string;
  readonly url: string;
  /** The whole 402 body, for a payer that needs something not modelled here. */
  readonly raw: unknown;
}

/**
 * Turn a challenge into headers that prove payment.
 *
 * The agent supplies this. It is where a wallet signs an EIP-3009
 * authorization, or where a test agent asks the simulator to settle. Returning
 * `null` declines to pay — treated exactly like a policy refusal.
 */
export type Payer = (
  challenge: PaymentChallenge,
) => Promise<Readonly<Record<string, string>> | null>;

export interface Meter402ClientOptions {
  readonly policy: SpendingPolicy;
  readonly pay: Payer;
  readonly fetch?: typeof fetch;
  /** Called for every decision, so an agent can log what it paid and refused. */
  readonly onDecision?: (event: {
    readonly challenge: PaymentChallenge;
    readonly decision: PolicyDecision;
  }) => void;
}

export class Meter402Client {
  private readonly ledger = new SpendingLedger();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Meter402ClientOptions) {
    if (!options.policy?.maxPerRequest) {
      throw new Error(
        'A spending policy with maxPerRequest is required. An agent that pays whatever it ' +
          'is asked has handed its wallet to whoever it happens to call.',
      );
    }
    if (toMinorUnits(options.policy.maxPerRequest, 18) === null) {
      throw new Error(`maxPerRequest "${options.policy.maxPerRequest}" is not a valid amount.`);
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** What this client has spent so far, in minor units. */
  get totalSpentMinorUnits(): bigint {
    return this.ledger.totalSpentMinorUnits;
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const first = await this.fetchImpl(url, init);
    if (first.status !== 402) return first;

    /*
     * Read the body from a clone. A caller who catches a refusal may still
     * want the original response, and a body can only be read once.
     */
    const challenge = await parseChallenge(first.clone(), url);
    if (!challenge) {
      // A 402 we cannot understand is not one we will pay.
      return first;
    }

    const terms: PaymentTerms = {
      amountMinorUnits: challenge.amountMinorUnits,
      decimals: challenge.decimals,
      asset: challenge.asset,
      network: challenge.network,
      host: challenge.host,
    };

    const decision = evaluatePolicy(this.options.policy, terms, this.ledger);
    this.options.onDecision?.({ challenge, decision });

    if (!decision.allowed) {
      throw new PaymentRefused(decision.rule, decision.reason, challenge);
    }

    const proof = await this.options.pay(challenge);
    if (!proof) {
      throw new PaymentRefused('declined', 'The payer declined to pay this challenge.', challenge);
    }

    /*
     * Retried exactly once. A loop here is how a broken merchant — one that
     * answers 402 to a valid payment — drains a wallet one request at a time;
     * the agent should see the second 402 and decide, rather than the client
     * deciding for it.
     */
    const retried = await this.fetchImpl(url, {
      ...init,
      headers: { ...headersToObject(init.headers), ...proof },
    });

    // Recorded on success only. An unsuccessful attempt has not spent anything
    // we can prove, and counting it against the budget would slowly starve a
    // correctly-behaving agent.
    if (retried.ok) this.ledger.record(challenge.amountMinorUnits);

    return retried;
  }
}

/**
 * Normalise whatever `fetch` accepts as headers into a plain object.
 *
 * Typed against the three concrete shapes rather than `HeadersInit`, which is
 * a DOM lib type this package deliberately does not pull in — it must build in
 * a plain Node project without `dom` in `lib`.
 */
function headersToObject(headers: RequestInit['headers'] | undefined): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  if (typeof (headers as Headers).forEach === 'function') {
    const result: Record<string, string> = {};
    (headers as Headers).forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  return { ...(headers as Record<string, string>) };
}

/**
 * Read a 402 into terms the policy can judge.
 *
 * Two shapes are understood: Meter402's protocol-neutral TEST body, and x402's
 * `PAYMENT-REQUIRED` header. Anything else returns null and is not paid —
 * refusing to pay a challenge we did not fully understand is the only safe
 * default, since every field here is an instruction about money.
 */
async function parseChallenge(response: Response, url: string): Promise<PaymentChallenge | null> {
  const host = hostOf(url);

  const x402Header = response.headers.get('payment-required');
  if (x402Header) {
    const parsed = decodeBase64Json(x402Header);
    const accepts = (parsed as { accepts?: unknown[] })?.accepts;
    const first = Array.isArray(accepts) ? (accepts[0] as Record<string, unknown>) : null;
    if (!first) return null;

    const amount = String(first['maxAmountRequired'] ?? '');
    if (!/^\d+$/.test(amount)) return null;

    const extra = (first['extra'] ?? {}) as Record<string, unknown>;
    return {
      paymentRequestId: String(first['resource'] ?? ''),
      amountMinorUnits: BigInt(amount),
      decimals: Number(extra['decimals'] ?? 6),
      asset: String(extra['name'] ?? extra['symbol'] ?? 'USDC'),
      network: String(first['network'] ?? ''),
      recipient: typeof first['payTo'] === 'string' ? first['payTo'] : null,
      host,
      url,
      raw: parsed,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  const payment = (body as { payment?: Record<string, unknown> })?.payment;
  if (!payment) return null;

  const amount = String(payment['amount'] ?? '');
  if (!/^\d+$/.test(amount)) return null;

  const asset = payment['asset'] as { symbol?: string; decimals?: number } | string | undefined;
  const chain = payment['chain'] as { id?: number; caip2?: string } | undefined;

  return {
    paymentRequestId: String(payment['paymentRequestId'] ?? ''),
    amountMinorUnits: BigInt(amount),
    decimals: typeof asset === 'object' ? Number(asset?.decimals ?? 6) : 6,
    asset: typeof asset === 'object' ? String(asset?.symbol ?? 'USDC') : String(asset ?? 'USDC'),
    network: chain?.caip2 ?? (chain?.id ? `eip155:${chain.id}` : ''),
    recipient: typeof payment['recipient'] === 'string' ? payment['recipient'] : null,
    host,
    url,
    raw: body,
  };
}

function decodeBase64Json(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}
