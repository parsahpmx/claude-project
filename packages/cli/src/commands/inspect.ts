import { ManagementApi } from '../api.js';
import { maskKey, readApiKey, readConfig } from '../config.js';
import { PASS, bold, cyan, dim, errorLine, heading, line, table } from '../output.js';

/**
 * The read-only commands: whoami, endpoints, payments, receipts.
 *
 * These exist for the moment after something went wrong, when a developer
 * needs to know what Meter402 actually recorded rather than what they expected
 * it to. They print facts and nothing else — no advice, no secrets.
 */

export interface InspectOptions {
  readonly cwd: string;
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
  readonly limit?: number;
}

function connect(options: InspectOptions): { api: ManagementApi; apiKey: string } | null {
  const config = readConfig(options.cwd);
  const apiKey = readApiKey(options.cwd);
  const baseUrl = options.apiUrl ?? config?.apiUrl;

  if (!apiKey || !baseUrl) {
    errorLine('Not configured. Run `meter402 init` first, or set METER402_API_KEY.');
    return null;
  }

  return {
    apiKey,
    api: new ManagementApi({
      baseUrl,
      token: apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
  };
}

export async function whoami(options: InspectOptions): Promise<number> {
  const connection = connect(options);
  if (!connection) return 1;

  const me = await connection.api.request('GET', '/v1/me');
  const data = connection.api.data<Record<string, unknown>>(me);
  const credential = (data['apiKey'] ?? data) as Record<string, unknown>;

  heading('Credential');
  line();
  line(`  key           ${dim(maskKey(connection.apiKey))}`);
  line(`  organization  ${String(credential['organizationId'] ?? '—')}`);
  line(`  project       ${String(credential['projectId'] ?? '—')}`);
  line(`  environment   ${bold(String(credential['environment'] ?? '—'))}`);
  line(
    `  scopes        ${
      Array.isArray(credential['scopes']) ? (credential['scopes'] as string[]).join(', ') : '—'
    }`,
  );
  line(`  api           ${connection.api.baseUrl}`);
  line();
  return 0;
}

export async function listEndpoints(options: InspectOptions): Promise<number> {
  const connection = connect(options);
  if (!connection) return 1;

  const listed = await connection.api.request('GET', '/v1/endpoints');
  const endpoints =
    connection.api.data<
      Array<{
        id: string;
        path: string;
        method: string;
        status: string;
        environment: string;
        settlementProtocol?: string;
        price: { amount: string; asset: string; decimals: number } | null;
      }>
    >(listed) ?? [];

  heading('Endpoints');
  line();
  if (endpoints.length === 0) {
    line(dim('  None. Create one with `meter402 init`.'));
    line();
    return 0;
  }

  table([
    ['METHOD', 'PATH', 'PRICE', 'ENV', 'STATUS', 'ID'],
    ...endpoints.map((endpoint) => [
      endpoint.method,
      endpoint.path,
      endpoint.price ? `${endpoint.price.amount} ${endpoint.price.asset}` : dim('none'),
      endpoint.environment,
      endpoint.status,
      dim(endpoint.id),
    ]),
  ]);
  line();
  return 0;
}

export async function listPayments(options: InspectOptions): Promise<number> {
  const connection = connect(options);
  if (!connection) return 1;

  const config = readConfig(options.cwd);
  if (!config?.projectId) {
    errorLine('No project in .meter402.json. Run `meter402 init`.');
    return 1;
  }

  const listed = await connection.api.request(
    'GET',
    `/v1/payments?projectId=${encodeURIComponent(config.projectId)}&limit=${options.limit ?? 20}`,
  );
  const payments =
    connection.api.data<
      Array<{
        id: string;
        status: string;
        amountMinorUnits?: string;
        asset?: string;
        simulated?: boolean;
        createdAt?: string;
      }>
    >(listed) ?? [];

  heading('Payments');
  line();
  if (payments.length === 0) {
    line(dim('  None yet. Trigger a 402 and run `meter402 test-payment`.'));
    line();
    return 0;
  }

  table([
    ['ID', 'STATUS', 'AMOUNT', 'SIMULATED', 'CREATED'],
    ...payments.map((payment) => [
      payment.id,
      payment.status,
      payment.amountMinorUnits ? `${payment.amountMinorUnits} ${payment.asset ?? ''}`.trim() : '—',
      payment.simulated === true ? 'yes' : 'no',
      payment.createdAt ?? '—',
    ]),
  ]);
  line();
  return 0;
}

export async function listReceipts(options: InspectOptions): Promise<number> {
  const connection = connect(options);
  if (!connection) return 1;

  const config = readConfig(options.cwd);
  if (!config?.projectId) {
    errorLine('No project in .meter402.json. Run `meter402 init`.');
    return 1;
  }

  const listed = await connection.api.request(
    'GET',
    `/v1/receipts?projectId=${encodeURIComponent(config.projectId)}&limit=${options.limit ?? 20}`,
  );
  const receipts =
    connection.api.data<Array<{ id: string; paymentId: string; issuedAt?: string }>>(listed) ?? [];

  heading('Receipts');
  line();
  if (receipts.length === 0) {
    line(dim('  None yet.'));
    line();
    return 0;
  }

  table([
    ['ID', 'PAYMENT', 'ISSUED'],
    ...receipts.map((receipt) => [receipt.id, receipt.paymentId, receipt.issuedAt ?? '—']),
  ]);
  line();
  return 0;
}

/**
 * `meter402 test-payment <payment-request-id>` — pay a challenge, in TEST.
 *
 * Refuses anything but a TEST credential, before contacting the server. The
 * server refuses too — the simulator has four independent guards — but a CLI
 * that would happily *try* to spend real money on a developer's behalf is one
 * server bug away from doing it.
 */
export async function testPayment(
  options: InspectOptions & { paymentRequestId: string },
): Promise<number> {
  const connection = connect(options);
  if (!connection) return 1;

  const me = await connection.api.request('GET', '/v1/me');
  const data = connection.api.data<Record<string, unknown>>(me);
  const credential = (data['apiKey'] ?? data) as Record<string, unknown>;
  const environment = String(credential['environment'] ?? '');

  if (environment !== 'TEST') {
    errorLine('');
    errorLine(`  This is a ${bold(environment)} credential.`);
    errorLine('  `test-payment` drives the simulator and will not touch a LIVE request.');
    errorLine('');
    return 1;
  }

  const completed = await connection.api.request(
    'POST',
    `/v1/test/payment-requests/${encodeURIComponent(options.paymentRequestId)}/complete`,
    {},
  );
  const result = connection.api.data<{
    reference: string;
    created: boolean;
    payment: { id: string };
    receipt: { id: string };
  }>(completed);

  const proof = Buffer.from(
    JSON.stringify({ paymentRequestId: options.paymentRequestId, reference: result.reference }),
    'utf8',
  ).toString('base64');

  heading(result.created ? 'Paid' : 'Already paid');
  line();
  line(`  ${PASS} payment ${result.payment.id}`);
  line(`  ${PASS} receipt ${result.receipt.id}`);
  line();
  line('  Retry your request with this header:');
  line();
  line(`    ${cyan('meter402-payment')}: ${proof}`);
  line();
  line(dim('  Or, as a curl flag:'));
  line(`    ${dim(`-H 'meter402-payment: ${proof}'`)}`);
  line();
  return 0;
}
