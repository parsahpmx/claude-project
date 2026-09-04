import { ManagementApi, ApiError } from '../api.js';
import {
  API_KEY_VAR,
  CONFIG_FILE,
  ENV_FILE,
  envFileIsIgnored,
  maskKey,
  readApiKey,
  writeApiKey,
  writeConfig,
  type ProjectConfig,
} from '../config.js';
import { PASS, WARN, bold, cyan, dim, heading, line } from '../output.js';

/**
 * `meter402 init` — from nothing to a paid endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This command is the product's first impression, and the thing it is
 * optimising is not elegance — it is *time to first paid request*. Every step
 * that could be inferred is inferred, every step that must be a decision is
 * one question, and the last thing it prints is the code to paste.
 *
 * It creates real things (an organization, a project, an endpoint, a key), so
 * it is written to be safe to run twice: existing resources are reused rather
 * than duplicated, and the only irreversible act — minting a key — is the one
 * thing it tells you about loudly.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface InitOptions {
  readonly cwd: string;
  readonly apiUrl: string;
  readonly path: string;
  readonly method: string;
  readonly price: string;
  readonly asset: string;
  readonly name: string;
  readonly email: string;
  readonly fetch?: typeof fetch;
}

export interface InitResult {
  readonly exitCode: number;
  readonly config?: ProjectConfig;
}

export async function init(options: InitOptions): Promise<InitResult> {
  const api = new ManagementApi({
    baseUrl: options.apiUrl,
    token: null,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  heading('Setting up Meter402');

  /*
   * A session first. In development this is the dev-session route; in a real
   * deployment it will be a browser login. Either way the CLI holds a human
   * token only for the duration of setup — the thing it leaves behind on disk
   * is a project-scoped API key, not a credential that can create projects.
   */
  const session = await api.request<{ data: { token: string; userId: string } }>(
    'POST',
    '/v1/dev/sessions',
    { email: options.email },
  );
  const token = api.data<{ token: string }>(session).token;
  line(`${PASS} signed in as ${cyan(options.email)}`);

  const organizationId = await ensureOrganization(api, token, options.name);
  line(`${PASS} organization ${dim(organizationId)}`);

  const projectId = await ensureProject(api, token, organizationId, options.name);
  line(`${PASS} project ${dim(projectId)}`);

  const endpoint = await ensureEndpoint(api, token, projectId, options);
  line(
    `${PASS} endpoint ${cyan(`${options.method.toUpperCase()} ${options.path}`)} ` +
      `at ${bold(`${options.price} ${options.asset}`)}`,
  );

  /*
   * The key. Minted only if there is not already one on disk, because every
   * `init` that mints a fresh key leaves the previous one live and unaccounted
   * for — a slow leak of valid credentials across a team.
   */
  const existingKey = readApiKey(options.cwd);
  let apiKey = existingKey;

  if (existingKey) {
    line(`${PASS} using the existing ${API_KEY_VAR} (${dim(maskKey(existingKey))})`);
  } else {
    const created = await api.request(
      'POST',
      `/v1/projects/${projectId}/api-keys`,
      {
        name: 'Local development',
        environment: 'TEST',
        scopes: ['payments:read', 'payments:write', 'endpoints:read'],
      },
      token,
    );
    apiKey = api.data<{ secret: string }>(created).secret;

    if (!envFileIsIgnored(options.cwd)) {
      /*
       * Refused rather than written. "Your API key is in git history, here is
       * how to rotate it" is a much worse message than this one, and by then
       * the key is in every clone and every fork.
       */
      line();
      line(`${WARN} ${bold(`${ENV_FILE} is not in .gitignore, so the key was not written.`)}`);
      line(`  Add ${cyan(ENV_FILE)} to .gitignore, then set it yourself:`);
      line();
      line(`    ${API_KEY_VAR}=${maskKey(apiKey)}   ${dim('(shown once, in full below)')}`);
      line();
      line(`  ${apiKey}`);
      line();
    } else {
      writeApiKey(options.cwd, apiKey);
      line(`${PASS} TEST key written to ${cyan(ENV_FILE)} (${dim(maskKey(apiKey))})`);
    }
  }

  const config: ProjectConfig = {
    apiUrl: options.apiUrl,
    organizationId,
    projectId,
    environment: 'TEST',
    endpoints: [
      {
        path: options.path,
        method: options.method.toUpperCase(),
        price: options.price,
        asset: options.asset,
      },
    ],
  };
  writeConfig(options.cwd, config);
  line(`${PASS} wrote ${cyan(CONFIG_FILE)} ${dim('(identifiers only, safe to commit)')}`);

  printIntegration(options, endpoint.id);
  return { exitCode: 0, config };
}

