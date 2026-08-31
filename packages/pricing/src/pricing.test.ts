import { describe, expect, it } from 'vitest';
import { EnvironmentChainMismatchError, MerchantEnvironment } from '@meter402/shared';
import { FixedPriceStrategy } from './fixed-price-strategy.js';
import { PricingEngine } from './engine.js';
import { PricingError, type PricingContext, type PricingRule } from './types.js';

const BASE_SEPOLIA = 84532;
const BASE_MAINNET = 8453;

function context(overrides: Partial<PricingContext> = {}): PricingContext {
  return {
    organizationId: 'org_test',
    projectId: 'prj_test',
    endpointId: 'ep_test',
    environment: MerchantEnvironment.Test,
    method: 'POST',
    path: '/research',
    agentId: null,
    requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    metadata: {},
    ...overrides,
  };
}

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: 'price_test',
    kind: 'FIXED',
    amount: '0.03',
    assetSymbol: 'USDC',
    chainId: BASE_SEPOLIA,
    ...overrides,
  };
}

describe('FixedPriceStrategy', () => {
  const strategy = new FixedPriceStrategy();

  it('quotes the configured flat price exactly', async () => {
    const quote = await strategy.calculatePrice(rule(), context());
    expect(quote.amount.minorUnits).toBe(30_000n);
    expect(quote.amount.toDecimalString()).toBe('0.030000');
    expect(quote.asset.symbol).toBe('USDC');
    expect(quote.strategy).toBe('FIXED');
  });

  it('explains itself, so a merchant can see why a request cost what it did', () => {
    // Rule 102: fee calculations are never hidden.
    return strategy.calculatePrice(rule(), context()).then((quote) => {
      expect(quote.breakdown).toHaveLength(1);
      expect(quote.breakdown[0]?.label).toBe('Request price');
      expect(quote.breakdown[0]?.amount.equals(quote.amount)).toBe(true);
    });
  });

  it('refuses to quote a mainnet price for a TEST project', async () => {
    await expect(
      strategy.calculatePrice(rule({ chainId: BASE_MAINNET }), context()),
    ).rejects.toThrow(EnvironmentChainMismatchError);
  });

  it('refuses to quote a testnet price for a LIVE project', async () => {
    await expect(
      strategy.calculatePrice(
        rule({ chainId: BASE_SEPOLIA }),
        context({ environment: MerchantEnvironment.Live }),
      ),
    ).rejects.toThrow(EnvironmentChainMismatchError);
  });

  it('rejects an unsupported asset rather than guessing its decimals', async () => {
    await expect(strategy.calculatePrice(rule({ assetSymbol: 'DOGE' }), context())).rejects.toThrow(
      PricingError,
    );
  });

  it('rejects a price with more precision than the asset supports', async () => {
    await expect(strategy.calculatePrice(rule({ amount: '0.0000001' }), context())).rejects.toThrow(
      /supports only 6/,
    );
  });

  it('rejects a zero price rather than issuing a challenge for nothing', async () => {
    await expect(strategy.calculatePrice(rule({ amount: '0' }), context())).rejects.toThrow(
      /Free endpoints/,
    );
  });

  it('rejects a negative price', async () => {
    await expect(strategy.calculatePrice(rule({ amount: '-0.03' }), context())).rejects.toThrow(
      PricingError,
    );
  });
});

describe('PricingEngine', () => {
  it('dispatches a FIXED rule to the fixed strategy by default', async () => {
    const quote = await new PricingEngine().quote(rule(), context());
    expect(quote.amount.minorUnits).toBe(30_000n);
  });

  it('fails loudly when no strategy handles the rule kind', async () => {
    const engine = new PricingEngine([]);
    await expect(engine.quote(rule(), context())).rejects.toThrow(/No pricing strategy/);
  });

  it('refuses to register two strategies for the same kind', () => {
    const engine = new PricingEngine();
    expect(() => engine.register(new FixedPriceStrategy())).toThrow(PricingError);
  });
});
