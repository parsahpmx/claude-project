import { z } from 'zod';

/**
 * Configuration is validated once, at boot, and the process refuses to start
 * if it is wrong. A server that boots with a missing secret and fails on the
 * first login is strictly worse than one that never boots.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  FORGE_DATA_DIR: z.string().optional(),
  /** Signs nothing on its own — session tokens are random and stored hashed. */
  COOKIE_SECRET: z.string().min(32).default('forge-development-cookie-secret-value-01'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Seed on boot when the database is empty. Development convenience only. */
  AUTO_SEED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid FORGE API configuration:\n${detail}`);
  }

  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    // Development defaults must never silently become production settings.
    if (config.COOKIE_SECRET.startsWith('forge-development')) {
      throw new Error('COOKIE_SECRET must be set to a real secret in production.');
    }
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL must point at a Postgres server in production.');
    }
    if (config.AUTO_SEED) {
      throw new Error('AUTO_SEED must be false in production.');
    }
  }
  return config;
}
