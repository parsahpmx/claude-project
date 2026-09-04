import { Meter402SdkError } from '@meter402/sdk';

/**
 * The CLI's HTTP client.
 *
 * Separate from the SDK's because the CLI talks to the *management* surface —
 * organizations, projects, keys — which a merchant's server never touches.
 * Keeping them apart is what lets the SDK stay payment-only: a merchant's
 * production bundle should not carry code for creating projects.
 */

export interface ApiOptions {
  readonly baseUrl: string;
  /** A user session token or an API key, depending on the command. */
  readonly token: string | null;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ManagementApi {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  /**
   * One request.
   *
   * A transport failure becomes `Meter402SdkError('unavailable')` and an HTTP
   * failure becomes `ApiError`, because the CLI treats them differently: "the
   * server is not there" is usually a wrong URL or a container that has not
   * started, and "the server said no" is usually a real answer worth printing.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    tokenOverride?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    const token = tokenOverride ?? this.options.token;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new Meter402SdkError(
        'unavailable',
        aborted
          ? `${this.options.baseUrl} did not respond in time.`
          : `Could not reach Meter402 at ${this.options.baseUrl}.`,
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

    if (response.ok) return parsed as T;

    const envelope = (parsed ?? {}) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    throw new ApiError(
      response.status,
      envelope.error?.code ?? null,
      envelope.error?.message ?? `Meter402 returned ${response.status}.`,
      envelope.error?.requestId ?? null,
    );
  }

  /** Unwrap the `{ data: … }` envelope every route returns. */
  data<T>(payload: unknown): T {
    return (payload as { data: T }).data;
  }
}
