import { ManagementApi } from '../api.js';
import {
  API_KEY_VAR,
  ENV_FILE,
  envFileIsIgnored,
  maskKey,
  readApiKey,
  readConfig,
} from '../config.js';
import { FAIL, PASS, WARN, bold, cyan, dim, heading, line } from '../output.js';

/**
 * `meter402 doctor` — why isn't it working?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The command someone runs when they are already frustrated. So every check
 * answers a specific question they might be wrong about, in the order things
 * actually fail, and every failure says what to *do* — not just what is wrong.
 *
 * It exits non-zero when something is genuinely broken, so it can be a CI
 * step and a pre-deploy gate rather than only something a human reads.
 *
 * It prints no secrets. Doctor output is exactly the thing people paste into
 * issues and screenshots.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface DoctorOptions {
  readonly cwd: string;
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
}

interface Check {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly detail?: string;
  /** What to do about it. Only for failures. */
  readonly remedy?: string;
}

export async function doctor(options: DoctorOptions): Promise<number> {
  const checks: Check[] = [];
  const config = readConfig(options.cwd);
  const apiKey = readApiKey(options.cwd);

  heading('Meter402 Doctor');

  /* ── Local setup ─────────────────────────────────────────────────────── */

  if (config) {
    checks.push({ name: 'configuration loaded', status: 'pass', detail: config.apiUrl });
  } else {
    checks.push({
      name: 'configuration loaded',
      status: 'fail',
      detail: 'no .meter402.json in this directory',
      remedy: 'Run `meter402 init`.',
    });
  }

  if (apiKey) {
    checks.push({ name: 'API key present', status: 'pass', detail: maskKey(apiKey) });
  } else {
    checks.push({
      name: 'API key present',
      status: 'fail',
      detail: `${API_KEY_VAR} is not set and no ${ENV_FILE} carries it`,
      remedy: `Set ${API_KEY_VAR}, or run \`meter402 init\`.`,
    });
  }

  if (apiKey && !envFileIsIgnored(options.cwd)) {
    /*
     * A warning rather than a failure: the setup works. But a key in a file
     * git is watching is a key that will be committed eventually, and the
     * moment to say so is before that happens.
     */
    checks.push({
      name: `${ENV_FILE} is git-ignored`,
      status: 'warn',
      detail: 'the file holding your API key is not ignored',
      remedy: `Add ${ENV_FILE} to .gitignore before committing.`,
    });
  }

  const apiUrl = options.apiUrl ?? config?.apiUrl;
  if (!apiUrl || !apiKey) {
    return report(checks);
  }

  /* ── The server ──────────────────────────────────────────────────────── */

  const api = new ManagementApi({
    baseUrl: apiUrl,
    token: apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  let reachable = false;
  try {
    await api.request('GET', '/health');
    reachable = true;
    checks.push({ name: 'API reachable', status: 'pass', detail: apiUrl });
  } catch (error) {
    checks.push({
      name: 'API reachable',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      remedy: 'Is the server running? Check the URL in .meter402.json.',
    });
  }

  if (!reachable) return report(checks);

  /* ── The credential ──────────────────────────────────────────────────── */

  let environment = '';
  let projectId = '';
  try {
    const me = await api.request('GET', '/v1/me');
    const data = api.data<Record<string, unknown>>(me);
    const credential = (data['apiKey'] ?? data) as Record<string, unknown>;
    environment = String(credential['environment'] ?? '');
    projectId = String(credential['projectId'] ?? '');
    const scopes = Array.isArray(credential['scopes']) ? (credential['scopes'] as string[]) : [];

    checks.push({ name: 'API key valid', status: 'pass' });
    checks.push({
      name: `environment ${environment}`,
      status: 'pass',
      detail: environment === 'TEST' ? 'no real money can move' : 'real settlement environment',
    });
    checks.push({ name: 'project active', status: 'pass', detail: projectId });

    if (scopes.includes('payments:write')) {
      checks.push({ name: 'payments:write granted', status: 'pass' });
    } else {
      checks.push({
        name: 'payments:write granted',
        status: 'fail',
        detail: `key holds: ${scopes.join(', ') || 'nothing'}`,
        remedy: 'A key without payments:write cannot authorize requests. Issue a new one.',
      });
    }
  } catch (error) {
    checks.push({
      name: 'API key valid',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      remedy: 'The key was rejected. Rotate it, or run `meter402 init` again.',
    });
    return report(checks);
  }

  /* ── The endpoints ───────────────────────────────────────────────────── */

  try {
    const listed = await api.request('GET', '/v1/endpoints');
    const endpoints =
      api.data<
        Array<{
          path: string;
          method: string;
          status: string;
          price: { amount: string; asset: string } | null;
        }>
      >(listed) ?? [];

    if (endpoints.length === 0) {
      checks.push({
        name: 'endpoint configured',
        status: 'fail',
        detail: 'this project has no endpoints',
        remedy: 'Run `meter402 init`, or create one in the dashboard.',
      });
    } else {
      for (const endpoint of endpoints) {
        const label = `${endpoint.method} ${endpoint.path}`;
        if (endpoint.status !== 'ACTIVE') {
          checks.push({
            name: `endpoint ${label}`,
            status: 'fail',
            detail: `is ${endpoint.status}`,
            remedy: 'A non-active endpoint will not serve requests.',
          });
        } else if (!endpoint.price) {
          checks.push({
            name: `endpoint ${label}`,
            status: 'fail',
            detail: 'has no price',
            remedy: 'An endpoint without a price cannot issue a payment challenge.',
          });
        } else {
          checks.push({
            name: `endpoint ${label}`,
            status: 'pass',
            detail: `${endpoint.price.amount} ${endpoint.price.asset}`,
          });
        }
      }
    }
  } catch (error) {
    checks.push({
      name: 'endpoints readable',
      status: 'warn',
      detail: error instanceof Error ? error.message : String(error),
      remedy: 'The key may lack endpoints:read. Payments still work without it.',
    });
  }

  /* ── Real settlement, when this deployment does that ──────────────────── */

  try {
    const health = await api.request<Record<string, unknown>>('GET', '/health/payments');
    const settlement = String(health['settlement'] ?? 'unknown');
    const networks = Array.isArray(health['enabledNetworks'])
      ? (health['enabledNetworks'] as string[])
      : [];

    if (settlement === 'disabled') {
      checks.push({
        name: 'real settlement',
        status: 'pass',
        detail: 'disabled — simulated TEST payments only',
      });
    } else {
      checks.push({
        name: 'real settlement',
        status: settlement === 'available' ? 'pass' : 'warn',
        detail: `${settlement} on ${networks.join(', ') || 'no network'}`,
        ...(settlement === 'available'
          ? {}
          : { remedy: 'A dependency is down. Payments may fail until it recovers.' }),
      });

      const dependencies = (health['dependencies'] ?? {}) as Record<string, boolean>;
      for (const [name, healthy] of Object.entries(dependencies)) {
        checks.push({
          name: `${name} reachable`,
          status: healthy ? 'pass' : 'warn',
          ...(healthy ? {} : { remedy: `Meter402 cannot reach its ${name}.` }),
        });
      }

      const backlog = (health['backlog'] ?? {}) as Record<string, number>;
      if (typeof backlog['exhausted'] === 'number' && backlog['exhausted'] > 0) {
        checks.push({
          name: 'no unresolved settlements',
          status: 'fail',
          detail: `${backlog['exhausted']} payment(s) the reconciler gave up on`,
          remedy: 'See docs/runbooks/RECONCILIATION_EXHAUSTED.md. These need a human.',
        });
      }
    }
  } catch {
    // Not every deployment exposes this, and its absence is not a problem
    // with the developer's setup.
  }

  return report(checks);
}

function report(checks: readonly Check[]): number {
  line();
  for (const check of checks) {
    const mark = check.status === 'pass' ? PASS : check.status === 'warn' ? WARN : FAIL;
    const detail = check.detail ? dim(`  ${check.detail}`) : '';
    line(`  ${mark} ${check.name}${detail}`);
    if (check.remedy) line(`      ${cyan(check.remedy)}`);
  }

  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;

  line();
  if (failures > 0) {
    line(bold(`${failures} problem${failures === 1 ? '' : 's'} to fix.`));
    // Non-zero, so this can gate a deploy rather than only inform a human.
    return 1;
  }
  line(warnings > 0 ? `Ready, with ${warnings} warning${warnings === 1 ? '' : 's'}.` : 'Ready.');
  return 0;
}
