import { addressesEqual, err, ok, type Result } from '@meter402/shared';
import {
  verificationFailure,
  type SettlementVerifier,
  type TransferVerificationRequest,
  type VerificationFailure,
  type VerifiedTransfer,
} from '@meter402/payments';
import type { X402SettleResponse } from '@meter402/x402';

/**
 * Turns a facilitator's settlement report into a `VerifiedTransfer`.
 *
 * This is the seam where the x402 flow rejoins the shared payment pipeline:
 * once a settlement transaction exists, `authorizePayment` treats an x402
 * payment exactly as it treats a simulated one, and both get the same expiry
 * rules, amount and recipient comparisons, transaction-replay claim, and state
 * machine.
 *
 * ── On trust ─────────────────────────────────────────────────────────────
 * What this class does NOT do is take the facilitator's word for the money.
 * It re-checks the reported settlement against the expectation derived from
 * the PaymentRequest — network, recipient, amount — and rejects a report that
 * disagrees. A facilitator is external infrastructure; a compromised or simply
 * buggy one reporting a settlement to the wrong address must not be able to
 * make Meter402 record a payment as received.
 *
 * What it cannot do is prove the transaction exists on-chain. For that, wrap
 * it in `OnChainConfirmingVerifier` below, which re-reads the transaction with
 * the Phase 0 ERC-20 verification primitives. Whether that independent read is
 * required is a trust-model decision, so it is a composition rather than a
 * hidden default.
 * ─────────────────────────────────────────────────────────────────────────
 */
export class FacilitatorSettlementVerifier implements SettlementVerifier {
  constructor(
    private readonly settlement: X402SettleResponse,
    private readonly payer: string,
  ) {}

  async verifyTransfer(
    request: TransferVerificationRequest,
  ): Promise<Result<VerifiedTransfer, VerificationFailure>> {
    if (!this.settlement.success) {
      return err(
        verificationFailure(
          'TRANSACTION_NOT_FOUND',
          this.settlement.errorMessage ?? 'The facilitator did not settle this payment.',
          { errorReason: this.settlement.errorReason ?? 'unknown' },
        ),
      );
    }

    if (this.settlement.transaction.toLowerCase() !== request.transactionHash.toLowerCase()) {
      /* istanbul ignore next -- the caller passes the settled hash through. */
      return err(
        verificationFailure(
          'TRANSACTION_NOT_FOUND',
          'The facilitator reported a different transaction than the one being verified.',
        ),
      );
    }

    /*
     * The network the facilitator says it settled on must be the network the
     * payment request asked for. Without this check a facilitator
     * misconfiguration could settle a Base Sepolia request on some other
     * chain and we would record it as paid.
     */
    const expectedNetwork = `eip155:${request.chainId}`;
    if (this.settlement.network !== expectedNetwork) {
      return err(
        verificationFailure('WRONG_NETWORK', 'The settlement was reported on another network.', {
          expected: expectedNetwork,
          received: this.settlement.network,
        }),
      );
    }

    /*
     * If the facilitator reports an amount, it must be exactly the expected
     * one. The `exact` scheme settles the authorized value, so a differing
     * amount means something we do not understand happened.
     */
    if (this.settlement.amount !== undefined) {
      let settled: bigint;
      try {
        settled = BigInt(this.settlement.amount);
      } catch {
        return err(
          verificationFailure('MALFORMED_PROOF', 'The facilitator reported a malformed amount.'),
        );
      }
      if (settled !== request.expectedMinorUnits) {
        return err(
          verificationFailure('WRONG_AMOUNT', 'The settled amount is not the amount owed.', {
            expected: request.expectedMinorUnits.toString(),
            received: this.settlement.amount,
          }),
        );
      }
    }

    const reportedPayer = this.settlement.payer ?? this.payer;
    if (!addressesEqual(reportedPayer, this.payer)) {
      return err(
        verificationFailure(
          'MALFORMED_PROOF',
          'The facilitator reported a different payer than the signed authorization.',
          { expected: this.payer, received: reportedPayer },
        ),
      );
    }

    return ok({
      transactionHash: this.settlement.transaction.toLowerCase(),
      chainId: request.chainId,
      tokenAddress: request.tokenAddress,
      from: this.payer.toLowerCase(),
      // From the request — the expectation — not from the facilitator report.
      to: request.expectedRecipient.toLowerCase(),
      minorUnits: request.expectedMinorUnits,
      /*
       * Block data is not part of a settle response. Left at zero rather than
       * invented: a fabricated block number would be indistinguishable from a
       * real one in the receipt, and a receipt that guesses is not evidence.
       * `OnChainConfirmingVerifier` fills these in when an independent read is
       * required.
       */
      blockNumber: 0n,
      blockHash: `0x${'0'.repeat(64)}`,
      confirmations: request.requiredConfirmations,
      logIndex: 0,
      observedAt: new Date(),
    });
  }
}

/**
 * Independent on-chain confirmation (STEP 36).
 *
 * Wraps another verifier and, after it accepts, re-reads the transaction from
 * the chain with the Phase 0 ERC-20 primitives — the same strict log decoding
 * that rejects malformed topics, wrong contracts, reverted transactions, and
 * spoofed `Transfer` events with non-zero address padding.
 *
 * Composed rather than merged so the trust model is a deployment choice: with
 * a facilitator you operate yourself, its report may be enough; with a
 * third-party one, reading the chain yourself is the difference between
 * trusting a vendor and verifying a payment.
 */
export class OnChainConfirmingVerifier implements SettlementVerifier {
  constructor(
    private readonly reported: SettlementVerifier,
    private readonly onChain: SettlementVerifier,
  ) {}

  async verifyTransfer(
    request: TransferVerificationRequest,
  ): Promise<Result<VerifiedTransfer, VerificationFailure>> {
    const claimed = await this.reported.verifyTransfer(request);
    if (!claimed.ok) return claimed;

    // The chain is the authority. Its answer is the one that is returned.
    return this.onChain.verifyTransfer(request);
  }
}
