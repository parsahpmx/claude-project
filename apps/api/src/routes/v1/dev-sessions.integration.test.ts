import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, hasDatabase, type Harness } from '../../test-support/harness.js';

/**
 * The development session route must not exist outside local/development.
 *
 * This route mints a bearer token for any email without proving control of it
 * — a complete authentication bypass, deliberately, so that Phase 1's
 * authorization work can be exercised end to end before a real identity
 * provider exists.
 *
 * The docs claim it is absent from staging and production. That claim is worth
 * exactly as much as the test that checks it, so here it is: the app is built
 * with each deployment environment's real configuration and the route probed.
 */
describe.skipIf(!hasDatabase)('development session route confinement', () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('exists in local, where it is needed', async () => {
    harness = await createHarness({ DEPLOY_ENV: 'local' });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions',
      payload: { email: `local-${Date.now()}@example.test` },
    });
    expect(response.statusCode).toBe(201);
  });

  it('exists in development', async () => {
    harness = await createHarness({ DEPLOY_ENV: 'development' });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions',
      payload: { email: `dev-${Date.now()}@example.test` },
    });
    expect(response.statusCode).toBe(201);
  });

  it.each(['staging', 'production'])('does not exist in %s', async (deployEnv) => {
    /*
     * Production requires a mainnet chain, and the config loader refuses a
     * production deployment pointed at a testnet — so the mainnet USDC address
     * has to come along for the config to load at all. That refusal is itself
     * a Phase 0 guard, working.
     */
    harness = await createHarness(
      deployEnv === 'production'
        ? {
            DEPLOY_ENV: 'production',
            BASE_CHAIN_ID: '8453',
            USDC_CONTRACT_ADDRESS: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          }
        : { DEPLOY_ENV: deployEnv },
    );

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/dev/sessions',
      payload: { email: `nope-${Date.now()}@example.test` },
    });

    // 404 because the route was never registered — not 401, not 403. There is
    // nothing there to disable, flag, or misconfigure back on.
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('token');
  });

  it('still serves the rest of the API in production', async () => {
    // Confirms the previous assertion is about this one route, not about the
    // whole /v1 surface failing to register under a production config.
    harness = await createHarness({
      DEPLOY_ENV: 'production',
      BASE_CHAIN_ID: '8453',
      USDC_CONTRACT_ADDRESS: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    });

    const health = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    // /v1/me exists but requires a credential we cannot mint in production.
    const me = await harness.app.inject({ method: 'GET', url: '/v1/me' });
    expect(me.statusCode).toBe(401);
  });
});
