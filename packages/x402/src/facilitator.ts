import { err, ok, type Result } from '@meter402/shared';
import { X402_VERSION } from './constants.js';
import type {
  X402PaymentPayload,
  X402PaymentRequirements,
  X402SettleResponse,
  X402SupportedResponse,
  X402VerifyResponse,
} from './wire.js';

/**
 * The facilitator client.
 *
 * A facilitator is the party that checks an authorization against chain state
 * and, later, submits the transaction that moves the money. Meter402 does not
 * hold payer keys, so it cannot settle by itself — which is the point, and is
 * what keeps this product non-custodial.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The governing assumption: **a facilitator is untrusted external
 * infrastructure.** Not malicious by default, but not part of our trust
 * boundary either. Concretely that means:
 *
 *  - HTTP 200 is not a payment. `isValid` and `success` are read from a
 *    validated body; a 200 carrying garbage is a protocol error, not a
 *    payment, and certainly not an authorization to serve a resource.
 *  - A facilitator that says "valid" cannot override our own binding checks,
 *    which have already run by the time we call it.
 *  - Its response is parsed into our types before anything reads it, so a
 *    field we did not expect cannot flow into the domain.
 *
 * The uncertainty rule from Phase 0 also applies here and is the reason
 * `FacilitatorUnavailable` is a distinct outcome rather than a failure: a
 * facilitator that times out has told us **nothing** about whether money
 * moved. Treating that as a failed payment would be a lie in the dangerous
 * direction — it could mark a settled payment as failed and serve nothing
 * while the payer is out of pocket.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface FacilitatorRequest {
  readonly paymentPayload: X402PaymentPayload;
  readonly paymentRequirements: X402PaymentRequirements;
}

/** Why a facilitator call did not produce a usable answer. */
export type FacilitatorErrorKind =
  /** Reached it, but the body was not a valid response. Do not retry blindly. */
  | 'MALFORMED_RESPONSE'
  /** Could not reach it, or it timed out. Outcome genuinely unknown. */
  | 'UNAVAILABLE'
  /** It rejected our request as malformed or unauthorized. Our bug. */
  | 'REJECTED';

export interface FacilitatorError {
  readonly kind: FacilitatorErrorKind;
  readonly message: string;
  readonly status?: number;
}

export interface FacilitatorClient {
  /** Check an authorization. Never settles, never moves money. */
  verify(request: FacilitatorRequest): Promise<Result<X402VerifyResponse, FacilitatorError>>;
  /** Submit the settlement. May move money — see the retry note below. */
  settle(request: FacilitatorRequest): Promise<Result<X402SettleResponse, FacilitatorError>>;
  /** What the facilitator claims to support. */
  getSupportedCapabilities(): Promise<Result<X402SupportedResponse, FacilitatorError>>;
  /** Cheap liveness probe for readiness reporting. */
  health(): Promise<boolean>;
}

