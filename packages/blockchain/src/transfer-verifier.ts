import { addressesEqual, err, ok, type Result } from '@meter402/shared';
import {
  verificationFailure,
  type SettlementVerifier,
  type TransferVerificationRequest,
  type VerificationFailure,
  type VerifiedTransfer,
} from '@meter402/payments';
import { decodeTransfers } from './erc20.js';
import { ProviderUnavailableError, type BlockchainProvider } from './types.js';

/**
 * Independent on-chain verification of an ERC-20 payment.
 *
 * This class is the implementation of product rule 27: never trust payment
 * data supplied by the client. The agent hands us one thing — a transaction
 * hash — and everything else is read from the chain and compared against the
 * merchant's PaymentRequest.
 *
 * It has no dependency on an RPC client; it takes a `BlockchainProvider`. All
 * of the logic below is exercised in tests against hand-constructed receipts,
 * including cases that are impractical to stage against a real chain: a token
 * that emits a malformed Transfer, a transaction paying the right amount to
 * the wrong address, a receipt from a reorged block.
 */
export class Erc20SettlementVerifier implements SettlementVerifier {
  constructor(private readonly provider: BlockchainProvider) {}

  async verifyTransfer(
    request: TransferVerificationRequest,
  ): Promise<Result<VerifiedTransfer, VerificationFailure>> {
    // The provider is bound to one chain. A mismatch means the caller resolved
    // the wrong provider, which is a configuration bug we must not paper over
    // by verifying against the wrong network.
    if (this.provider.chainId !== request.chainId) {
      return err(
        verificationFailure(
          'WRONG_NETWORK',
          `Provider serves chain ${this.provider.chainId}, but the payment expects ${request.chainId}.`,
          { expected: request.chainId, observed: this.provider.chainId },
        ),
      );
    }

    let receipt;
    try {
      receipt = await this.provider.getTransactionReceipt(request.transactionHash);
    } catch (error) {
      // An unreachable provider is our failure, not the payer's. Rule 149
      // requires this stays retryable rather than failing the payment.
      return err(
        verificationFailure(
          'PROVIDER_UNAVAILABLE',
          error instanceof ProviderUnavailableError
            ? error.message
            : 'Failed to read the transaction receipt.',
        ),
      );
    }

    if (receipt === null) {
      // Not an error: a freshly broadcast transaction is routinely invisible
      // for a few seconds. The caller holds the payment PENDING and retries.
      return err(
        verificationFailure(
          'TRANSACTION_NOT_FOUND',
          'The transaction is not yet visible on chain.',
          { transactionHash: request.transactionHash },
        ),
      );
    }

    if (receipt.status === 'reverted') {
      return err(
        verificationFailure(
          'TRANSACTION_REVERTED',
          'The transaction reverted and moved no funds.',
          { transactionHash: request.transactionHash },
        ),
      );
    }

    const transfers = decodeTransfers(receipt.logs);
    const matching = transfers.filter(
      (transfer) =>
        addressesEqual(transfer.tokenAddress, request.tokenAddress) &&
        addressesEqual(transfer.to, request.expectedRecipient),
    );

    if (matching.length === 0) {
      return err(this.diagnoseMissingTransfer(transfers, request));
    }

    /*
     * Sum every matching transfer rather than picking one. A single
     * transaction may legitimately split a payment across multiple transfers
     * to the same recipient (routers and smart accounts do this), and the
     * merchant's question is "did I receive at least the asking price in this
     * transaction", not "was there one log for it".
     */
    const received = matching.reduce((total, transfer) => total + transfer.value, 0n);

    if (received < request.expectedMinorUnits) {
      return err(
        verificationFailure('WRONG_AMOUNT', 'The transfer is smaller than the amount requested.', {
          expected: request.expectedMinorUnits.toString(),
          observed: received.toString(),
        }),
      );
    }

    let head: bigint;
    try {
      head = await this.provider.getBlockNumber();
    } catch (error) {
      return err(
        verificationFailure(
          'PROVIDER_UNAVAILABLE',
          error instanceof ProviderUnavailableError
            ? error.message
            : 'Failed to read the current block height.',
        ),
      );
    }

    /*
     * Inclusive count: a transaction in the head block has one confirmation.
     * If the head is somehow behind the receipt's block — a lagging replica
     * behind a load balancer, which does happen — treat it as zero
     * confirmations rather than computing a negative count.
     */
    const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber) + 1 : 0;

    if (confirmations < request.requiredConfirmations) {
      return err(
        verificationFailure(
          'INSUFFICIENT_CONFIRMATIONS',
          `The transfer has ${confirmations} of ${request.requiredConfirmations} required confirmations.`,
          { confirmations, required: request.requiredConfirmations },
        ),
      );
    }

    const first = matching[0];
    /* istanbul ignore next -- matching.length === 0 is handled above. */
    if (first === undefined) {
      return err(verificationFailure('WRONG_ASSET', 'No matching transfer found.'));
    }

    return ok({
      transactionHash: receipt.transactionHash,
      chainId: request.chainId,
      tokenAddress: request.tokenAddress.toLowerCase(),
      from: first.from,
      to: first.to,
      minorUnits: received,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
      logIndex: first.logIndex,
      observedAt: new Date(),
    });
  }

  /**
   * Turn "no matching transfer" into a specific, actionable reason.
   *
   * This exists purely for developer experience. An agent that gets back a
   * flat PAYMENT_INVALID has to go read the chain itself to work out what it
   * did wrong; "you paid the right amount in the wrong token" is a bug it can
   * fix in one line.
   */
  private diagnoseMissingTransfer(
    transfers: readonly { tokenAddress: string; to: string }[],
    request: TransferVerificationRequest,
  ): VerificationFailure {
    const paidRecipientWithOtherToken = transfers.some((transfer) =>
      addressesEqual(transfer.to, request.expectedRecipient),
    );
    if (paidRecipientWithOtherToken) {
      return verificationFailure(
        'WRONG_ASSET',
        'The transaction paid the correct recipient in a different token.',
        { expectedToken: request.tokenAddress },
      );
    }

    const paidOtherRecipientWithToken = transfers.some((transfer) =>
      addressesEqual(transfer.tokenAddress, request.tokenAddress),
    );
    if (paidOtherRecipientWithToken) {
      return verificationFailure(
        'WRONG_RECIPIENT',
        'The transaction transferred the correct token to a different address.',
        { expectedRecipient: request.expectedRecipient },
      );
    }

    return verificationFailure(
      'WRONG_ASSET',
      'The transaction contains no ERC-20 transfer matching this payment request.',
      { expectedToken: request.tokenAddress, expectedRecipient: request.expectedRecipient },
    );
  }
}
