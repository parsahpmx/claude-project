import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  ALL_PAYMENT_STATUSES,
  InvalidPaymentTransitionError,
  PaymentStatus,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  isSettled,
  isTerminal,
  nextStates,
} from './status.js';

describe('payment state machine', () => {
  it('covers every status in the transition table', () => {
    // A status added to the enum without an entry here would otherwise throw
    // at runtime the first time a payment reached it.
    for (const status of ALL_PAYMENT_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
    expect(Object.keys(ALLOWED_TRANSITIONS)).toHaveLength(ALL_PAYMENT_STATUSES.length);
  });

  /**
   * Product rule 25 requires a test for every transition, not just the happy
   * path. There are 10 statuses, so this asserts all 100 ordered pairs against
   * the declared table — any edge silently added or removed fails here.
   */
  it('permits exactly the declared edges and nothing else', () => {
    const permitted = new Set<string>();
    for (const from of ALL_PAYMENT_STATUSES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        permitted.add(`${from}->${to}`);
      }
    }

    let checked = 0;
    for (const from of ALL_PAYMENT_STATUSES) {
      for (const to of ALL_PAYMENT_STATUSES) {
        checked += 1;
        expect(canTransition(from, to)).toBe(permitted.has(`${from}->${to}`));
      }
    }
    expect(checked).toBe(100);
  });

  it('never allows CONFIRMED to move back to PENDING', () => {
    // Called out explicitly in rule 25. If this edge ever existed, a payment
    // that was confirmed and served could be re-verified and re-charged.
    expect(canTransition(PaymentStatus.Confirmed, PaymentStatus.Pending)).toBe(false);
    expect(() => assertTransition(PaymentStatus.Confirmed, PaymentStatus.Pending)).toThrow(
      InvalidPaymentTransitionError,
    );
  });

  it('allows a confirmed payment only to be refunded', () => {
    expect(nextStates(PaymentStatus.Confirmed)).toEqual([PaymentStatus.Refunded]);
  });

  it('never allows any status to move backwards out of a terminal state', () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const to of ALL_PAYMENT_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('identifies the terminal states', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      [
        PaymentStatus.Cancelled,
        PaymentStatus.Expired,
        PaymentStatus.Failed,
        PaymentStatus.Refunded,
      ].sort(),
    );
    expect(isTerminal(PaymentStatus.Confirming)).toBe(false);
    expect(isTerminal(PaymentStatus.Failed)).toBe(true);
  });

  it('treats only CONFIRMED as authorising the merchant to serve the request', () => {
    for (const status of ALL_PAYMENT_STATUSES) {
      expect(isSettled(status)).toBe(status === PaymentStatus.Confirmed);
    }
  });

  it('rejects self-transitions', () => {
    // Re-applying a status is almost always a duplicated job. Callers that
    // want to skip must check canTransition explicitly.
    for (const status of ALL_PAYMENT_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('walks the canonical happy path', () => {
    const path = [
      PaymentStatus.Created,
      PaymentStatus.ChallengeIssued,
      PaymentStatus.Submitted,
      PaymentStatus.Confirming,
      PaymentStatus.Confirmed,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = path[i];
      const to = path[i + 1];
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      expect(() => assertTransition(from!, to!)).not.toThrow();
    }
  });

  it('allows CONFIRMING to fall back to PENDING during a reorg or RPC outage', () => {
    // Rule 149: an unobservable transaction is not a failed one.
    expect(canTransition(PaymentStatus.Confirming, PaymentStatus.Pending)).toBe(true);
  });

  it('does not let an in-flight transaction expire', () => {
    // Expiry is a deadline for paying, not for confirming. Expiring a
    // submitted payment would take the money without serving the request.
    expect(canTransition(PaymentStatus.Submitted, PaymentStatus.Expired)).toBe(false);
    expect(canTransition(PaymentStatus.Confirming, PaymentStatus.Expired)).toBe(false);
  });

  it('reports the allowed set on a rejected transition', () => {
    try {
      assertTransition(PaymentStatus.Confirmed, PaymentStatus.Failed, 'pay_123');
      expect.unreachable('expected the transition to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPaymentTransitionError);
      const typed = error as InvalidPaymentTransitionError;
      expect(typed.code).toBe('INVALID_STATE_TRANSITION');
      expect(typed.httpStatus).toBe(409);
      expect(typed.details).toMatchObject({
        from: PaymentStatus.Confirmed,
        to: PaymentStatus.Failed,
        allowed: [PaymentStatus.Refunded],
        paymentId: 'pay_123',
      });
    }
  });

  it('freezes the transition table against mutation at runtime', () => {
    expect(Object.isFrozen(ALLOWED_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(ALLOWED_TRANSITIONS[PaymentStatus.Confirmed])).toBe(true);
  });
});
