import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

/**
 * What a fresh production boot must refuse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Configuration is the one part of this system where a mistake is silent by
 * default: a missing variable becomes `undefined`, `undefined` becomes a
 * falsy default, and the server starts looking healthy while doing the wrong
 * thing with money.
 *
 * So the bar here is fail-closed. Every case below is one a real deployment
 * hits — a variable that failed to interpolate, a secret copied from the
 * example file, a developer switch left on — and the assertion is that the
 * process refuses to start rather than starting in a degraded state nobody
 * notices.
 * ─────────────────────────────────────────────────────────────────────────
 */

const PRODUCTION_BASE: Record<string, string> = {
  NODE_ENV: 'production',
  DEPLOY_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pw@db.internal:5432/meter402',
  REDIS_URL: 'redis://cache.internal:6379',
  AUTH_SECRET: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
  API_KEY_HASH_PEPPER: 'f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1',
  WEBHOOK_SIGNING_SECRET: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a6978',
  TEST_SIMULATOR_SECRET: '9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d5e4f3021',
  BASE_CHAIN_ID: '8453',
  BASE_RPC_URL: 'https://mainnet.base.org',
  USDC_CONTRACT_ADDRESS: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  DASHBOARD_ORIGIN: 'https://dashboard.meter402.com',
};

function production(overrides: Record<string, string | undefined> = {}) {
  const env = { ...PRODUCTION_BASE, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
  }
  return () => loadConfig(env as NodeJS.ProcessEnv);
}

describe('production configuration refuses to start when', () => {
  it('accepts the fully-specified baseline (so the negatives below mean something)', () => {
    expect(production()).not.toThrow();
  });

  it.each([
    'DATABASE_URL',
    'AUTH_SECRET',
    'API_KEY_HASH_PEPPER',
    'WEBHOOK_SIGNING_SECRET',
    'TEST_SIMULATOR_SECRET',
    'BASE_RPC_URL',
    'USDC_CONTRACT_ADDRESS',
  ])('%s is missing', (key) => {
    expect(production({ [key]: undefined })).toThrow();
  });

  it.each([
    'DATABASE_URL',
    'AUTH_SECRET',
    'API_KEY_HASH_PEPPER',
    'WEBHOOK_SIGNING_SECRET',
    'TEST_SIMULATOR_SECRET',
  ])('%s is present but empty', (key) => {
    // An empty value usually means a variable that failed to interpolate.
    expect(production({ [key]: '' })).toThrow();
  });

  it('a secret is too short to be a real secret', () => {
    expect(production({ AUTH_SECRET: 'short' })).toThrow();
  });

  it('two secrets are the same value', () => {
    /*
     * Copy-paste across secrets is common and quiet. Sharing one value
     * between the API-key pepper and the session secret means a leak of
     * either becomes a leak of both.
     */
    const shared = 'c'.repeat(48);
    expect(production({ AUTH_SECRET: shared, API_KEY_HASH_PEPPER: shared })).toThrow();
  });

  it('a secret still carries an example-file placeholder', () => {
    for (const placeholder of [
      'changeme-changeme-changeme-changeme-changeme',
      'replace-me-replace-me-replace-me-replace-me-x',
      'your-secret-here-your-secret-here-your-secret',
      'example-example-example-example-example-examp',
    ]) {
      expect(production({ AUTH_SECRET: placeholder }), placeholder).toThrow();
    }
  });

  it('the RPC URL is not a URL at all', () => {
    expect(production({ BASE_RPC_URL: 'not-a-url' })).toThrow();
  });

  it('the USDC address is malformed', () => {
    for (const bad of ['0xnothex', '0x1234', 'not-an-address', '']) {
      expect(production({ USDC_CONTRACT_ADDRESS: bad }), bad).toThrow();
    }
  });

  it('the chain is one this server does not support', () => {
    expect(production({ BASE_CHAIN_ID: '1' })).toThrow();
    expect(production({ BASE_CHAIN_ID: '999999' })).toThrow();
  });

  it('production is pointed at a testnet', () => {
    // A production deployment settling on Sepolia takes real customers'
    // requests and pays for them with play money.
    expect(
      production({
        BASE_CHAIN_ID: '84532',
        USDC_CONTRACT_ADDRESS: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      }),
    ).toThrow(/testnet/i);
  });

  it('settlement is enabled with no facilitator to settle through', () => {
    expect(production({ LIVE_SETTLEMENT_ENABLED: 'true' })).toThrow(/facilitator/i);
  });

  it('mainnet is requested without settlement', () => {
    expect(production({ ENABLE_BASE_MAINNET: 'true' })).toThrow();
  });
});

describe('production configuration defaults', () => {
  it('leaves settlement off unless it is explicitly switched on', () => {
    const config = production()();
    expect(config.settlement.liveSettlementEnabled).toBe(false);
    expect(config.settlement.baseMainnetEnabled).toBe(false);
    expect(config.settlement.enabledChainIds).toEqual([]);
  });

  it('marks itself as production, so environment-gated routes stay closed', () => {
    expect(production()().isProduction).toBe(true);
  });
});
