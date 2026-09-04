import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFlags } from './index.js';
import {
  envFileIsIgnored,
  maskKey,
  readApiKey,
  readConfig,
  writeApiKey,
  writeConfig,
} from './config.js';
import { doctor } from './commands/doctor.js';
import { testPayment } from './commands/inspect.js';

/**
 * The CLI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two things are worth testing hard here, and neither is the argument parser.
 *
 * The first is that no command writes or prints a credential where it does not
 * belong — CLI output is pasted into issues and screenshots, and `.env` files
 * get committed.
 *
 * The second is that `test-payment` cannot be aimed at real money. The server
 * refuses too, with four independent guards; a CLI that would nonetheless
 * *try* is one server bug away from spending someone's USDC.
 * ─────────────────────────────────────────────────────────────────────────
 */

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'meter402-cli-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Capture everything a command wrote, so we can assert on what it did not. */
function captureOutput(): { text: () => string } {
  const chunks: string[] = [];
  const write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(write as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(write as never);
  return { text: () => chunks.join('') };
}

function stubFetch(routes: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const match = Object.entries(routes).find(([path]) => url.includes(path));
    const { status = 200, body } = match?.[1] ?? { status: 404, body: { error: { code: 'X' } } };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('parseFlags', () => {
  it('reads --key value, --key=value, and bare flags', () => {
    const { positional, flags } = parseFlags([
      'init',
      '--price',
      '0.03',
      '--path=/research',
      '--verbose',
    ]);

    expect(positional).toEqual(['init']);
    expect(flags['price']).toBe('0.03');
    expect(flags['path']).toBe('/research');
    expect(flags['verbose']).toBe(true);
  });

  it('does not swallow the next flag as a missing value', () => {
    // `--price --asset USDC` means price was forgotten, not that price is
    // "--asset". Treating it as a value would silently price the endpoint at
    // something nonsensical.
    const { flags } = parseFlags(['init', '--price', '--asset', 'USDC']);
    expect(flags['price']).toBe(true);
    expect(flags['asset']).toBe('USDC');
  });

  it('keeps positional arguments in order', () => {
    const { positional } = parseFlags(['test-payment', 'preq_123', '--api-url', 'http://x']);
    expect(positional).toEqual(['test-payment', 'preq_123']);
  });
});

describe('local configuration', () => {
  it('never writes a secret into the committed config file', () => {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [{ path: '/research', method: 'POST', price: '0.03', asset: 'USDC' }],
      // A caller handing us extra fields must not be able to persist them.
      apiKey: 'mk_test_super_secret',
      secret: 'also-secret',
    } as never);

    const written = readFileSync(join(workspace, '.meter402.json'), 'utf8');
    expect(written).not.toContain('mk_test_super_secret');
    expect(written).not.toContain('also-secret');
    expect(written).toContain('prj_1');
  });

  it('round-trips what it wrote', () => {
    const config = {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [{ path: '/research', method: 'POST', price: '0.03', asset: 'USDC' }],
    };
    writeConfig(workspace, config);
    expect(readConfig(workspace)).toEqual(config);
  });

  it('returns null for a missing or corrupt config rather than throwing', () => {
    expect(readConfig(workspace)).toBeNull();
    writeFileSync(join(workspace, '.meter402.json'), 'not json at all', 'utf8');
    expect(readConfig(workspace)).toBeNull();
  });

  it('prefers the environment variable over the file', () => {
    writeApiKey(workspace, 'mk_from_file');
    expect(readApiKey(workspace, {})).toBe('mk_from_file');
    expect(readApiKey(workspace, { METER402_API_KEY: 'mk_from_env' })).toBe('mk_from_env');
  });

  it('reads a key written with export or quotes', () => {
    writeFileSync(join(workspace, '.env'), 'export METER402_API_KEY="mk_quoted"\n', 'utf8');
    expect(readApiKey(workspace, {})).toBe('mk_quoted');
  });

  it('replaces an existing key rather than appending a second one', () => {
    writeApiKey(workspace, 'mk_first');
    writeApiKey(workspace, 'mk_second');

    const contents = readFileSync(join(workspace, '.env'), 'utf8');
    expect(contents.match(/METER402_API_KEY/g)).toHaveLength(1);
    expect(contents).toContain('mk_second');
    expect(contents).not.toContain('mk_first');
  });

  it('preserves other variables when adding the key', () => {
    writeFileSync(join(workspace, '.env'), 'DATABASE_URL=postgres://x\n', 'utf8');
    writeApiKey(workspace, 'mk_added');

    const contents = readFileSync(join(workspace, '.env'), 'utf8');
    expect(contents).toContain('DATABASE_URL=postgres://x');
    expect(contents).toContain('METER402_API_KEY=mk_added');
  });

  it.each([['.env'], ['.env*'], ['*.env'], ['.env.local']])(
    'recognises %s as ignoring the env file',
    (pattern) => {
      writeFileSync(join(workspace, '.gitignore'), `node_modules\n${pattern}\n`, 'utf8');
      expect(envFileIsIgnored(workspace)).toBe(true);
    },
  );

  it('reports an unignored env file, including when there is no .gitignore', () => {
    expect(envFileIsIgnored(workspace)).toBe(false);
    writeFileSync(join(workspace, '.gitignore'), 'node_modules\ndist\n', 'utf8');
    expect(envFileIsIgnored(workspace)).toBe(false);
  });

  it('masks a key to something recognisable but unusable', () => {
    const key = 'mk_test_abcdefghijklmnopqrstuvwxyz';
    const masked = maskKey(key);

    expect(masked).not.toBe(key);
    expect(masked).not.toContain('ijklmnopqrstuv');
    // Still enough to tell two keys apart at a glance.
    expect(masked.startsWith('mk_test_')).toBe(true);
  });

  it('masks a short value entirely rather than revealing most of it', () => {
    expect(maskKey('mk_short')).toBe('***');
  });
});

