import { addressesEqual, isValidTransactionHash } from '@meter402/shared';
import { PaymentStatus, isSettled, isTerminal } from './status.js';
import { isExpired, type PaymentRequest } from './payment-request.js';
import type { PaymentAuthorization, PaymentProof } from './protocol.js';
import {
  verificationFailure,
  type ReplayGuard,
  type SettlementVerifier,
  type VerificationFailure,
} from './verification.js';

/**
 * The payment authorization pipeline.
 *
 * This is the security-critical core of Meter402 and it is written as a pure
 * function over injected dependencies so that every branch — including the
 * ones that are impractical to provoke against a live chain — is reachable
 * from a unit test.
 *
 * The ordering of checks is deliberate:
 *
 *   1. Cheap, local checks first (status, expiry, proof shape) so a malformed
 *      or dead request never costs an RPC call. This is also a DoS control:
 *      an attacker replaying garbage proofs should not be able to convert
 *      cheap requests into expensive upstream calls.
 *   2. On-chain verification second. Everything compared here comes from the
 *      PaymentRequest, not from the agent (product rule 27).
 *   3. Replay claim last, because it has a durable side effect. Claiming
 *      before verification would let an attacker burn a legitimate
 *      transaction hash by submitting it against a request it does not
 *      satisfy.
 */

export interface AuthorizePaymentInput {
  readonly request: PaymentRequest;
  readonly proof: PaymentProof;
  readonly verifier: SettlementVerifier;
  readonly replayGuard: ReplayGuard;
  readonly requiredConfirmations: number;
  readonly now?: Date;
}

function reject(nextStatus: PaymentStatus, failure: VerificationFailure): PaymentAuthorization {
  return { decision: 'REJECTED', nextStatus, transfer: null, failure };
}

function pending(nextStatus: PaymentStatus, failure: VerificationFailure): PaymentAuthorization {
  return { decision: 'PENDING', nextStatus, transfer: null, failure };
}

/**
 * Statuses where the challenge deadline still applies.
 *
 * Once a transaction is SUBMITTED we stop enforcing expiry: the agent has
 * already broadcast and paid, and failing it because our confirmation wait
 * outlived the challenge window would take the money without serving the
 * request. Expiry is a deadline for *paying*, not for *confirming*.
 */
const EXPIRY_ENFORCED_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.Created,
  PaymentStatus.ChallengeIssued,
  PaymentStatus.Pending,
];

export async function authorizePayment(
  input: AuthorizePaymentInput,
): Promise<PaymentAuthorization> {
  const { request, proof, verifier, replayGuard, requiredConfirmations } = input;
  const now = input.now ?? new Date();

  // 1a. An already-confirmed request re-presented with the same proof is an
  // idempotent success, not a replay. Agents retry; retrying a call that was
  // already paid for must not charge again or fail.
  if (isSettled(request.status)) {
    return {
      decision: 'AUTHORIZED',
      nextStatus: PaymentStatus.Confirmed,
      transfer: null,
      failure: null,
    };
  }

  // 1b. Any other terminal state cannot be paid into.
  if (isTerminal(request.status)) {
    return reject(
      request.status,
      verificationFailure(
        'REQUEST_NOT_PAYABLE',
        `Payment request is ${request.status} and can no longer be paid.`,
        { status: request.status },
      ),
    );
  }

  // 1c. Expiry.
  if (EXPIRY_ENFORCED_STATUSES.includes(request.status) && isExpired(request, now)) {
    return reject(
      PaymentStatus.Expired,
      verificationFailure('REQUEST_EXPIRED', 'The payment request has expired.', {
        expiresAt: request.expiresAt.toISOString(),
      }),
    );
  }

  // 1d. Proof shape. Validated before it reaches an RPC provider, both to save
  // the call and to keep unvalidated input out of upstream requests.
  if (!isValidTransactionHash(proof.transactionHash)) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure(
        'MALFORMED_PROOF',
        'The supplied transaction hash is not a 32-byte hex string.',
        { transactionHash: proof.transactionHash },
      ),
    );
  }

  // 1e. Nonce binding. If the protocol echoes the challenge nonce, it must be
  // the nonce we issued for *this* request — otherwise a proof captured from
  // one challenge could be presented against another with the same amount and
  // recipient.
  if (proof.nonce !== null && proof.nonce !== request.nonce) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure('MALFORMED_PROOF', 'The payment proof does not match this challenge.'),
    );
  }

  // 2. Independent on-chain verification. Every expectation below is ours.
  const verification = await verifier.verifyTransfer({
    transactionHash: proof.transactionHash,
    chainId: request.chainId,
    tokenAddress: request.assetAddress,
    expectedRecipient: request.recipientAddress,
    expectedMinorUnits: request.amountMinorUnits,
    requiredConfirmations,
  });

  if (!verification.ok) {
    const failure = verification.error;
    switch (failure.reason) {
      case 'INSUFFICIENT_CONFIRMATIONS':
        // Seen on-chain and valid, just not final yet.
        return pending(PaymentStatus.Confirming, failure);
      case 'TRANSACTION_NOT_FOUND':
      case 'PROVIDER_UNAVAILABLE':
        // Product rule 149: an RPC problem is not the agent's fault and must
        // not fail a payment that may well be valid.
        return pending(PaymentStatus.Pending, failure);
      default:
        return reject(PaymentStatus.Failed, failure);
    }
  }

  const transfer = verification.value;

  // 3. Defence in depth. The verifier is contractually required to enforce
  // these, but authorization is the last gate before money is treated as
  // received, so it re-checks rather than trusting its collaborator.
  if (transfer.chainId !== request.chainId) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure('WRONG_NETWORK', 'Transfer settled on a different chain.', {
        expected: request.chainId,
        observed: transfer.chainId,
      }),
    );
  }
  if (!addressesEqual(transfer.tokenAddress, request.assetAddress)) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure('WRONG_ASSET', 'Transfer was made in a different token.', {
        expected: request.assetAddress,
        observed: transfer.tokenAddress,
      }),
    );
  }
  if (!addressesEqual(transfer.to, request.recipientAddress)) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure('WRONG_RECIPIENT', 'Transfer was sent to a different address.', {
        expected: request.recipientAddress,
        observed: transfer.to,
      }),
    );
  }
  if (transfer.minorUnits < request.amountMinorUnits) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure('WRONG_AMOUNT', 'Transfer amount is less than the amount requested.', {
        expected: request.amountMinorUnits.toString(),
        observed: transfer.minorUnits.toString(),
      }),
    );
  }

  // 4. Replay protection. An atomic claim against a UNIQUE constraint — see
  // ReplayGuard. A transaction already bound to *this* request is a retry of a
  // call we were already processing and is allowed to proceed.
  const claim = await replayGuard.claim({
    chainId: request.chainId,
    transactionHash: transfer.transactionHash,
    paymentRequestId: request.id,
  });

  if (!claim.claimed && claim.existingPaymentRequestId !== request.id) {
    return reject(
      PaymentStatus.Failed,
      verificationFailure(
        'TRANSACTION_ALREADY_USED',
        'This transaction has already settled a different payment request.',
        { transactionHash: transfer.transactionHash },
      ),
    );
  }

  return {
    decision: 'AUTHORIZED',
    nextStatus: PaymentStatus.Confirmed,
    transfer,
    failure: null,
  };
}
