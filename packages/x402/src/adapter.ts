import { Meter402Error, err, findChainById, ok, type Result } from '@meter402/shared';
import {
  authorizePayment,
  failureToErrorCode,
  verificationFailure,
  type BuildSuccessInput,
  type ParseProofInput,
  type PaymentAuthorization,
  type PaymentChallenge,
  type PaymentProof,
  type PaymentProtocolAdapter,
  type PaymentRequest,
  type ProtocolHttpResponse,
  type ReceiptMetadataInput,
  type VerificationFailure,
  type VerifyPaymentInput,
} from '@meter402/payments';
import {
  MAX_PAYMENT_HEADER_BYTES,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  SCHEME_EXACT,
  X402_PROTOCOL,
  X402_VERSION,
} from './constants.js';
import { parseX402PaymentHeader, readSingleHeader } from './proof.js';

/**
 * The x402 adapter.
 *
 * This class, plus `proof.ts`, is the entire surface on which Meter402 knows
 * what x402 looks like on the wire. Everything else in the platform speaks
 * `PaymentProtocolAdapter`. Adding MPP or AP2 later means writing a sibling of
 * this file (product rule 9).
 *
 * See `constants.ts` for the conformance caveat: the shape here follows the
 * public x402 v1 description but has not been validated against the
 * specification or an independent client.
 */
export class X402Adapter implements PaymentProtocolAdapter {
  readonly protocol = X402_PROTOCOL;

  createChallenge(request: PaymentRequest): PaymentChallenge {
    const chain = findChainById(request.chainId);
    if (!chain) {
      throw new Meter402Error(
        'INTERNAL_ERROR',
        `Payment request references unregistered chain ${request.chainId}.`,
      );
    }

    return {
      paymentRequestId: request.id,
      protocol: X402_PROTOCOL,
      scheme: SCHEME_EXACT,
      // A string, never a JSON number: JSON numbers are doubles, and a large
      // minor-unit amount would lose precision in transit.
      amountMinorUnits: request.amountMinorUnits.toString(),
      asset: {
        symbol: request.assetSymbol,
        address: request.assetAddress,
        decimals: request.assetDecimals,
      },
      chain: { id: chain.id, slug: chain.slug },
      recipient: request.recipientAddress,
      nonce: request.nonce,
      expiresAt: request.expiresAt.toISOString(),
      metadata: {},
    };
  }

