/**
 * Error taxonomy.
 *
 * Every error the API returns is one of these codes, wrapped in the envelope
 * defined by product rule 61. Two properties matter more than the specific
 * list:
 *
 *  1. The code is stable and machine-readable. An agent decides whether to
 *     retry, re-pay, or give up by branching on `code` — never by string
 *     matching on `message`. So codes are append-only; renaming one is a
 *     breaking API change.
 *
 *  2. Messages are safe to show to the caller. Anything that would leak
 *     internal state, another tenant's data, or a stack trace goes to the log
 *     under the request ID, and the caller gets INTERNAL_ERROR. `toPublicError`
 *     enforces that: unknown throwables never reach a client body.
 */

export const DOCS_BASE_URL = 'https://docs.meter402.com';

interface ErrorDefinition {
  readonly status: number;
  readonly defaultMessage: string;
  /**
   * Whether an identical retry could plausibly succeed later. Drives both the
   * `Retry-After` hint we send and the agent-side retry guidance in the docs.
   */
  readonly retryable: boolean;
}

export const ERROR_DEFINITIONS = {
  AUTHENTICATION_REQUIRED: {
    status: 401,
    defaultMessage: 'Authentication is required to access this resource.',
    retryable: false,
  },
  INVALID_API_KEY: {
    status: 401,
    defaultMessage: 'The provided API key is not valid.',
    retryable: false,
  },
  API_KEY_REVOKED: {
    status: 401,
    defaultMessage: 'The provided API key has been revoked.',
    retryable: false,
  },
  API_KEY_EXPIRED: {
    status: 401,
    defaultMessage: 'The provided API key has expired.',
    retryable: false,
  },
  PERMISSION_DENIED: {
    status: 403,
    defaultMessage: 'You do not have permission to perform this action.',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested resource does not exist.',
    retryable: false,
  },
  VALIDATION_FAILED: {
    status: 422,
    defaultMessage: 'The request payload failed validation.',
    retryable: false,
  },
  PAYMENT_REQUIRED: {
    status: 402,
    defaultMessage: 'Payment is required to access this resource.',
    retryable: true,
  },
  PAYMENT_EXPIRED: {
    status: 402,
    defaultMessage: 'The payment request has expired. Request a new challenge.',
    retryable: true,
  },
  PAYMENT_INVALID: {
    status: 402,
    defaultMessage: 'The supplied payment proof could not be validated.',
    retryable: false,
  },
  PAYMENT_NOT_CONFIRMED: {
    status: 402,
    defaultMessage: 'The payment has not reached the required number of confirmations yet.',
    retryable: true,
  },
  PAYMENT_ALREADY_USED: {
    status: 409,
    defaultMessage: 'This blockchain transaction has already settled another payment request.',
    retryable: false,
  },
  WRONG_NETWORK: {
    status: 402,
    defaultMessage: 'The payment was made on a different network than the one requested.',
    retryable: false,
  },
  WRONG_ASSET: {
    status: 402,
    defaultMessage: 'The payment was made in a different asset than the one requested.',
    retryable: false,
  },
  WRONG_AMOUNT: {
    status: 402,
    defaultMessage: 'The payment amount does not satisfy the payment request.',
    retryable: false,
  },
  WRONG_RECIPIENT: {
    status: 402,
    defaultMessage: 'The payment was sent to a different address than the one requested.',
    retryable: false,
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    defaultMessage:
      'This Idempotency-Key was already used with a different request body. ' +
      'Use a new key for a new request.',
    retryable: false,
  },
  IDEMPOTENCY_REQUEST_IN_FLIGHT: {
    status: 409,
    defaultMessage: 'A request with this Idempotency-Key is still in progress.',
    retryable: true,
  },
  CONFLICT: {
    status: 409,
    defaultMessage: 'The request conflicts with the current state of the resource.',
    retryable: false,
  },
  INVALID_STATE_TRANSITION: {
    status: 409,
    defaultMessage: 'The requested state transition is not permitted.',
    retryable: false,
  },
  POLICY_VIOLATION: {
    status: 403,
    defaultMessage: 'The request was rejected by a merchant policy.',
    retryable: false,
  },
  RISK_DENIED: {
    status: 403,
    defaultMessage: 'The request was denied by the risk engine.',
    retryable: false,
  },
  INVALID_CREDENTIALS: {
    status: 401,
    defaultMessage: 'The supplied credentials are not valid.',
    retryable: false,
  },
  MEMBERSHIP_INACTIVE: {
    status: 403,
    defaultMessage: 'Your membership of this organization is not active.',
    retryable: false,
  },
  ENVIRONMENT_MISMATCH: {
    status: 403,
    defaultMessage: 'This credential cannot be used in the requested environment.',
    retryable: false,
  },
  ORGANIZATION_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested organization does not exist.',
    retryable: false,
  },
  PROJECT_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested project does not exist.',
    retryable: false,
  },
  MEMBERSHIP_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested membership does not exist.',
    retryable: false,
  },
  API_KEY_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested API key does not exist.',
    retryable: false,
  },
  LAST_OWNER_REQUIRED: {
    status: 409,
    defaultMessage: 'An organization must always have at least one active owner.',
    retryable: false,
  },
  INVALID_ROLE: {
    status: 422,
    defaultMessage: 'The supplied role is not recognised.',
    retryable: false,
  },
  INVALID_SCOPE: {
    status: 422,
    defaultMessage: 'The supplied API key scope is not recognised.',
    retryable: false,
  },
  ENDPOINT_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested endpoint does not exist.',
    retryable: false,
  },
  ENDPOINT_DISABLED: {
    status: 409,
    defaultMessage: 'This endpoint is not accepting payments.',
    retryable: false,
  },
  PRICING_RULE_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested pricing rule does not exist.',
    retryable: false,
  },
  INVALID_PRICE: {
    status: 422,
    defaultMessage: 'The supplied price is not valid for this asset.',
    retryable: false,
  },
  PAYMENT_REQUEST_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested payment request does not exist.',
    retryable: false,
  },
  RECEIPT_NOT_FOUND: {
    status: 404,
    defaultMessage: 'The requested receipt does not exist.',
    retryable: false,
  },
  PAYMENT_ALREADY_CONFIRMED: {
    status: 409,
    defaultMessage: 'This payment request has already been paid.',
    retryable: false,
  },
  PAYMENT_ENDPOINT_MISMATCH: {
    status: 403,
    defaultMessage: 'This payment does not authorize the requested resource.',
    retryable: false,
  },
  TEST_LIVE_MISMATCH: {
    status: 403,
    defaultMessage: 'The credential and the resource belong to different environments.',
    retryable: false,
  },
  SIMULATOR_LIVE_FORBIDDEN: {
    status: 403,
    defaultMessage: 'The TEST payment simulator cannot operate on LIVE resources.',
    retryable: false,
  },
  /**
   * LIVE settlement is not implemented yet.
   *
   * A merchant can configure a LIVE endpoint and a LIVE payment request can be
   * priced, but no code path in this release can verify a real on-chain
   * settlement, so a LIVE challenge would be one no agent could satisfy.
   * Refusing plainly is better than issuing an unanswerable 402.
   */
  /**
   * No settlement destination is configured for the network and asset a real
   * payment would settle in.
   *
   * A distinct code rather than a generic conflict, because the fix is
   * specific and the merchant needs to be told exactly what to do: configure a
   * destination. There is deliberately no default for real settlement — a
   * fallback address would mean a payment that succeeds and destroys the
   * money.
   */
  SETTLEMENT_NOT_CONFIGURED: {
    status: 409,
    defaultMessage: 'No settlement destination is configured for this network and asset.',
    retryable: false,
  },
  LIVE_SETTLEMENT_UNAVAILABLE: {
    status: 503,
    defaultMessage:
      'LIVE settlement is not available in this release. Use a TEST endpoint and TEST credentials.',
    retryable: false,
  },
  RATE_LIMITED: {
    status: 429,
    defaultMessage: 'Too many requests. Slow down and retry later.',
    retryable: true,
  },
  UPSTREAM_UNAVAILABLE: {
    status: 503,
    defaultMessage: 'A required upstream dependency is temporarily unavailable.',
    retryable: true,
  },
  INTERNAL_ERROR: {
    status: 500,
    defaultMessage: 'An unexpected internal error occurred.',
    retryable: true,
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly documentationUrl: string;
    readonly details?: Record<string, unknown>;
  };
}

