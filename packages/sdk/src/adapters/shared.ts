import { isMeter402SdkError } from '../errors.js';
import type { AuthorizationResult, Meter402Context, ProtectOptions } from '../types.js';

/**
 * The part of "protect a route" that has nothing to do with any framework.
 *
 * Every adapter is the same three steps — read the request, ask Meter402,
 * act on the answer — so they share this and differ only in how their
 * framework spells "request" and "reply".
 */

export interface ProtectDecision {
  readonly action: 'proceed' | 'respond';
  readonly context?: Meter402Context;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/**
 * What to do when Meter402 itself is unreachable.
 *
 * `closed` (the default) refuses the request. `open` serves it for free.
 *
 * The default is deliberate and worth stating: failing open means an outage on
 * our side becomes free service on yours, and an attacker who can degrade us
 * can take your API for nothing. A merchant may still choose `open` — for a
 * cheap endpoint where availability matters more than the cents — but it
 * should be a decision someone made, not a default they inherited.
 */
export type FailureMode = 'closed' | 'open';

export interface AdapterOptions extends ProtectOptions {
  readonly onUnavailable?: FailureMode;
  /**
   * Called when an authorization could not be completed. For logging; the
   * decision has already been made by `onUnavailable`.
   */
  readonly onError?: (error: unknown) => void;
}

export function decisionFrom(result: AuthorizationResult): ProtectDecision {
  if (result.outcome === 'AUTHORIZED') {
    return {
      action: 'proceed',
      context: {
        paymentRequestId: result.paymentRequestId,
        payment: result.payment,
        endpoint: result.endpoint,
      },
    };
  }

  return {
    action: 'respond',
    status: result.respondWith.status,
    headers: result.respondWith.headers,
    body: result.respondWith.body,
  };
}

/**
 * Turn a thrown error into a decision.
 *
 * A configuration or authentication problem is the merchant's to fix and is
 * never absorbed: serving requests for free because the API key is wrong
 * would hide the exact problem the merchant most needs to see. Only an
 * unavailable Meter402 is subject to `onUnavailable`.
 */
export function decisionFromError(error: unknown, mode: FailureMode): ProtectDecision {
  const unavailable = isMeter402SdkError(error) && error.kind === 'unavailable';

  if (unavailable && mode === 'open') {
    return { action: 'proceed' };
  }

  const message =
    isMeter402SdkError(error) && error.kind !== 'unavailable'
      ? 'This paid endpoint is misconfigured.'
      : 'Payment authorization is temporarily unavailable. Retry shortly.';

  return {
    action: 'respond',
    status: unavailable ? 503 : 500,
    headers: unavailable ? { 'retry-after': '5' } : {},
    body: {
      error: {
        code: unavailable ? 'PAYMENT_AUTHORIZATION_UNAVAILABLE' : 'PAYMENT_MISCONFIGURED',
        message,
      },
    },
  };
}

/** The route as registered, given what the framework saw and what was declared. */
export function resolveRoute(
  options: AdapterOptions,
  observed: { method: string; path: string },
): { method: string; path: string } {
  return {
    method: (options.method ?? observed.method).toUpperCase(),
    path: options.path ?? stripQuery(observed.path),
  };
}

function stripQuery(path: string): string {
  const index = path.indexOf('?');
  return index === -1 ? path : path.slice(0, index);
}