async function ensureOrganization(
  api: ManagementApi,
  token: string,
  name: string,
): Promise<string> {
  const existing = await api.request('GET', '/v1/organizations', undefined, token);
  const organizations = api.data<Array<{ id: string; name: string }>>(existing) ?? [];
  const found = organizations[0];
  if (found) return found.id;

  const created = await api.request('POST', '/v1/organizations', { name }, token);
  return api.data<{ id: string }>(created).id;
}

async function ensureProject(
  api: ManagementApi,
  token: string,
  organizationId: string,
  name: string,
): Promise<string> {
  const existing = await api.request(
    'GET',
    `/v1/projects?organizationId=${encodeURIComponent(organizationId)}`,
    undefined,
    token,
  );
  const projects = api.data<Array<{ id: string }>>(existing) ?? [];
  const found = projects[0];
  if (found) return found.id;

  const created = await api.request('POST', '/v1/projects', { organizationId, name }, token);
  return api.data<{ id: string }>(created).id;
}

async function ensureEndpoint(
  api: ManagementApi,
  token: string,
  projectId: string,
  options: InitOptions,
): Promise<{ id: string }> {
  const method = options.method.toUpperCase();

  try {
    const created = await api.request(
      'POST',
      '/v1/endpoints',
      {
        projectId,
        name: `${method} ${options.path}`,
        path: options.path,
        method,
        environment: 'TEST',
        price: { amount: options.price, asset: options.asset },
        settlementProtocol: 'test',
      },
      token,
    );
    return { id: api.data<{ id: string }>(created).id };
  } catch (error) {
    /*
     * Already registered. Reused rather than treated as a failure — running
     * `init` twice is a normal thing to do, and the second run should
     * converge on the same setup rather than refuse.
     */
    if (!(error instanceof ApiError) || error.status !== 409) throw error;

    const listed = await api.request(
      'GET',
      `/v1/endpoints?projectId=${encodeURIComponent(projectId)}`,
      undefined,
      token,
    );
    const endpoints = api.data<Array<{ id: string; path: string; method: string }>>(listed) ?? [];
    const match = endpoints.find(
      (endpoint) => endpoint.method === method && endpoint.path === options.path,
    );
    if (match) return { id: match.id };
    throw error;
  }
}

/** The last thing printed: the code to paste, and the command to prove it works. */
function printIntegration(options: InitOptions, endpointId: string): void {
  const method = options.method.toLowerCase();

  heading('Add this to your app');
  line();
  line(`  ${dim("import { createMeter402 } from '@meter402/sdk';")}`);
  line(`  ${dim("import { protect } from '@meter402/sdk/express';")}`);
  line();
  line(`  ${dim('const meter = createMeter402({')}`);
  line(`  ${dim(`  apiKey: process.env.${API_KEY_VAR}!,`)}`);
  line(`  ${dim(`  baseUrl: '${options.apiUrl}',`)}`);
  line(`  ${dim('});')}`);
  line();
  line(
    `  app.${method}('${options.path}', protect(meter, { price: '${options.price}' }), handler);`,
  );
  line();

  heading('Then');
  line(`  ${cyan('meter402 doctor')}        ${dim('check the setup end to end')}`);
  line(`  ${cyan(`curl -X ${options.method.toUpperCase()} localhost:3000${options.path}`)}`);
  line(`  ${dim('  → 402 Payment Required')}`);
  line(`  ${cyan('meter402 test-payment <payment-request-id>')}`);
  line(`  ${dim('  → pay it, then retry the request with the proof')}`);
  line();
  line(dim(`  endpoint ${endpointId}`));
  line();
}
