import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_MAINNET, BASE_SEPOLIA } from '@meter402/shared';
import {
  call,
  createHarness,
  createTestOrganization,
  createTestProject,
  hasDatabase,
  testConfig,
  type Harness,
} from '../../test-support/harness.js';

/**
 * Base mainnet stays off.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Phase 3.5 ships real settlement against a testnet. Real money is one
 * configuration mistake away, and the mistake would not announce itself: a
 * mainnet payment that settles looks exactly like a testnet payment that
 * settles, until someone reads the chain ID.
 *
 * So mainnet is not merely "not switched on". It is unreachable through every
 * route into the system, and this file is the proof, walking each of them:
 *
 *   the environment    both flags, and the contradiction between them
 *   the derived config which chains real settlement may use at all
 *   stored state       whether a merchant can even name mainnet as a
 *                      destination
 *   the payment path   whether a LIVE endpoint can settle
 *   the repository     what a deployment inherits by default
 *
 * These tests are written to fail if mainnet becomes reachable — including by
 * an unrelated change that nobody thought of as touching mainnet. That is the
 * point: the danger is not a deliberate flip of the switch, it is a change
 * that quietly makes the switch stop mattering.
 * ─────────────────────────────────────────────────────────────────────────
 */

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

describe('Base mainnet lockout: configuration', () => {
  it('leaves mainnet out of the enabled chains under the default environment', () => {
    const config = testConfig({});
    expect(config.settlement.baseMainnetEnabled).toBe(false);
    expect(config.settlement.enabledChainIds).not.toContain(BASE_MAINNET.id);
  });

  it('leaves mainnet out even when real settlement is fully enabled', () => {
    const config = testConfig({
      LIVE_SETTLEMENT_ENABLED: 'true',
      X402_FACILITATOR_URL: 'https://facilitator.example.test',
    });

    // This is the Phase 3.5 shape exactly: real settlement, testnet only.
    expect(config.settlement.liveSettlementEnabled).toBe(true);
    expect(config.settlement.enabledChainIds).toEqual([BASE_SEPOLIA.id]);
  });

  it('refuses to boot when mainnet is requested without settlement', () => {
    expect(() => testConfig({ ENABLE_BASE_MAINNET: 'true' })).toThrow(
      /LIVE_SETTLEMENT_ENABLED is false/,
    );
  });

  it('refuses to boot when settlement is enabled with no facilitator to settle through', () => {
    expect(() =>
      testConfig({ LIVE_SETTLEMENT_ENABLED: 'true', ENABLE_BASE_MAINNET: 'true' }),
    ).toThrow(/requires a facilitator/);
  });

  it('does not accept a truthy-looking string as consent to use mainnet', () => {
    /*
     * `Boolean('false')` is true, and so is `Boolean('0')`. A flag decided by
     * truthiness would read every one of these as "yes".
     */
    for (const value of ['false', '0', 'no', '']) {
      expect(testConfig({ ENABLE_BASE_MAINNET: value }).settlement.baseMainnetEnabled).toBe(false);
    }
  });

  it('rejects anything it does not recognise rather than resolving it either way', () => {
    /*
     * An empty value is accepted above and reads as off, which is the safe
     * direction for a variable that failed to interpolate. Anything *else*
     * unrecognised is refused rather than guessed at: 'off' is not in the
     * vocabulary, and silently treating it as false would teach operators a
     * spelling that the next flag might read differently.
     */
    for (const value of ['yes please', 'off', 'TRUE-ish', '2']) {
      expect(() => testConfig({ ENABLE_BASE_MAINNET: value })).toThrow();
    }
  });
});

describe('Base mainnet lockout: what the repository ships', () => {
  it('ships both switches off in .env.example', () => {
    const example = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
    expect(example).toMatch(/^LIVE_SETTLEMENT_ENABLED=false$/m);
    expect(example).toMatch(/^ENABLE_BASE_MAINNET=false$/m);
    expect(example).not.toMatch(/^ENABLE_BASE_MAINNET=true$/m);
  });

  it('has no committed deployment file that turns mainnet on', () => {
    /*
     * A committed `ENABLE_BASE_MAINNET=true` in anything a deployment reads —
     * an env file, a compose file, a manifest, a Dockerfile, a CI workflow, a
     * shell script — is how the switch quietly stops meaning anything.
     *
     * Source files are deliberately excluded: a test that constructs the
     * enabled configuration in memory (as `packages/config` does, to prove the
     * flag works) is not a deployment, and forbidding it would mean the flag
     * could never be tested. What matters is that nothing a *running system*
     * loads carries the value.
     */
    const deploymentFile =
      /(^|\/)(\.env[^/]*|[^/]*\.(ya?ml|tf|tfvars|sh|bash|toml|ini|conf|properties)|Dockerfile[^/]*|Makefile|Procfile)$/;

    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((path) => path.length > 0 && deploymentFile.test(path));

    // The scan is worthless if it matched nothing; prove it has a corpus.
    expect(tracked.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const path of tracked) {
      let contents: string;
      try {
        contents = readFileSync(join(REPO_ROOT, path), 'utf8');
      } catch {
        /* istanbul ignore next -- binary or unreadable; no assignment in it. */
        continue;
      }
      if (/ENABLE_BASE_MAINNET\s*[=:]\s*['"]?(true|1|yes)/i.test(contents)) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('Base mainnet lockout: the running system', () => {
  let harness: Harness;

  beforeAll(async () => {
    // Real settlement on, exactly as Phase 3.5 deploys it.
    harness = await createHarness({ settlement: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses to store a mainnet settlement destination', async () => {
    const org = await createTestOrganization(harness.app, 'mainnet-lock');
    const projectId = await createTestProject(
      harness.app,
      org.organizationId,
      org.owner.token,
      'mainnet-lock',
    );

    const response = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${org.organizationId}/settlement`,
      token: org.owner.token,
      payload: {
        projectId,
        chainId: BASE_MAINNET.id,
        asset: 'USDC',
        recipientAddress: '0x209693bc6afc0c5328ba36faf03c514ef312287c',
      },
    });

    expect(response.status).toBe(422);
    expect((response.body['error'] as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('still accepts the testnet destination, so the refusal is about mainnet', async () => {
    const org = await createTestOrganization(harness.app, 'testnet-ok');
    const projectId = await createTestProject(
      harness.app,
      org.organizationId,
      org.owner.token,
      'testnet-ok',
    );

    const response = await call(harness.app, {
      method: 'PUT',
      url: `/v1/organizations/${org.organizationId}/settlement`,
      token: org.owner.token,
      payload: {
        projectId,
        chainId: BASE_SEPOLIA.id,
        asset: 'USDC',
        recipientAddress: '0x209693bc6afc0c5328ba36faf03c514ef312287c',
      },
    });

    expect(response.status).toBeLessThan(300);
  });

  it('reports only the testnet network as payment-enabled', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health/payments' });
    const body = response.json();

    /*
     * Compared as a list, not as a substring: "eip155:8453" is a prefix of
     * "eip155:84532", so a substring check here would pass on a response that
     * named only the testnet and fail on nothing.
     */
    expect(body.enabledNetworks).toEqual([`eip155:${BASE_SEPOLIA.id}`]);
    expect(body.enabledNetworks).not.toContain(`eip155:${BASE_MAINNET.id}`);
  });
});
