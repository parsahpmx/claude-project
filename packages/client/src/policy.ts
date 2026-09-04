/**
 * The spending policy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This is the most important file in the client, and the reason the client
 * exists at all rather than being three lines of `fetch`.
 *
 * An agent that pays whatever it is asked has handed its wallet to whoever it
 * happens to call. The failure is not exotic: a compromised merchant, a
 * mistyped price, a redirect to a lookalike host, or a loop that retries a
 * paid call a thousand times. None of those require an attacker to be clever;
 * they require the agent to have no ceiling.
 *
 * So paying is opt-in and bounded, and the checks are ordered cheapest-first
 * and evaluated in full. Every refusal names the rule it broke, because an
 * agent that cannot tell "too expensive" from "wrong network" cannot do
 * anything sensible about either.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface SpendingPolicy {
  /**
   * The most this agent will pay for any single request, as a decimal string.
   *
   * Required, and deliberately has no default. A default here would be a
   * number somebody else chose for spending your money.
   */
  readonly maxPerRequest: string;
  /** Asset symbols this agent will pay in. Defaults to USDC only. */
  readonly allowedAssets?: readonly string[];
  /**
   * Networks this agent will settle on, as CAIP-2 or a friendly alias
   * (`base-sepolia`, `base`). Defaults to Base Sepolia only — a testnet, so
   * the default cannot spend real money.
   */
  readonly allowedNetworks?: readonly string[];
  /**
   * Hosts this agent may pay. When set, nothing else is paid.
   *
   * The strongest control here by a distance: an amount cap bounds each
   * mistake, but an allowlist bounds who can make you make one.
   */
  readonly allowedHosts?: readonly string[];
  /**
   * The most this agent will spend in total across the client's lifetime.
   *
   * Bounds the loop case: one call at 0.03 is fine, ten thousand is not, and
   * no per-request cap notices the difference.
   */
  readonly maxTotal?: string;
}

export interface PaymentTerms {
  readonly amountMinorUnits: bigint;
  readonly decimals: number;
  readonly asset: string;
  /** CAIP-2, as it arrived. */
  readonly network: string;
  readonly host: string;
}

export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: PolicyRule; readonly reason: string };

export type PolicyRule =
  'maxPerRequest' | 'allowedAssets' | 'allowedNetworks' | 'allowedHosts' | 'maxTotal' | 'malformed';

const DEFAULT_ASSETS = ['USDC'] as const;
const DEFAULT_NETWORKS = ['eip155:84532'] as const;

/** Friendly names for the networks an agent is likely to type. */
const NETWORK_ALIASES: Readonly<Record<string, string>> = {
  'base-sepolia': 'eip155:84532',
  'base sepolia': 'eip155:84532',
  base: 'eip155:8453',
  'base-mainnet': 'eip155:8453',
};

export function normalizeNetwork(network: string): string {
  const lower = network.trim().toLowerCase();
  return NETWORK_ALIASES[lower] ?? lower;
}

/**
 * Decimal string to minor units, on strings.
 *
 * Never through `Number`: `0.03 * 1e6` is `30000.000000000004`, and a spending
 * cap that is wrong in the seventh decimal place is a spending cap that can be
 * argued with.
 */
export function toMinorUnits(amount: string, decimals: number): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;

  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

/** Minor units back to a decimal string, for messages a person will read. */
export function fromMinorUnits(minorUnits: bigint, decimals: number): string {
  const digits = minorUnits.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Tracks what has been spent, so `maxTotal` means something.
 *
 * Per client instance and in memory: it bounds a runaway loop inside one
 * process, which is the case it is for. It is not a durable budget across
 * restarts, and this comment exists so nobody mistakes it for one.
 */
export class SpendingLedger {
  private spent = 0n;

  get totalSpentMinorUnits(): bigint {
    return this.spent;
  }

  record(amountMinorUnits: bigint): void {
    this.spent += amountMinorUnits;
  }
}

export function evaluatePolicy(
  policy: SpendingPolicy,
  terms: PaymentTerms,
  ledger: SpendingLedger,
): PolicyDecision {
  /* Asset first: it is a string compare, and it decides how to read the rest. */
  const assets = policy.allowedAssets ?? DEFAULT_ASSETS;
  if (!assets.some((asset) => asset.toUpperCase() === terms.asset.toUpperCase())) {
    return {
      allowed: false,
      rule: 'allowedAssets',
      reason: `Asked to pay in ${terms.asset}; this agent pays only in ${assets.join(', ')}.`,
    };
  }

  const networks = (policy.allowedNetworks ?? DEFAULT_NETWORKS).map(normalizeNetwork);
  const requested = normalizeNetwork(terms.network);
  if (!networks.includes(requested)) {
    return {
      allowed: false,
      rule: 'allowedNetworks',
      reason: `Asked to settle on ${terms.network}; this agent settles only on ${networks.join(', ')}.`,
    };
  }

  if (policy.allowedHosts && policy.allowedHosts.length > 0) {
    const host = terms.host.toLowerCase();
    const permitted = policy.allowedHosts.some((allowed) => {
      const candidate = allowed.trim().toLowerCase();
      /*
       * A leading dot means "this domain and its subdomains". Anything else is
       * an exact match — no wildcards, no suffix matching, because `evil.com`
       * ending with `.com` must never satisfy an allowlist entry of `com`.
       */
      if (candidate.startsWith('.')) {
        return host === candidate.slice(1) || host.endsWith(candidate);
      }
      return host === candidate;
    });

    if (!permitted) {
      return {
        allowed: false,
        rule: 'allowedHosts',
        reason: `${terms.host} is not on this agent's allowlist.`,
      };
    }
  }

  const cap = toMinorUnits(policy.maxPerRequest, terms.decimals);
  if (cap === null) {
    return {
      allowed: false,
      rule: 'malformed',
      reason: `maxPerRequest "${policy.maxPerRequest}" is not a valid amount.`,
    };
  }

  if (terms.amountMinorUnits > cap) {
    return {
      allowed: false,
      rule: 'maxPerRequest',
      reason:
        `Asked for ${fromMinorUnits(terms.amountMinorUnits, terms.decimals)} ${terms.asset}; ` +
        `this agent's per-request cap is ${policy.maxPerRequest}.`,
    };
  }

  if (policy.maxTotal !== undefined) {
    const total = toMinorUnits(policy.maxTotal, terms.decimals);
    if (total === null) {
      return {
        allowed: false,
        rule: 'malformed',
        reason: `maxTotal "${policy.maxTotal}" is not a valid amount.`,
      };
    }
    if (ledger.totalSpentMinorUnits + terms.amountMinorUnits > total) {
      return {
        allowed: false,
        rule: 'maxTotal',
        reason:
          `This payment would take total spending past ${policy.maxTotal} ${terms.asset} ` +
          `(already spent ${fromMinorUnits(ledger.totalSpentMinorUnits, terms.decimals)}).`,
      };
    }
  }

  return { allowed: true };
}
