import type { ErrorCode, Result } from '@meter402/shared';

/**
 * Settlement verification contracts.
 *
 * The interfaces live here, in the domain package, while the implementations
 * live in `@meter402/blockchain`. That inversion is what lets the payment
 * authorization logic be tested exhaustively against fakes — including failure
 * modes like "RPC returned a different amount than the agent claimed" that are
 * impractical to reproduce against a real chain.
 */

/**
 * Why a verification failed. These map onto the public error codes but are
 * kept separate: the reason is recorded on the payment attempt and fed to the
 * risk engine as a signal, and internal reasons (PROVIDER_UNAVAILABLE) must
 * not be conflated with caller-caused ones (WRONG_AMOUNT).
 */
export type VerificationFailureReason =
  | 'MALFORMED_PROOF'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_REVERTED'
  | 'WRONG_NETWORK'
  | 'WRONG_ASSET'
  | 'WRONG_RECIPIENT'
  | 'WRONG_AMOUNT'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'TRANSACTION_ALREADY_USED'
  | 'REQUEST_EXPIRED'
  | 'REQUEST_NOT_PAYABLE'
  | 'PROVIDER_UNAVAILABLE';

export interface VerificationFailure {
  readonly reason: VerificationFailureReason;
  readonly message: string;
  /** Caller-safe context, e.g. expected vs observed amount. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export function verificationFailure(
  reason: VerificationFailureReason,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): VerificationFailure {
  return { reason, message, ...(details ? { details } : {}) };
}

/**
 * Map an internal reason to the public error code.
 *
 * TRANSACTION_NOT_FOUND and PROVIDER_UNAVAILABLE both become
 * PAYMENT_NOT_CONFIRMED rather than PAYMENT_INVALID: neither means the agent
 * did anything wrong, and both are retryable. Telling an agent its valid
 * payment was invalid because our RPC blinked would make it pay twice.
 */
export function failureToErrorCode(reason: VerificationFailureReason): ErrorCode {
  switch (reason) {
    case 'MALFORMED_PROOF':
      return 'PAYMENT_INVALID';
    case 'TRANSACTION_NOT_FOUND':
      return 'PAYMENT_NOT_CONFIRMED';
    case 'TRANSACTION_REVERTED':
      return 'PAYMENT_INVALID';
    case 'WRONG_NETWORK':
      return 'WRONG_NETWORK';
    case 'WRONG_ASSET':
      return 'WRONG_ASSET';
    case 'WRONG_RECIPIENT':
      return 'WRONG_RECIPIENT';
    case 'WRONG_AMOUNT':
      return 'WRONG_AMOUNT';
    case 'INSUFFICIENT_CONFIRMATIONS':
      return 'PAYMENT_NOT_CONFIRMED';
    case 'TRANSACTION_ALREADY_USED':
      return 'PAYMENT_ALREADY_USED';
    case 'REQUEST_EXPIRED':
      return 'PAYMENT_EXPIRED';
    case 'REQUEST_NOT_PAYABLE':
      return 'CONFLICT';
    case 'PROVIDER_UNAVAILABLE':
      return 'PAYMENT_NOT_CONFIRMED';
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled verification failure reason: ${String(exhaustive)}`);
    }
  }
}

/** Reasons where retrying the same proof later could succeed. */
export function isRetryableFailure(reason: VerificationFailureReason): boolean {
  return (
    reason === 'TRANSACTION_NOT_FOUND' ||
    reason === 'INSUFFICIENT_CONFIRMATIONS' ||
    reason === 'PROVIDER_UNAVAILABLE'
  );
}

/**
 * What we ask the chain to confirm.
 *
 * Note that every field is our own expectation, taken from the PaymentRequest.
 * Nothing here is supplied by the agent except the transaction hash — that is
 * the whole point of product rule 27. An agent can tell us which transaction
 * to look at; it cannot tell us what that transaction says.
 */
export interface TransferVerificationRequest {
  readonly transactionHash: string;
  readonly chainId: number;
  readonly tokenAddress: string;
  readonly expectedRecipient: string;
  readonly expectedMinorUnits: bigint;
  readonly requiredConfirmations: number;
}

/** An ERC-20 transfer we have independently observed and validated on-chain. */
export interface VerifiedTransfer {
  readonly transactionHash: string;
  readonly chainId: number;
  readonly tokenAddress: string;
  readonly from: string;
  readonly to: string;
  readonly minorUnits: bigint;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly confirmations: number;
  /** Position of the Transfer log within the transaction. */
  readonly logIndex: number;
  readonly observedAt: Date;
}

export interface SettlementVerifier {
  verifyTransfer(
    request: TransferVerificationRequest,
  ): Promise<Result<VerifiedTransfer, VerificationFailure>>;
}

/**
 * Replay protection (product rule 28).
 *
 * `claim` must be atomic and durable — in the real implementation it is an
 * INSERT against a UNIQUE (chain_id, transaction_hash) constraint, so two
 * concurrent verifications of the same transaction cannot both succeed. An
 * application-level "SELECT then INSERT" would race, which is exactly the
 * window a double-spend attempt would aim for; rule 134 requires the database
 * constraint to be the enforcement point.
 */
export interface ReplayGuard {
  claim(input: {
    readonly chainId: number;
    readonly transactionHash: string;
    readonly paymentRequestId: string;
  }): Promise<ReplayClaimResult>;
}

export type ReplayClaimResult =
  | { readonly claimed: true }
  /** Already bound — `existingPaymentRequestId` tells us whether it is ours. */
  | { readonly claimed: false; readonly existingPaymentRequestId: string };
