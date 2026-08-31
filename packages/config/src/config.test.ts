import { describe, expect, it } from 'vitest';
import { DeployEnvironment } from '@meter402/shared';
import { ConfigurationError, loadConfig, redactConfig } from './index.js';

const STRONG_A = 'a'.repeat(64);
const STRONG_B = 'b'.repeat(64);
const STRONG_C = 'c'.repeat(64);

const USDC_SEPOLIA = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const USDC_MAINNET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DEPLOY_ENV: 'staging',
    DATABASE_URL: 'postgresql://localhost:5432/meter402',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_SECRET: STRONG_A,
    API_KEY_HASH_PEPPER: STRONG_B,
    WEBHOOK_SIGNING_SECRET: STRONG_C,
    BASE_CHAIN_ID: '84532',
    BASE_RPC_URL: 'https://sepolia.base.org',
    USDC_CONTRACT_ADDRESS: USDC_SEPOLIA,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig — happy path', () => {
  it('loads a valid staging configuration', () => {
    const config = loadConfig(env());
    expect(config.deployEnv).toBe(DeployEnvironment.Staging);
    expect(config.chain).toMatchObject({
      chainId: 84532,
      slug: 'base-sepolia',
      isTestnet: true,
      confirmationsRequired: 3,
      challengeTtlSeconds: 300,
    });
    expect(config.isProduction).toBe(false);
  });

  it('normalises EIP-55 checksummed address casing', () => {
    // EIP-55 varies the case of the hex body only; the `0x` prefix stays
    // lowercase. An address with an uppercase `0X` prefix is malformed and is
    // rejected by isValidAddress rather than normalised.
    const checksummed = `0x${USDC_SEPOLIA.slice(2).toUpperCase()}`;
    expect(loadConfig(env({ USDC_CONTRACT_ADDRESS: checksummed })).chain.usdcAddress).toBe(
      USDC_SEPOLIA,
    );
  });

  it('rejects an address with a malformed 0X prefix', () => {
    expect(() => loadConfig(env({ USDC_CONTRACT_ADDRESS: USDC_SEPOLIA.toUpperCase() }))).toThrow(
      /not a valid EVM address/,
    );
  });

  it('treats an empty secondary RPC URL as absent', () => {
    expect(loadConfig(env({ SECONDARY_BASE_RPC_URL: '' })).chain.secondaryRpcUrl).toBeNull();
  });

  it('accepts a configured secondary RPC URL', () => {
    const config = loadConfig(env({ SECONDARY_BASE_RPC_URL: 'https://backup.example.com' }));
    expect(config.chain.secondaryRpcUrl).toBe('https://backup.example.com');
  });

  it('permits weak secrets locally so the repo works out of the box', () => {
    const config = loadConfig(
      env({
        DEPLOY_ENV: 'local',
        AUTH_SECRET: 'replace_me_with_32_bytes',
        API_KEY_HASH_PEPPER: 'replace_me_with_32_bytes',
        WEBHOOK_SIGNING_SECRET: 'replace_me_with_32_bytes',
      }),
    );
    expect(config.deployEnv).toBe(DeployEnvironment.Local);
  });
});

