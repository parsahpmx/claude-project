import type { MerchantEnvironment, Money, TokenAsset } from '@meter402/shared';

/**
 * Everything a strategy is allowed to price on.
 *
 * Deliberately narrow. A strategy receives request metadata, not the request
 * body: Meter402 sits in the authorization path, not the data plane (product
 * rules 141/142), and a pricing function that needed to read merchant payloads
 * would break that boundary.
 */
export interface PricingContext {
  readonly organizationId: string;
  readonly projectId: string;
  readonly endpointId: string;
  readonly environment: MerchantEnvironment;
  readonly method: string;
  readonly path: string;
  /** Present once the caller has been identified across requests. */
  readonly agentId: string | null;
  readonly requestedAt: Date;
  /** Merchant-supplied, opaque to the engine. Never merchant response content. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * A single line of the price explanation.
 *
 * Rule 102 requires that fee calculations are never hidden. Every quote can
 * explain itself, which is also what the dashboard renders and what support
 * needs when a merchant asks why a request cost what it did.
 */
export interface PriceComponent {
  readonly label: string;
  readonly amount: Money;
}

export interface PriceQuote {
  readonly amount: Money;
  readonly asset: TokenAsset;
  /** Which strategy produced this, recorded on the payment for auditability. */
  readonly strategy: string;
  readonly breakdown: readonly PriceComponent[];
}

/** Persisted pricing configuration for an endpoint. */
export interface PricingRule {
  readonly id: string;
  readonly kind: PricingStrategyKind;
  /** Decimal string, e.g. "0.03". Never a float — see @meter402/shared Money. */
  readonly amount: string;
  readonly assetSymbol: string;
  readonly chainId: number;
}

export const PRICING_STRATEGY_KINDS = ['FIXED'] as const;
export type PricingStrategyKind = (typeof PRICING_STRATEGY_KINDS)[number];

export interface PricingStrategy {
  readonly kind: PricingStrategyKind;
  /**
   * Async because future strategies (usage tiers, dynamic pricing) will need
   * to read counters. Returning a promise from the start keeps the call sites
   * from having to change when they do.
   */
  calculatePrice(rule: PricingRule, context: PricingContext): Promise<PriceQuote>;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}
