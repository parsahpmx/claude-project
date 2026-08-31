import { Money, findAsset, assertChainAllowedForEnvironment } from '@meter402/shared';
import type { PriceQuote, PricingContext, PricingRule, PricingStrategy } from './types.js';
import { PricingError } from './types.js';

/**
 * Flat price per request — the MVP strategy and the one the "$0.03 per call"
 * onboarding flow uses.
 *
 * The environment/chain guard runs here rather than only at the payment layer
 * because this is the earliest point where merchant configuration becomes a
 * concrete instruction to pay a specific chain. Catching a TEST project
 * configured against mainnet at quote time means it can never reach a
 * challenge.
 */
export class FixedPriceStrategy implements PricingStrategy {
  readonly kind = 'FIXED' as const;

  async calculatePrice(rule: PricingRule, context: PricingContext): Promise<PriceQuote> {
    if (rule.kind !== 'FIXED') {
      throw new PricingError(`FixedPriceStrategy received a ${rule.kind} rule`);
    }

    // Throws EnvironmentChainMismatchError if a TEST project is pointed at a
    // mainnet chain, or vice versa (product rule 14).
    assertChainAllowedForEnvironment(rule.chainId, context.environment);

    const asset = findAsset(rule.assetSymbol, rule.chainId);
    if (!asset) {
      throw new PricingError(
        `Asset ${rule.assetSymbol} is not supported on chain ${rule.chainId}. ` +
          `Supported assets are registered in @meter402/shared.`,
      );
    }

    const amount = Money.fromDecimalString(rule.amount, asset.symbol, asset.decimals);

    if (amount.isNegative()) {
      throw new PricingError(`Endpoint price cannot be negative: ${rule.amount}`);
    }
    if (amount.isZero()) {
      // A zero price is a free endpoint, which must not go through the payment
      // path at all. Surfacing it here prevents issuing a challenge for zero.
      throw new PricingError(
        'Endpoint price is zero. Free endpoints must not be wrapped in a payment challenge.',
      );
    }

    return {
      amount,
      asset,
      strategy: this.kind,
      breakdown: [{ label: 'Request price', amount }],
    };
  }
}
