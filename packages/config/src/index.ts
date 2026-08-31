/**
 * @meter402/config
 *
 * Environment configuration, validated once at startup.
 *
 * The governing principle is **fail closed, loudly, at boot**. A service that
 * starts with a placeholder signing secret and only misbehaves under load is
 * far worse than one that refuses to start. Every check here is designed to
 * turn a silent production misconfiguration into a crash on deploy, where it
 * is cheap to notice.
 */

import { z } from 'zod';
import {
  DeployEnvironment,
  findChainById,
  findAsset,
  isValidAddress,
  normalizeAddress,
  parseDeployEnvironment,
} from '@meter402/shared';

export class ConfigurationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(issues.length > 0 ? `${message}\n  - ${issues.join('\n  - ')}` : message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Values shipped in `.env.example`. Harmless locally, catastrophic in
 * production — a shared, publicly-known webhook signing secret means anyone
 * can forge a payment notification to a merchant.
 */
const PLACEHOLDER_MARKERS = ['replace_me', 'changeme', 'placeholder', 'example', 'todo'];

const MIN_SECRET_LENGTH = 32;

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

const rawSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DEPLOY_ENV: z.string().default('local'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  DASHBOARD_ORIGIN: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  API_KEY_HASH_PEPPER: z.string().min(1, 'API_KEY_HASH_PEPPER is required'),
  WEBHOOK_SIGNING_SECRET: z.string().min(1, 'WEBHOOK_SIGNING_SECRET is required'),
  /*
   * Keys the TEST settlement references the payment simulator issues.
   *
   * A separate secret rather than a reuse of AUTH_SECRET: a simulated
   * settlement reference is a bearer credential for a TEST payment, and
   * deriving it from the session secret would make one leak compromise both
   * session forgery and payment forgery.
   */
  TEST_SIMULATOR_SECRET: z.string().min(1, 'TEST_SIMULATOR_SECRET is required'),

  BASE_CHAIN_ID: z.coerce.number().int(),
  BASE_RPC_URL: z.string().url(),
  SECONDARY_BASE_RPC_URL: z.string().url().or(z.literal('')).optional(),
  USDC_CONTRACT_ADDRESS: z.string(),
  PAYMENT_CONFIRMATIONS_REQUIRED: z.coerce.number().int().min(1).max(200).default(3),
  PAYMENT_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  SENTRY_DSN: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export interface AppConfig {
  readonly nodeEnv: string;
  readonly deployEnv: DeployEnvironment;
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly isProduction: boolean;

  readonly api: {
    readonly port: number;
    readonly host: string;
    readonly dashboardOrigin: string;
  };

  readonly database: { readonly url: string };
  readonly redis: { readonly url: string };

  /**
   * Secrets are grouped so that a log-redaction list can target one object
   * path rather than enumerating individual keys and missing one.
   */
  readonly secrets: {
    readonly authSecret: string;
    readonly apiKeyHashPepper: string;
    readonly webhookSigningSecret: string;
    readonly testSimulatorSecret: string;
  };

  readonly chain: {
    readonly chainId: number;
    readonly slug: string;
    readonly isTestnet: boolean;
    readonly primaryRpcUrl: string;
    readonly secondaryRpcUrl: string | null;
    readonly usdcAddress: string;
    readonly confirmationsRequired: number;
    readonly challengeTtlSeconds: number;
  };

  readonly observability: {
    readonly sentryDsn: string | null;
    readonly posthogKey: string | null;
    readonly otelEndpoint: string | null;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigurationError(
      'Invalid environment configuration',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const raw = parsed.data;

  let deployEnv: DeployEnvironment;
  try {
    deployEnv = parseDeployEnvironment(raw.DEPLOY_ENV);
  } catch (error) {
    throw new ConfigurationError(error instanceof Error ? error.message : 'Invalid DEPLOY_ENV');
  }
  const isLocal = deployEnv === DeployEnvironment.Local;

  const issues: string[] = [];

  /*
   * Secret strength. Relaxed locally so `docker compose up` works out of the
   * box, enforced everywhere else. `local` is the only environment where a
   * weak secret cannot reach anything real.
   */
  const secretEntries: ReadonlyArray<readonly [string, string]> = [
    ['AUTH_SECRET', raw.AUTH_SECRET],
    ['API_KEY_HASH_PEPPER', raw.API_KEY_HASH_PEPPER],
    ['WEBHOOK_SIGNING_SECRET', raw.WEBHOOK_SIGNING_SECRET],
    ['TEST_SIMULATOR_SECRET', raw.TEST_SIMULATOR_SECRET],
  ];

  if (!isLocal) {
    for (const [name, value] of secretEntries) {
      if (looksLikePlaceholder(value)) {
        issues.push(
          `${name} still contains a placeholder value from .env.example. ` +
            `Generate one with: openssl rand -hex 32`,
        );
      } else if (value.length < MIN_SECRET_LENGTH) {
        issues.push(
          `${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${value.length}).`,
        );
      }
    }

    // Distinct secrets. Reusing one value across purposes means a leak in the
    // least-protected context compromises all three.
    const distinct = new Set(secretEntries.map(([, value]) => value));
    if (distinct.size !== secretEntries.length) {
      issues.push(
        'AUTH_SECRET, API_KEY_HASH_PEPPER, WEBHOOK_SIGNING_SECRET, and ' +
          'TEST_SIMULATOR_SECRET must all differ.',
      );
    }
  }

  const chain = findChainById(raw.BASE_CHAIN_ID);
  if (!chain) {
    issues.push(
      `BASE_CHAIN_ID ${raw.BASE_CHAIN_ID} is not a registered chain. ` +
        `Register it in @meter402/shared before configuring it.`,
    );
  }

  if (!isValidAddress(raw.USDC_CONTRACT_ADDRESS)) {
    issues.push(`USDC_CONTRACT_ADDRESS is not a valid EVM address.`);
  } else if (chain) {
    /*
     * Cross-check the configured token contract against the registry.
     *
     * This is the highest-value check in this file. A typo in a token address
     * does not cause an error — it causes us to verify payments against a
     * contract nobody is paying, or worse, a different token entirely. The
     * registry is the reviewed source of truth, so a mismatch is a
     * configuration bug that must stop the deploy.
     */
    const known = findAsset('USDC', chain.id);
    if (
      known &&
      !(normalizeAddress(known.address) === normalizeAddress(raw.USDC_CONTRACT_ADDRESS))
    ) {
      issues.push(
        `USDC_CONTRACT_ADDRESS ${raw.USDC_CONTRACT_ADDRESS} does not match the known USDC ` +
          `deployment on ${chain.name} (${known.address}). Refusing to start rather than ` +
          `verify payments against an unexpected token contract.`,
      );
    }
  }

  // A production deployment settling on a testnet is almost certainly a
  // misconfiguration, and one that would make every "payment" worthless.
  if (deployEnv === DeployEnvironment.Production && chain?.isTestnet === true) {
    issues.push(
      `DEPLOY_ENV=production is configured against testnet chain ${chain.name}. ` +
        `Refusing to start.`,
    );
  }

  if (issues.length > 0) {
    throw new ConfigurationError('Invalid environment configuration', issues);
  }

  /* istanbul ignore next -- unreachable: a missing chain is pushed to issues above. */
  if (!chain) {
    throw new ConfigurationError('Unresolved chain configuration');
  }

  const secondary = raw.SECONDARY_BASE_RPC_URL?.trim();

  return {
    nodeEnv: raw.NODE_ENV,
    deployEnv,
    logLevel: raw.LOG_LEVEL,
    isProduction: deployEnv === DeployEnvironment.Production,
    api: {
      port: raw.API_PORT,
      host: raw.API_HOST,
      dashboardOrigin: raw.DASHBOARD_ORIGIN,
    },
    database: { url: raw.DATABASE_URL },
    redis: { url: raw.REDIS_URL },
    secrets: {
      authSecret: raw.AUTH_SECRET,
      apiKeyHashPepper: raw.API_KEY_HASH_PEPPER,
      webhookSigningSecret: raw.WEBHOOK_SIGNING_SECRET,
      testSimulatorSecret: raw.TEST_SIMULATOR_SECRET,
    },
    chain: {
      chainId: chain.id,
      slug: chain.slug,
      isTestnet: chain.isTestnet,
      primaryRpcUrl: raw.BASE_RPC_URL,
      secondaryRpcUrl: secondary && secondary.length > 0 ? secondary : null,
      usdcAddress: normalizeAddress(raw.USDC_CONTRACT_ADDRESS),
      confirmationsRequired: raw.PAYMENT_CONFIRMATIONS_REQUIRED,
      challengeTtlSeconds: raw.PAYMENT_CHALLENGE_TTL_SECONDS,
    },
    observability: {
      sentryDsn: raw.SENTRY_DSN?.trim() || null,
      posthogKey: raw.POSTHOG_KEY?.trim() || null,
      otelEndpoint: raw.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null,
    },
  };
}

/**
 * A config object safe to log or expose on a diagnostics endpoint.
 * Secrets are replaced with a presence marker, never a truncated prefix —
 * a prefix is still a partial secret.
 */
export function redactConfig(config: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    deployEnv: config.deployEnv,
    logLevel: config.logLevel,
    api: config.api,
    database: { url: '[redacted]' },
    redis: { url: '[redacted]' },
    secrets: {
      authSecret: '[set]',
      apiKeyHashPepper: '[set]',
      webhookSigningSecret: '[set]',
      testSimulatorSecret: '[set]',
    },
    chain: config.chain,
    observability: {
      sentryDsn: config.observability.sentryDsn ? '[set]' : null,
      posthogKey: config.observability.posthogKey ? '[set]' : null,
      otelEndpoint: config.observability.otelEndpoint,
    },
  };
}
