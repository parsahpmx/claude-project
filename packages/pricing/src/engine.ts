import type { PriceQuote, PricingContext, PricingRule, PricingStrategy } from './types.js';
import { PricingError } from './types.js';
import { FixedPriceStrategy } from './fixed-price-strategy.js';

/**
 * Dispatches a pricing rule to the strategy that knows how to evaluate it.
 *
 * Registration is explicit rather than auto-discovered so that the set of
 * strategies that can price a request is legible in one place and cannot be
 * extended by an accidental import.
 */
export class PricingEngine {
  private readonly strategies = new Map<string, PricingStrategy>();

  constructor(strategies: readonly PricingStrategy[] = [new FixedPriceStrategy()]) {
    for (const strategy of strategies) {
      this.register(strategy);
    }
  }

  register(strategy: PricingStrategy): void {
    if (this.strategies.has(strategy.kind)) {
      throw new PricingError(`A strategy is already registered for kind ${strategy.kind}`);
    }
    this.strategies.set(strategy.kind, strategy);
  }

  async quote(rule: PricingRule, context: PricingContext): Promise<PriceQuote> {
    const strategy = this.strategies.get(rule.kind);
    if (!strategy) {
      throw new PricingError(
        `No pricing strategy registered for kind ${rule.kind}. ` +
          `Registered: ${[...this.strategies.keys()].join(', ') || 'none'}.`,
      );
    }
    return strategy.calculatePrice(rule, context);
  }
}