describe('loadConfig — refuses to start on a dangerous misconfiguration', () => {
  it('rejects a placeholder secret outside local', () => {
    // A publicly-known webhook signing secret means anyone can forge a payment
    // notification to a merchant.
    expect(() =>
      loadConfig(env({ WEBHOOK_SIGNING_SECRET: 'replace_me_with_32_bytes_xxxxxxx' })),
    ).toThrow(/placeholder/);
  });

  it('rejects a short secret outside local', () => {
    expect(() => loadConfig(env({ AUTH_SECRET: 'tooshort' }))).toThrow(/at least 32/);
  });

  it('rejects reusing the same value for multiple secrets', () => {
    // A leak in the least-protected context would otherwise compromise all three.
    expect(() => loadConfig(env({ API_KEY_HASH_PEPPER: STRONG_A }))).toThrow(/must differ/);
  });

  it('rejects a USDC address that does not match the known deployment', () => {
    // The highest-value check here: a typo'd token address does not error, it
    // silently makes us verify payments against the wrong contract.
    expect(() =>
      loadConfig(env({ USDC_CONTRACT_ADDRESS: '0x9999999999999999999999999999999999999999' })),
    ).toThrow(/does not match the known USDC deployment/);
  });

  it('rejects a mainnet USDC address configured against a testnet chain', () => {
    expect(() => loadConfig(env({ USDC_CONTRACT_ADDRESS: USDC_MAINNET }))).toThrow(
      /does not match the known USDC deployment/,
    );
  });

  it('rejects a production deployment pointed at a testnet', () => {
    expect(() =>
      loadConfig(
        env({
          DEPLOY_ENV: 'production',
          BASE_CHAIN_ID: '84532',
          USDC_CONTRACT_ADDRESS: USDC_SEPOLIA,
        }),
      ),
    ).toThrow(/production is configured against testnet/);
  });

  it('accepts a production deployment on mainnet', () => {
    const config = loadConfig(
      env({
        DEPLOY_ENV: 'production',
        BASE_CHAIN_ID: '8453',
        USDC_CONTRACT_ADDRESS: USDC_MAINNET,
      }),
    );
    expect(config.isProduction).toBe(true);
    expect(config.chain.isTestnet).toBe(false);
  });

  it('rejects an unregistered chain', () => {
    expect(() => loadConfig(env({ BASE_CHAIN_ID: '999999' }))).toThrow(/not a registered chain/);
  });

  it('rejects a malformed token address', () => {
    expect(() => loadConfig(env({ USDC_CONTRACT_ADDRESS: 'not-an-address' }))).toThrow(
      /not a valid EVM address/,
    );
  });

  it('rejects an unknown DEPLOY_ENV rather than guessing', () => {
    expect(() => loadConfig(env({ DEPLOY_ENV: 'prod' }))).toThrow(ConfigurationError);
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'BASE_RPC_URL', 'AUTH_SECRET'])(
    'rejects a missing %s',
    (key) => {
      expect(() => loadConfig(env({ [key]: undefined }))).toThrow(ConfigurationError);
    },
  );

  it('rejects a confirmation count below one', () => {
    expect(() => loadConfig(env({ PAYMENT_CONFIRMATIONS_REQUIRED: '0' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a challenge TTL outside the supported range', () => {
    expect(() => loadConfig(env({ PAYMENT_CHALLENGE_TTL_SECONDS: '5' }))).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfig(env({ PAYMENT_CHALLENGE_TTL_SECONDS: '99999' }))).toThrow(
      ConfigurationError,
    );
  });

  it('reports every problem at once rather than one per restart', () => {
    try {
      loadConfig(env({ AUTH_SECRET: 'short', BASE_CHAIN_ID: '999999' }));
      expect.unreachable('expected configuration to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('redactConfig', () => {
  it('never emits a secret value, not even a prefix', () => {
    const serialised = JSON.stringify(redactConfig(loadConfig(env())));
    for (const secret of [STRONG_A, STRONG_B, STRONG_C]) {
      expect(serialised).not.toContain(secret);
      // A truncated prefix is still a partial secret.
      expect(serialised).not.toContain(secret.slice(0, 8));
    }
    expect(serialised).not.toContain('postgresql://');
  });

  it('reports whether optional integrations are configured without revealing them', () => {
    const redacted = redactConfig(loadConfig(env({ SENTRY_DSN: 'https://key@sentry.io/1' })));
    expect(redacted['observability']).toMatchObject({ sentryDsn: '[set]' });
    expect(JSON.stringify(redacted)).not.toContain('sentry.io');
  });

  it('keeps non-sensitive chain configuration visible for diagnostics', () => {
    expect(redactConfig(loadConfig(env()))['chain']).toMatchObject({ chainId: 84532 });
  });
});
