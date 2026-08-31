/**
 * Payment state machine.
 *
 * Every payment moves through exactly these states, and only along the edges
 * declared in `ALLOWED_TRANSITIONS`. The table is the specification: there is
 * no other place in the codebase where a payment's status may be assigned, and
 * `assertTransition` is the only way to move one.
 *
 * Why a table rather than scattered `if` checks: the dangerous bugs in a
 * payments system are the ones where a state moves backwards. If a CONFIRMED
 * payment can return to PENDING, then a confirmed-and-served API request can
 * be re-verified, re-charged, or re-delivered. Product rule 25 calls that
 * transition out specifically, and the test suite asserts every one of the
 * 100 possible ordered pairs against this table rather than only the happy
 * path.
 *
 * State meanings:
 *
 *   CREATED           A payment request exists. No challenge has been served.
 *   CHALLENGE_ISSUED  A 402 challenge was returned to the agent. The clock is running.
 *   PENDING           A payment is claimed but not yet observable on-chain — the
 *                     transaction is not visible yet, or our RPC providers are
 *                     degraded. Explicitly NOT a failure (product rule 149).
 *   SUBMITTED         A structurally valid transaction hash has been accepted
 *                     and queued for verification.
 *   CONFIRMING        The transfer is on-chain and valid, but below the finality
 *                     threshold for its value.
 *   CONFIRMED         Terminal success. The merchant may serve the request.
 *   FAILED            Terminal. We observed something definitively wrong, or we
 *                     exhausted retries.
 *   EXPIRED           Terminal. The challenge window closed with no valid payment.
 *   CANCELLED         Terminal. Withdrawn before payment (merchant or system).
 *   REFUNDED          Terminal. A confirmed payment was later returned.
 */

import { Meter402Error } from '@meter402/shared';

export enum PaymentStatus {
  Created = 'CREATED',
  ChallengeIssued = 'CHALLENGE_ISSUED',
  Pending = 'PENDING',
  Submitted = 'SUBMITTED',
  Confirming = 'CONFIRMING',
  Confirmed = 'CONFIRMED',
  Failed = 'FAILED',
  Expired = 'EXPIRED',
  Cancelled = 'CANCELLED',
  Refunded = 'REFUNDED',
}

export const ALL_PAYMENT_STATUSES: readonly PaymentStatus[] = Object.freeze(
  Object.values(PaymentStatus),
);

/**
 * The complete edge set. Anything not listed here is forbidden.
 *
 * Note what is deliberately absent:
 *  - CONFIRMED has exactly one outgoing edge, to REFUNDED. It can never go
 *    back to PENDING, CONFIRMING, or FAILED (product rule 25).
 *  - SUBMITTED and CONFIRMING cannot go to EXPIRED. Once a real transaction is
 *    in flight, the challenge clock no longer applies — expiry is checked when
 *    a proof is submitted, not while we wait for confirmations. Letting a
 *    confirming payment expire would take money without serving the request.
 *  - CONFIRMING -> PENDING exists on purpose. A reorg or an RPC outage can
 *    make an observed transaction temporarily unobservable, and rule 149
 *    requires that we retry rather than declare failure.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> =
  Object.freeze({
    [PaymentStatus.Created]: Object.freeze([
      PaymentStatus.ChallengeIssued,
      PaymentStatus.Expired,
      PaymentStatus.Cancelled,
    ]),
    [PaymentStatus.ChallengeIssued]: Object.freeze([
      PaymentStatus.Pending,
      PaymentStatus.Submitted,
      PaymentStatus.Expired,
      PaymentStatus.Cancelled,
      PaymentStatus.Failed,
    ]),
    [PaymentStatus.Pending]: Object.freeze([
      PaymentStatus.Submitted,
      PaymentStatus.Confirming,
      PaymentStatus.Failed,
      PaymentStatus.Expired,
    ]),
    [PaymentStatus.Submitted]: Object.freeze([
      PaymentStatus.Confirming,
      PaymentStatus.Pending,
      PaymentStatus.Failed,
    ]),
    [PaymentStatus.Confirming]: Object.freeze([
      PaymentStatus.Confirmed,
      PaymentStatus.Pending,
      PaymentStatus.Failed,
    ]),
    [PaymentStatus.Confirmed]: Object.freeze([PaymentStatus.Refunded]),
    [PaymentStatus.Failed]: Object.freeze([]),
    [PaymentStatus.Expired]: Object.freeze([]),
    [PaymentStatus.Cancelled]: Object.freeze([]),
    [PaymentStatus.Refunded]: Object.freeze([]),
  });

/** States with no outgoing edges. A payment here is finished forever. */
export const TERMINAL_STATUSES: readonly PaymentStatus[] = Object.freeze(
  ALL_PAYMENT_STATUSES.filter((status) => ALLOWED_TRANSITIONS[status].length === 0),
);

/** States in which the merchant is authorised to serve the paid request. */
export const SETTLED_STATUSES: readonly PaymentStatus[] = Object.freeze([PaymentStatus.Confirmed]);

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isSettled(status: PaymentStatus): boolean {
  return SETTLED_STATUSES.includes(status);
}

export function nextStates(status: PaymentStatus): readonly PaymentStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidPaymentTransitionError extends Meter402Error {
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
    paymentId?: string,
  ) {
    super(
      'INVALID_STATE_TRANSITION',
      `A payment cannot move from ${from} to ${to}.`,
      {
        details: {
          from,
          to,
          allowed: [...ALLOWED_TRANSITIONS[from]],
          ...(paymentId ? { paymentId } : {}),
        },
      },
    );
    this.name = 'InvalidPaymentTransitionError';
  }
}

/**
 * The only sanctioned way to change a payment's status.
 *
 * Note that a self-transition (X -> X) is rejected unless the table lists it,
 * and none do. Re-applying the same status is almost always a duplicate
 * delivery of a job, and treating it as a no-op hides that; callers that need
 * idempotent workers should check `canTransition` first and skip, so the skip
 * is a deliberate decision at the call site.
 */
export function assertTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  paymentId?: string,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidPaymentTransitionError(from, to, paymentId);
  }
}
