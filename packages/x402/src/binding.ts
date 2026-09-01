import { addressesEqual, err, ok, toCaip2, type Result } from '@meter402/shared';
import { verificationFailure, type VerificationFailure } from '@meter402/payments';
import type { PaymentRequest } from '@meter402/payments';
import { SCHEME_EXACT, X402_VERSION } from './constants.js';
import { resolveTrustedAsset } from './mapping.js';
import type { X402ExactEvmPayload, X402PaymentPayload } from './wire.js';

/**
 * Binding a client authorization to the server's PaymentRequest.
 *
 * This module answers one question: *does this signed authorization pay
 * exactly what this PaymentRequest asks for?* Every expectation is read from
 * the stored request or the trusted asset registry; nothing is read from the
 * client except the values being checked.
 *
 * Two properties are worth stating because they are what an attacker attacks:
 *
 *  1. **No tolerance.** An authorization for 29 999 atomic units against a
 *     30 000 unit request is rejected. There is no rounding, no epsilon, and
 *     no "close enough" — those exist in this code only as this sentence.
 *
 *  2. **The client's `accepted` block is evidence, not instruction.** The
 *     client echoes back the requirement it claims to have accepted. It is
 *     compared against ours and must match; it is never the source of any
 *     expected value. A payload whose `accepted.payTo` names the attacker's
 *     wallet fails here, precisely because we never read it as the recipient.
 *
 * Runs entirely offline, before any facilitator call. An authorization that
 * fails these checks never reaches an external service and never costs an
 * outbound request.
 */

export interface BindingContext {
  readonly request: PaymentRequest;
  readonly payload: X402PaymentPayload;
  readonly exact: X402ExactEvmPayload;
  readonly now: Date;
}

function reject(reason: string, details?: Record<string, unknown>) {
  return err(verificationFailure('MALFORMED_PROOF', reason, details));
}

/**
 * Compare two atomic amounts exactly.
 *
 * Via BigInt, so the comparison is over integers rather than strings —
 * `"30000"` and `"030000"` are different strings but the parser has already
 * refused the second form, and comparing numerically keeps this correct even
 * if that ever changes.
 */
function amountsEqual(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    /* istanbul ignore next -- the parser guarantees canonical decimal input. */
    return false;
  }
}

export function bindAuthorizationToRequest(
  context: BindingContext,
): Result<void, VerificationFailure> {
  const { request, payload, exact, now } = context;
  const accepted = payload.accepted;

  if (payload.x402Version !== X402_VERSION) {
    /* istanbul ignore next -- the parser rejects other versions first. */
    return reject('Unsupported x402 version.');
  }

  if (accepted.scheme !== SCHEME_EXACT) {
    return err(
      verificationFailure(
        'MALFORMED_PROOF',
        `Unsupported scheme ${JSON.stringify(accepted.scheme)}. This server implements only "${SCHEME_EXACT}".`,
        { scheme: accepted.scheme },
      ),
    );
  }

  // --- Network -----------------------------------------------------------
  // Expected network comes from the request's chain. A mismatch is never
  // resolved by substituting the client's network (STEP 20).
  const expectedNetwork = toCaip2(request.chainId);
  if (accepted.network !== expectedNetwork) {
    return err(
      verificationFailure(
        'WRONG_NETWORK',
        'The authorization names a different network than the payment request.',
        { expected: expectedNetwork, received: accepted.network },
      ),
    );
  }

  // --- Asset -------------------------------------------------------------
  // Compared against the registry, not against the request row, so a
  // lookalike token with the right symbol cannot satisfy this (STEP 21).
  const asset = resolveTrustedAsset(request);
  if (!addressesEqual(accepted.asset, asset.address)) {
    return err(
      verificationFailure(
        'WRONG_ASSET',
        'The authorization names a different token contract than the payment request.',
        { expected: asset.address, received: accepted.asset },
      ),
    );
  }

  // --- Amount ------------------------------------------------------------
  const expectedAmount = request.amountMinorUnits.toString();
  if (!amountsEqual(accepted.amount, expectedAmount)) {
    return err(
      verificationFailure(
        'WRONG_AMOUNT',
        'The accepted requirement does not carry the amount this payment request asks for.',
        { expected: expectedAmount, received: accepted.amount },
      ),
    );
  }
  // The signed value is what actually moves. It must match too — a payload
  // whose `accepted` is correct but whose signed `value` is lower would
  // otherwise pass on the echo alone.
  if (!amountsEqual(exact.authorization.value, expectedAmount)) {
    return err(
      verificationFailure(
        'WRONG_AMOUNT',
        'The signed authorization value does not match the payment request amount.',
        { expected: expectedAmount, received: exact.authorization.value },
      ),
    );
  }

  // --- Recipient ---------------------------------------------------------
  // Expected recipient comes from the request snapshot (STEP 19). Both the
  // echoed requirement and the signed `to` must name it: the signature covers
  // `to`, so that is the field that decides where money actually goes.
  if (!addressesEqual(accepted.payTo, request.recipientAddress)) {
    return err(
      verificationFailure(
        'WRONG_RECIPIENT',
        'The accepted requirement names a different recipient than the payment request.',
        { expected: request.recipientAddress, received: accepted.payTo },
      ),
    );
  }
  if (!addressesEqual(exact.authorization.to, request.recipientAddress)) {
    return err(
      verificationFailure(
        'WRONG_RECIPIENT',
        'The signed authorization pays a different recipient than the payment request.',
        { expected: request.recipientAddress, received: exact.authorization.to },
      ),
    );
  }

  // --- Time --------------------------------------------------------------
  // Checked here rather than delegated to the facilitator (STEP 22): the
  // PaymentRequest deadline is a Meter402 domain rule, and a facilitator that
  // does not know about it cannot enforce it.
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
  const validAfter = BigInt(exact.authorization.validAfter);
  const validBefore = BigInt(exact.authorization.validBefore);

  if (validAfter > nowSeconds) {
    return err(
      verificationFailure('REQUEST_EXPIRED', 'The authorization is not valid yet.', {
        validAfter: exact.authorization.validAfter,
      }),
    );
  }
  if (validBefore <= nowSeconds) {
    return err(
      verificationFailure('REQUEST_EXPIRED', 'The authorization has expired.', {
        validBefore: exact.authorization.validBefore,
      }),
    );
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    return err(
      verificationFailure('REQUEST_EXPIRED', 'The payment request has expired.', {
        expiresAt: request.expiresAt.toISOString(),
      }),
    );
  }

  return ok(undefined);
}