export interface Meter402ErrorOptions {
  /** Caller-safe structured context, e.g. which field failed validation. */
  readonly details?: Record<string, unknown>;
  /** Internal cause. Logged, never serialised to the client. */
  readonly cause?: unknown;
  /**
   * Override the HTTP status while keeping the code.
   *
   * The mapping is deliberately not one-to-one. Clients branch on `code`, so
   * that must stay stable; the HTTP status carries transport-level meaning
   * that can be more specific. A body over the size limit and a malformed
   * JSON document are both VALIDATION_FAILED to a client, but flattening 413
   * and 400 into 422 would discard information every HTTP intermediary
   * understands.
   *
   * Restricted to the 4xx range: an override must never be able to dress a
   * server fault up as a client error and hide it from error-rate alerting.
   */
  readonly httpStatus?: number;
}

export class Meter402Error extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, options: Meter402ErrorOptions = {}) {
    const definition = ERROR_DEFINITIONS[code];
    super(message ?? definition.defaultMessage, { cause: options.cause });
    this.name = 'Meter402Error';
    this.code = code;
    const override = options.httpStatus;
    this.httpStatus =
      override !== undefined && override >= 400 && override < 500 ? override : definition.status;
    this.retryable = definition.retryable;
    this.details = options.details;
  }

  get documentationUrl(): string {
    return `${DOCS_BASE_URL}/errors/${this.code.toLowerCase()}`;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        documentationUrl: this.documentationUrl,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isMeter402Error(value: unknown): value is Meter402Error {
  return value instanceof Meter402Error;
}

/**
 * Coerce anything thrown into a client-safe error.
 *
 * The default branch deliberately discards the original message. An unexpected
 * throwable can carry a connection string, a row from another tenant, or a
 * file path; none of that belongs in an HTTP response body. The caller is
 * expected to log the original under the same request ID.
 */
export function toPublicError(value: unknown): Meter402Error {
  if (isMeter402Error(value)) {
    return value;
  }
  return new Meter402Error('INTERNAL_ERROR', undefined, { cause: value });
}

/* --- Convenience constructors for the most common cases ------------------ */

export function notFound(resource: string, id?: string): Meter402Error {
  return new Meter402Error('RESOURCE_NOT_FOUND', `${resource} not found.`, {
    details: id ? { resource, id } : { resource },
  });
}

export function validationFailed(message: string, issues?: Record<string, unknown>): Meter402Error {
  return new Meter402Error('VALIDATION_FAILED', message, {
    ...(issues ? { details: issues } : {}),
  });
}

export function permissionDenied(action: string): Meter402Error {
  return new Meter402Error('PERMISSION_DENIED', `You do not have permission to ${action}.`, {
    details: { action },
  });
}
