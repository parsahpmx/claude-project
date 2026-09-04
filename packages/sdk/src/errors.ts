/**
 * Errors a merchant's code can act on.
 *
 * Deliberately few, and deliberately about *what to do*: is this my mistake,
 * is Meter402 down, or is the caller unpaid? A middleware author should be
 * able to write a sensible `catch` without reading our source.
 *
 * No error thrown from this SDK carries the API key, a payment signature, or
 * a response body that might contain either. That is enforced by construction:
 * these classes take only the fields below, and nothing copies a request into
 * them.
 */

export type Meter402ErrorKind =
  /** The SDK is misconfigured, or the endpoint is not set up. Fix and redeploy. */
  | 'configuration'
  /** Meter402 could not be reached, or returned 5xx. Transient. */
  | 'unavailable'
  /** The credential was rejected. Not transient. */
  | 'authentication'
  /** Meter402 rejected the request itself. */
  | 'rejected';

export class Meter402SdkError extends Error {
  readonly kind: Meter402ErrorKind;
  /** Meter402's machine-readable code, when one was returned. */
  readonly code: string | null;
  /** Meter402's request ID, for support. Safe to log and to show a developer. */
  readonly requestId: string | null;
  /**
   * The HTTP status Meter402 used, when this came from a response.
   *
   * Carried so a `rejected` outcome can reach the caller with the status
   * Meter402 chose. A replayed payment is a 409 about the *caller*, and
   * flattening it to 500 would tell an agent the merchant is broken when in
   * fact the agent tried to spend one payment twice.
   */
  readonly status: number | null;

  constructor(
    kind: Meter402ErrorKind,
    message: string,
    options: {
      code?: string | null;
      requestId?: string | null;
      status?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'Meter402SdkError';
    this.kind = kind;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.status = options.status ?? null;
  }

  /** Whether retrying the same call could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === 'unavailable';
  }
}

/**
 * True when an unknown value is one of ours.
 *
 * Checked by shape rather than `instanceof`, which breaks across duplicate
 * copies of the package in a dependency tree — a real situation in any app
 * with more than one framework adapter installed.
 */
export function isMeter402SdkError(value: unknown): value is Meter402SdkError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'Meter402SdkError'
  );
}
