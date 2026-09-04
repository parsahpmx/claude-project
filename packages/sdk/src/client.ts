import { Meter402SdkError } from './errors.js';
import type { AuthorizationResult, Meter402Options } from './types.js';

/**
 * The transport.
 *
 * One HTTP call, one decision. Everything above this file is framework glue;
 * everything below it is Meter402's problem.
 *
 * Two rules shape it:
 *
 *  1. **Never retry an authorization automatically.** An authorization can
 *     spend a payment, and a retry that races the original is how one payment
 *     buys two requests. Meter402 is idempotent about this and would refuse
 *     the second — but a client that relies on the server refusing it is one
 *     server change away from being wrong. Transport failures are surfaced,
 *     not papered over.
 *  2. **Never let a credential into an error.** Errors from here are shown to
 *     developers, logged, and pasted into issues.
 */

const DEFAULT_BASE_URL = 'https://api.meter402.com';
const DEFAULT_TIMEOUT_MS = 10_000;

/** The default headers we look for. Case-insensitive on the way out. */
const PAYMENT_HEADERS = ['meter402-payment', 'payment-signature', 'x-payment'] as const;

export interface AuthorizeInput {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** An endpoint as `/v1/endpoints` reports it. */
export interface RegisteredEndpoint {
  readonly id: string;
  readonly path: string;
  readonly method: string;
  readonly status: string;
  readonly price: {
    readonly amountMinorUnits: string;
    readonly asset: string;
    readonly decimals: number;
  } | null;
}

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly requestId?: string;
  };
}

export class Meter402Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Meter402Options) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Meter402SdkError(
        'configuration',
        'No Meter402 API key. Set METER402_API_KEY, or pass `apiKey` to createMeter402().',
      );
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== 'function') {
      throw new Meter402SdkError(
        'configuration',
        'No fetch implementation available. Use Node 18+, or pass `fetch` to createMeter402().',
      );
    }
  }

  /**
   * Ask whether one inbound request may proceed.
   *
   * Only the payment-bearing headers are forwarded. Forwarding everything
   * would send the merchant's own cookies, authorization headers and customer
   * identifiers to us for no reason — this SDK sits in the authorization path
   * and has no business seeing the data path.
   */
  async authorize(input: AuthorizeInput): Promise<AuthorizationResult> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers)) {
      const lower = name.toLowerCase();
      if (!PAYMENT_HEADERS.includes(lower as (typeof PAYMENT_HEADERS)[number])) continue;
      const single = Array.isArray(value) ? value[0] : value;
      if (typeof single === 'string') headers[lower] = single;
    }

    const body = await this.post('/v1/authorize', {
      method: input.method.toUpperCase(),
      path: input.path,
      headers,
    });

    const data = (body as { data?: unknown }).data;
    if (!isAuthorizationResult(data)) {
      throw new Meter402SdkError(
        'unavailable',
        'Meter402 returned an authorization response this SDK does not understand. ' +
          'This usually means the SDK is older than the API; try upgrading @meter402/sdk.',
      );
    }
    return data;
  }

  /** Whoami, for `meter402 doctor` and for startup validation. */
  async describeCredential(): Promise<{
    organizationId: string;
    projectId: string;
    environment: string;
    scopes: readonly string[];
  }> {
    const body = await this.get('/v1/me');
    const data = (body as { data?: Record<string, unknown> }).data ?? {};
    const credential = (data['apiKey'] ?? data) as Record<string, unknown>;
    return {
      organizationId: String(credential['organizationId'] ?? ''),
      projectId: String(credential['projectId'] ?? ''),
      environment: String(credential['environment'] ?? ''),
      scopes: Array.isArray(credential['scopes']) ? (credential['scopes'] as string[]) : [],
    };
  }

  /** The endpoints this credential's project has, for price verification. */
  async listEndpoints(): Promise<readonly RegisteredEndpoint[]> {
    const body = await this.get('/v1/endpoints');
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    return data.filter(isRegisteredEndpoint);
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path, { method: 'GET' });
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });
    } catch (cause) {
      /*
       * A network failure, a DNS failure, or our own timeout. All the same to
       * a merchant: Meter402 is not answering, so this request cannot be
       * authorized right now.
       */
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new Meter402SdkError(
        'unavailable',
        aborted
          ? `Meter402 did not respond within ${this.timeoutMs}ms.`
          : 'Could not reach Meter402.',
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (response.ok) return parsed;

    const envelope = (parsed ?? {}) as ErrorEnvelope;
    const code = envelope.error?.code ?? null;
    const requestId = envelope.error?.requestId ?? null;
    const message = envelope.error?.message ?? `Meter402 returned ${response.status}.`;

    if (response.status >= 500 || response.status === 429) {
      throw new Meter402SdkError('unavailable', message, { code, requestId });
    }
    if (response.status === 401 || response.status === 403) {
      throw new Meter402SdkError('authentication', message, { code, requestId });
    }
    if (response.status === 404 && code === 'ENDPOINT_NOT_FOUND') {
      throw new Meter402SdkError(
        'configuration',
        `${message} Register it with \`meter402 endpoints create\`, or check that the ` +
          `path and method match what you registered.`,
        { code, requestId },
      );
    }
    throw new Meter402SdkError('rejected', message, { code, requestId });
  }
}

/**
 * Validated rather than cast.
 *
 * A row that does not carry what we need is dropped, so a future API change
 * that renames a field degrades to "endpoint not found" — a message a
 * developer can act on — rather than to a crash inside price comparison.
 */
function isRegisteredEndpoint(value: unknown): value is RegisteredEndpoint {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['path'] === 'string' &&
    typeof row['method'] === 'string' &&
    typeof row['status'] === 'string'
  );
}

function isAuthorizationResult(value: unknown): value is AuthorizationResult {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = (value as { outcome?: unknown }).outcome;
  if (outcome === 'PAYMENT_REQUIRED') {
    const respondWith = (value as { respondWith?: { status?: unknown } }).respondWith;
    return typeof respondWith?.status === 'number';
  }
  if (outcome === 'AUTHORIZED') {
    return typeof (value as { payment?: { id?: unknown } }).payment?.id === 'string';
  }
  return false;
}