describe('meter402 doctor', () => {
  it('fails, and says what to run, when nothing is configured', async () => {
    const output = captureOutput();
    const code = await doctor({ cwd: workspace });

    expect(code).toBe(1);
    expect(output.text()).toContain('meter402 init');
  });

  it('reports a healthy setup and exits zero', async () => {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, 'mk_test_key_that_is_long_enough');
    writeFileSync(join(workspace, '.gitignore'), '.env\n', 'utf8');

    const output = captureOutput();
    const code = await doctor({
      cwd: workspace,
      fetch: stubFetch({
        '/health/payments': { body: { settlement: 'disabled', enabledNetworks: [] } },
        '/health': { body: { status: 'ok' } },
        '/v1/me': {
          body: {
            data: {
              apiKey: {
                organizationId: 'org_1',
                projectId: 'prj_1',
                environment: 'TEST',
                scopes: ['payments:read', 'payments:write'],
              },
            },
          },
        },
        '/v1/endpoints': {
          body: {
            data: [
              {
                path: '/research',
                method: 'POST',
                status: 'ACTIVE',
                price: { amountMinorUnits: '30000', asset: 'USDC' },
              },
            ],
          },
        },
      }),
    });

    expect(code).toBe(0);
    expect(output.text()).toContain('Ready');
  });

  it('never prints the API key', async () => {
    const secret = 'mk_test_this_must_never_be_printed';
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, secret);

    const output = captureOutput();
    await doctor({
      cwd: workspace,
      fetch: stubFetch({
        '/health': { body: { status: 'ok' } },
        '/v1/me': {
          body: { data: { apiKey: { environment: 'TEST', scopes: ['payments:write'] } } },
        },
        '/v1/endpoints': { body: { data: [] } },
      }),
    });

    expect(output.text()).not.toContain(secret);
  });

  it('warns when the file holding the key is not git-ignored', async () => {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, 'mk_test_key_long_enough_here');
    // No .gitignore at all.

    const output = captureOutput();
    await doctor({
      cwd: workspace,
      fetch: stubFetch({
        '/health': { body: { status: 'ok' } },
        '/v1/me': {
          body: { data: { apiKey: { environment: 'TEST', scopes: ['payments:write'] } } },
        },
        '/v1/endpoints': { body: { data: [] } },
      }),
    });

    expect(output.text()).toContain('.gitignore');
  });

  it('fails when the key lacks payments:write', async () => {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, 'mk_test_read_only_key_here');
    writeFileSync(join(workspace, '.gitignore'), '.env\n', 'utf8');

    captureOutput();
    const code = await doctor({
      cwd: workspace,
      fetch: stubFetch({
        '/health': { body: { status: 'ok' } },
        '/v1/me': {
          body: { data: { apiKey: { environment: 'TEST', scopes: ['payments:read'] } } },
        },
        '/v1/endpoints': { body: { data: [] } },
      }),
    });

    expect(code).toBe(1);
  });

  it('fails when a payment was abandoned by the reconciler', async () => {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, 'mk_test_key_long_enough_here');
    writeFileSync(join(workspace, '.gitignore'), '.env\n', 'utf8');

    const output = captureOutput();
    const code = await doctor({
      cwd: workspace,
      fetch: stubFetch({
        '/health/payments': {
          body: {
            settlement: 'available',
            enabledNetworks: ['eip155:84532'],
            dependencies: { facilitator: true },
            backlog: { exhausted: 3 },
          },
        },
        '/health': { body: { status: 'ok' } },
        '/v1/me': {
          body: { data: { apiKey: { environment: 'TEST', scopes: ['payments:write'] } } },
        },
        '/v1/endpoints': {
          body: {
            data: [
              {
                path: '/x',
                method: 'POST',
                status: 'ACTIVE',
                price: { amountMinorUnits: '1', asset: 'USDC' },
              },
            ],
          },
        },
      }),
    });

    // Three payments whose outcome nobody knows is not a healthy system.
    expect(code).toBe(1);
    expect(output.text()).toContain('RECONCILIATION_EXHAUSTED');
  });

  it('reports an unreachable API without pretending anything else passed', async () => {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:9999',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, 'mk_test_key_long_enough_here');
    writeFileSync(join(workspace, '.gitignore'), '.env\n', 'utf8');

    const output = captureOutput();
    const code = await doctor({
      cwd: workspace,
      fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(output.text()).toContain('Is the server running?');
    // It stopped there rather than claiming the credential is valid.
    expect(output.text()).not.toContain('API key valid');
  });
});