  buildChallengeResponse(challenge: PaymentChallenge): ProtocolHttpResponse {
    return {
      status: 402,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // A cached 402 is a replayable payment instruction: a shared proxy
        // could hand the same nonce and deadline to another agent.
        'cache-control': 'no-store',
      },
      body: {
        x402Version: X402_VERSION,
        error: 'PAYMENT_REQUIRED',
        accepts: [
          {
            scheme: challenge.scheme,
            network: challenge.chain.slug,
            maxAmountRequired: challenge.amountMinorUnits,
            payTo: challenge.recipient,
            asset: challenge.asset.address,
            resource: challenge.paymentRequestId,
            mimeType: 'application/json',
            maxTimeoutSeconds: Math.max(
              0,
              Math.ceil((Date.parse(challenge.expiresAt) - Date.now()) / 1000),
            ),
            extra: {
              name: challenge.asset.symbol,
              decimals: challenge.asset.decimals,
              chainId: challenge.chain.id,
              nonce: challenge.nonce,
              paymentRequestId: challenge.paymentRequestId,
              expiresAt: challenge.expiresAt,
            },
          },
        ],
      },
    };
  }

  parsePaymentProof(input: ParseProofInput): Result<PaymentProof, VerificationFailure> {
    const header = readSingleHeader(input.headers, PAYMENT_HEADER);

    if ('error' in header) {
      return err(
        verificationFailure(
          'MALFORMED_PROOF',
          header.error === 'MISSING'
            ? `Missing ${PAYMENT_HEADER} header.`
            : `Multiple ${PAYMENT_HEADER} headers were supplied.`,
        ),
      );
    }

    if (header.value.length > MAX_PAYMENT_HEADER_BYTES * 2) {
      return err(
        verificationFailure('MALFORMED_PROOF', `The ${PAYMENT_HEADER} header is too large.`),
      );
    }

    return parseX402PaymentHeader(header.value);
  }

  /**
   * Offline structural checks.
   *
   * These are cheap and run before any RPC call. They catch an agent that paid
   * on the wrong network or under a scheme we do not implement, and give it a
   * precise reason instead of a generic verification failure.
   */
  validatePaymentProof(
    proof: PaymentProof,
    challenge: PaymentChallenge,
  ): Result<void, VerificationFailure> {
    if (proof.protocol !== X402_PROTOCOL) {
      return err(
        verificationFailure('MALFORMED_PROOF', `Expected an ${X402_PROTOCOL} proof.`),
      );
    }

    const scheme = proof.raw['scheme'];
    if (typeof scheme === 'string' && scheme !== challenge.scheme) {
      return err(
        verificationFailure(
          'MALFORMED_PROOF',
          `Unsupported settlement scheme ${scheme}. This endpoint requires ${challenge.scheme}.`,
        ),
      );
    }

    const network = proof.raw['network'];
    if (typeof network === 'string' && network !== challenge.chain.slug) {
      return err(
        verificationFailure(
          'WRONG_NETWORK',
          `Payment was made on ${network} but this endpoint settles on ${challenge.chain.slug}.`,
          { expected: challenge.chain.slug, observed: network },
        ),
      );
    }

    if (proof.nonce !== null && proof.nonce !== challenge.nonce) {
      return err(
        verificationFailure('MALFORMED_PROOF', 'The proof does not correspond to this challenge.'),
      );
    }

    return ok(undefined);
  }

  /**
   * Full verification.
   *
   * Delegates to the shared authorization pipeline rather than reimplementing
   * it. That pipeline is protocol-agnostic, so every protocol we add inherits
   * the same replay protection, expiry handling, and RPC-outage semantics
   * instead of each adapter getting its own subtly different version.
   */
  async verifyPayment(input: VerifyPaymentInput): Promise<PaymentAuthorization> {
    return authorizePayment({
      request: input.request,
      proof: input.proof,
      verifier: input.verifier,
      replayGuard: input.replayGuard,
      requiredConfirmations: input.requiredConfirmations,
      ...(input.now ? { now: input.now } : {}),
    });
  }

  buildSuccessResponse(input: BuildSuccessInput): ProtocolHttpResponse {
    const chain = findChainById(input.request.chainId);
    const payload = {
      success: true,
      transaction: input.transfer.transactionHash,
      network: chain?.slug ?? String(input.request.chainId),
      payer: input.transfer.from,
      receiptId: input.receiptId,
    };

    return {
      status: 200,
      headers: {
        [PAYMENT_RESPONSE_HEADER]: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
      },
      body: payload,
    };
  }

  buildFailureResponse(
    failure: VerificationFailure,
    challenge?: PaymentChallenge,
  ): ProtocolHttpResponse {
    const code = failureToErrorCode(failure.reason);
    const status = new Meter402Error(code).httpStatus;

    return {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: {
        x402Version: X402_VERSION,
        error: code,
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
        // Re-serve the challenge on a retryable failure so an agent can pay
        // again without a second round trip to fetch fresh terms.
        ...(challenge && status === 402
          ? { accepts: this.buildChallengeResponse(challenge).body }
          : {}),
      },
    };
  }

  createReceiptMetadata(input: ReceiptMetadataInput): Readonly<Record<string, unknown>> {
    const chain = findChainById(input.request.chainId);
    return {
      protocol: X402_PROTOCOL,
      x402Version: X402_VERSION,
      scheme: SCHEME_EXACT,
      network: chain?.slug ?? String(input.request.chainId),
      chainId: input.request.chainId,
      transaction: input.transfer.transactionHash,
      blockNumber: input.transfer.blockNumber.toString(),
      confirmations: input.transfer.confirmations,
      payer: input.transfer.from,
      recipient: input.transfer.to,
      asset: input.request.assetSymbol,
      assetAddress: input.request.assetAddress,
      amountMinorUnits: input.transfer.minorUnits.toString(),
      explorerUrl: chain?.blockExplorerTxUrl(input.transfer.transactionHash) ?? null,
    };
  }
}