function facilitatorError(
  kind: FacilitatorErrorKind,
  message: string,
  status?: number,
): FacilitatorError {
  return { kind, message, ...(status !== undefined ? { status } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a `/verify` response. Shape first, meaning second. */
export function parseVerifyResponse(body: unknown): Result<X402VerifyResponse, FacilitatorError> {
  if (!isRecord(body)) {
    return err(facilitatorError('MALFORMED_RESPONSE', 'Verify response is not an object.'));
  }
  const isValid = body['isValid'];
  if (typeof isValid !== 'boolean') {
    // Absent or non-boolean `isValid` is refused rather than coerced. A
    // truthiness check here would read the string "false" as a valid payment.
    return err(facilitatorError('MALFORMED_RESPONSE', 'Verify response has no boolean `isValid`.'));
  }

  const payer = body['payer'];
  const invalidReason = body['invalidReason'];
  const invalidMessage = body['invalidMessage'];

  return ok({
    isValid,
    ...(typeof payer === 'string' ? { payer } : {}),
    ...(typeof invalidReason === 'string' ? { invalidReason } : {}),
    ...(typeof invalidMessage === 'string' ? { invalidMessage } : {}),
  });
}

/** A settlement transaction hash: 32 bytes of hex. */
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Validate a `/settle` response.
 *
 * A successful settlement MUST carry a well-formed transaction hash. Without
 * one there is nothing to record, nothing to verify on-chain, and nothing for
 * the transaction-replay guard to claim — so `success: true` with a missing or
 * malformed `transaction` is treated as malformed rather than believed.
 */
export function parseSettleResponse(body: unknown): Result<X402SettleResponse, FacilitatorError> {
  if (!isRecord(body)) {
    return err(facilitatorError('MALFORMED_RESPONSE', 'Settle response is not an object.'));
  }
  const success = body['success'];
  if (typeof success !== 'boolean') {
    return err(facilitatorError('MALFORMED_RESPONSE', 'Settle response has no boolean `success`.'));
  }

  const network = body['network'];
  if (typeof network !== 'string') {
    return err(facilitatorError('MALFORMED_RESPONSE', 'Settle response has no `network`.'));
  }

  const transaction = body['transaction'];
  if (success) {
    if (typeof transaction !== 'string' || !TX_HASH.test(transaction)) {
      return err(
        facilitatorError(
          'MALFORMED_RESPONSE',
          'Settle response reports success without a well-formed transaction hash.',
        ),
      );
    }
  }

  const payer = body['payer'];
  const amount = body['amount'];
  const errorReason = body['errorReason'];
  const errorMessage = body['errorMessage'];

  return ok({
    success,
    transaction: typeof transaction === 'string' ? transaction : '',
    network: network as `${string}:${string}`,
    ...(typeof payer === 'string' ? { payer } : {}),
    ...(typeof amount === 'string' ? { amount } : {}),
    ...(typeof errorReason === 'string' ? { errorReason } : {}),
    ...(typeof errorMessage === 'string' ? { errorMessage } : {}),
  });
}

export interface HttpFacilitatorOptions {
  readonly baseUrl: string;
  readonly apiKey?: string | null;
  readonly timeoutMs: number;
  /** Injected for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * An HTTP facilitator.
 *
 * ── On retries ───────────────────────────────────────────────────────────
 * `verify` is side-effect free and safe to retry. `settle` is **not**: it may
 * already have broadcast a transaction, and a blind retry is how a payer gets
 * charged twice. So this client does not retry `settle` at all. A settle whose
 * outcome is unknown returns `UNAVAILABLE`, and the caller resolves that to a
 * PENDING payment for reconciliation rather than to a failure or a second
 * attempt. Recovering an uncertain settlement is a deliberate operation, not
 * something a client library should do on a timer.
 */
export class HttpFacilitatorClient implements FacilitatorClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpFacilitatorOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async post(path: string, body: unknown): Promise<Result<unknown, FacilitatorError>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(new URL(path, this.options.baseUrl).toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        // Server-side trouble: the outcome is unknown, not negative.
        return err(
          facilitatorError('UNAVAILABLE', 'Facilitator returned a server error.', response.status),
        );
      }
      if (!response.ok) {
        return err(
          facilitatorError('REJECTED', 'Facilitator rejected the request.', response.status),
        );
      }

      const parsed: unknown = await response.json();
      return ok(parsed);
    } catch (error) {
      /*
       * Network failure, DNS failure, timeout, or a body that is not JSON. In
       * every case we do not know what happened at the other end.
       */
      const message = error instanceof Error ? error.message : 'Facilitator call failed.';
      return err(facilitatorError('UNAVAILABLE', message));
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(request: FacilitatorRequest): Promise<Result<X402VerifyResponse, FacilitatorError>> {
    const response = await this.post('/verify', {
      x402Version: X402_VERSION,
      paymentPayload: request.paymentPayload,
      paymentRequirements: request.paymentRequirements,
    });
    if (!response.ok) return response;
    return parseVerifyResponse(response.value);
  }

  async settle(request: FacilitatorRequest): Promise<Result<X402SettleResponse, FacilitatorError>> {
    const response = await this.post('/settle', {
      x402Version: X402_VERSION,
      paymentPayload: request.paymentPayload,
      paymentRequirements: request.paymentRequirements,
    });
    if (!response.ok) return response;
    return parseSettleResponse(response.value);
  }

  async getSupportedCapabilities(): Promise<Result<X402SupportedResponse, FacilitatorError>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(
        new URL('/supported', this.options.baseUrl).toString(),
        {
          headers: {
            accept: 'application/json',
            ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        return err(
          facilitatorError('UNAVAILABLE', 'Facilitator /supported failed.', response.status),
        );
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body['kinds'])) {
        return err(
          facilitatorError('MALFORMED_RESPONSE', 'Supported response has no `kinds` array.'),
        );
      }
      return ok(body as unknown as X402SupportedResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Facilitator call failed.';
      return err(facilitatorError('UNAVAILABLE', message));
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    const supported = await this.getSupportedCapabilities();
    return supported.ok;
  }
}