describe('meter402 test-payment', () => {
  function configure(): void {
    writeConfig(workspace, {
      apiUrl: 'http://localhost:8080',
      organizationId: 'org_1',
      projectId: 'prj_1',
      environment: 'TEST',
      endpoints: [],
    });
    writeApiKey(workspace, 'mk_key_long_enough_to_mask');
  }

  it('refuses a LIVE credential before contacting the server at all', async () => {
    configure();
    let completeCalled = false;

    const output = captureOutput();
    const code = await testPayment({
      cwd: workspace,
      paymentRequestId: 'preq_01',
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/complete')) completeCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { apiKey: { environment: 'LIVE' } } }),
        } as Response;
      }) as unknown as typeof fetch,
    });

    expect(code).toBe(1);
    expect(completeCalled).toBe(false);
    expect(output.text()).toContain('LIVE');
  });

  it('pays a TEST request and prints a proof header ready to paste', async () => {
    configure();

    const output = captureOutput();
    const code = await testPayment({
      cwd: workspace,
      paymentRequestId: 'preq_01',
      fetch: stubFetch({
        '/v1/me': { body: { data: { apiKey: { environment: 'TEST' } } } },
        '/complete': {
          body: {
            data: {
              reference: 'ref_abc',
              created: true,
              payment: { id: 'pay_01' },
              receipt: { id: 'rcpt_01' },
            },
          },
        },
      }),
    });

    expect(code).toBe(0);
    const text = output.text();
    expect(text).toContain('meter402-payment');

    // The proof is a base64 blob the developer pastes; it must decode to the
    // exact pair the gate expects, or the next step of the quickstart fails.
    const match = /meter402-payment[^:]*:\s*([A-Za-z0-9+/=]+)/.exec(text);
    expect(match).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(match![1]!, 'base64').toString('utf8')) as {
      paymentRequestId: string;
      reference: string;
    };
    expect(decoded).toEqual({ paymentRequestId: 'preq_01', reference: 'ref_abc' });
  });

  it('is idempotent about an already-paid request', async () => {
    configure();

    const output = captureOutput();
    const code = await testPayment({
      cwd: workspace,
      paymentRequestId: 'preq_01',
      fetch: stubFetch({
        '/v1/me': { body: { data: { apiKey: { environment: 'TEST' } } } },
        '/complete': {
          body: {
            data: {
              reference: 'ref_abc',
              created: false,
              payment: { id: 'pay_01' },
              receipt: { id: 'rcpt_01' },
            },
          },
        },
      }),
    });

    // Paying twice is a thing agents do; it is not an error.
    expect(code).toBe(0);
    expect(output.text()).toContain('Already paid');
  });

  it('does not create a config file as a side effect of failing', async () => {
    captureOutput();
    const code = await testPayment({ cwd: workspace, paymentRequestId: 'preq_01' });

    expect(code).toBe(1);
    expect(existsSync(join(workspace, '.meter402.json'))).toBe(false);
  });
});
