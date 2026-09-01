import { findChainById, Meter402Error } from '@meter402/shared';
import {
  authorizePayment,
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
import { err, ok, type Result } from '@meter402/shared';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  SCHEME_EXACT,
  X402_PROTOCOL,
  X402_VERSION,
} from './constants.js';
import { toPaymentRequired, toPaymentRequirements } from './mapping.js';
import { parsePaymentPayload, readHeader } from './parse.js';
import type { X402PaymentRequired, X402SettleResponse } from './wire.js';

/**
 * The x402 v2 protocol adapter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Where this sits. Meter402's payment domain does not know what x402 is. This
 * adapter renders a domain `PaymentRequest` as an x402 402, decodes an x402
 * payload back into a domain `PaymentProof`, and — critically — delegates the
 * settlement decision to the *same* `authorizePayment` pipeline the TEST
 * adapter uses.
 *
 * What "the same pipeline" means, precisely. x402's `authorization` flow has
 * a step the TEST protocol does not: a signed, pre-settlement authorization
 * that must be bound to the PaymentRequest and then settled by a facilitator.
 * That step lives in `binding.ts` / `eip3009.ts` and in the API's x402 payment
 * service. Once a settlement transaction exists, the two protocols converge:
 * both hand a `PaymentProof` carrying a transaction hash to
 * `authorizePayment`, and both therefore get the identical expiry rules,
 * amount and recipient comparisons, transaction-replay claim against
 * `UNIQUE (chain_id, transaction_hash)`, and state machine.
 *
 * So the domain is not forked. What differs is what an adapter is *for*: how
 * the protocol says "pay me" and how it proves payment happened.
 * ─────────────────────────────────────────────────────────────────────────
 */

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export class X402V2PaymentProtocolAdapter implements PaymentProtocolAdapter {
  readonly protocol = X402_PROTOCOL;
  readonly version = X402_VERSION;

  /**
   * Base URL used to render `resource.url`.
   *
   * Server-owned. The resource identifier a payer signs against must not be
   * something a payer can influence.
   */
  constructor(private readonly resourceBaseUrl: string) {}

  /**
   * The protocol-neutral challenge the domain understands.
   *
   * Kept because the domain's `PaymentChallenge` is what non-x402 code reads.
   * The x402-shaped body is produced by `buildChallengeResponse` below.
   */
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
      metadata: { x402Version: X402_VERSION, simulated: false },
    };
  }

  /** Render the x402 v2 `PaymentRequired` for a request. */
  paymentRequired(request: PaymentRequest, resourcePath: string): X402PaymentRequired {
    return toPaymentRequired({
      request,
      resourceUrl: new URL(resourcePath, this.resourceBaseUrl).toString(),
    });
  }

  buildChallengeResponse(challenge: PaymentChallenge): ProtocolHttpResponse {
    /*
     * `buildChallengeResponse` receives only the protocol-neutral challenge,
     * which does not carry the resource URL. The API calls
     * `buildPaymentRequiredResponse` instead; this method exists to satisfy
     * the shared interface and produces the same body from what it has.
     */
    const requirements = {
      scheme: challenge.scheme,
      network: `eip155:${challenge.chain.id}`,
      asset: challenge.asset.address,
      amount: challenge.amountMinorUnits,
      payTo: challenge.recipient,
      maxTimeoutSeconds: Math.max(
        1,
        Math.floor((Date.parse(challenge.expiresAt) - Date.now()) / 1000),
      ),
      extra: {},
    };
    return this.renderPaymentRequired({
      x402Version: X402_VERSION,
      resource: { url: new URL(challenge.paymentRequestId, this.resourceBaseUrl).toString() },
      accepts: [requirements as never],
    });
  }

  /** The canonical 402: x402 v2 body plus the `PAYMENT-REQUIRED` header. */
  buildPaymentRequiredResponse(
    request: PaymentRequest,
    resourcePath: string,
  ): ProtocolHttpResponse {
    return this.renderPaymentRequired(this.paymentRequired(request, resourcePath));
  }

  private renderPaymentRequired(body: X402PaymentRequired): ProtocolHttpResponse {
    return {
      status: 402,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // A cached 402 is a replayable payment instruction.
        'cache-control': 'no-store',
        [PAYMENT_REQUIRED_HEADER]: base64Json(body),
      },
      body,
    };
  }

  /**
   * Decode the `PAYMENT-SIGNATURE` header into a domain proof.
   *
   * At this point no settlement has happened, so there is no transaction hash
   * to report. `transactionHash` is left empty and filled in after the
   * facilitator settles — the domain proof is completed, not fabricated.
   */
  parsePaymentProof(input: ParseProofInput): Result<PaymentProof, VerificationFailure> {
    const raw = readHeader(input.headers, PAYMENT_SIGNATURE_HEADER);
    if (raw === null) {
      return err(
        verificationFailure('MALFORMED_PROOF', `Missing ${PAYMENT_SIGNATURE_HEADER} header.`),
      );
    }
    if (raw === 'DUPLICATED') {
      // Which value a proxy forwards versus which we read is the ambiguity
      // request-smuggling attacks exploit.
      return err(
        verificationFailure('MALFORMED_PROOF', `Multiple ${PAYMENT_SIGNATURE_HEADER} headers.`),
      );
    }

    const parsed = parsePaymentPayload(raw);
    if (!parsed.ok) return parsed;
    const payload = parsed.value;

    const authorization = payload.payload['authorization'];
    const payer =
      typeof authorization === 'object' && authorization !== null
        ? ((authorization as Record<string, unknown>)['from'] ?? null)
        : null;

    return ok({
      protocol: X402_PROTOCOL,
      // No settlement yet. Filled once the facilitator returns a transaction.
      transactionHash: '',
      payer: typeof payer === 'string' ? payer : null,
      nonce: null,
      raw: payload as unknown as Readonly<Record<string, unknown>>,
    });
  }

  /**
   * Structural checks only. The substantive binding — amount, asset,
   * recipient, network, expiry — lives in `bindAuthorizationToRequest`, which
   * needs the `PaymentRequest` rather than the protocol-neutral challenge.
   */
  validatePaymentProof(
    proof: PaymentProof,
    challenge: PaymentChallenge,
  ): Result<void, VerificationFailure> {
    if (proof.protocol !== X402_PROTOCOL) {
      return err(verificationFailure('MALFORMED_PROOF', 'Expected an x402 payment proof.'));
    }
    if (challenge.protocol !== X402_PROTOCOL) {
      /* istanbul ignore next -- the gate pairs adapter and challenge. */
      return err(verificationFailure('MALFORMED_PROOF', 'Challenge protocol mismatch.'));
    }
    return ok(undefined);
  }

  /** Delegates to the shared pipeline — the same one the TEST adapter uses. */
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
    const settleResponse: X402SettleResponse = {
      success: true,
      transaction: input.transfer.transactionHash,
      network: `eip155:${input.request.chainId}`,
      payer: input.transfer.from,
      amount: input.transfer.minorUnits.toString(),
    };

    return {
      status: 200,
      headers: { [PAYMENT_RESPONSE_HEADER]: base64Json(settleResponse) },
      body: { success: true, receiptId: input.receiptId },
    };
  }

  buildFailureResponse(
    failure: VerificationFailure,
    challenge?: PaymentChallenge,
  ): ProtocolHttpResponse {
    return {
      status: 402,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: {
        x402Version: X402_VERSION,
        error: failure.reason,
        message: failure.message,
        ...(challenge ? { accepts: [] } : {}),
      },
    };
  }

  /** Requirements as they will be sent to a facilitator. */
  requirementsFor(request: PaymentRequest) {
    return toPaymentRequirements(request);
  }

  createReceiptMetadata(input: ReceiptMetadataInput): Readonly<Record<string, unknown>> {
    const chain = findChainById(input.request.chainId);
    return {
      protocol: X402_PROTOCOL,
      x402Version: X402_VERSION,
      scheme: SCHEME_EXACT,
      simulated: false,
      network: chain ? `eip155:${chain.id}` : String(input.request.chainId),
      chainId: input.request.chainId,
      transactionHash: input.transfer.transactionHash,
      payer: input.transfer.from,
      recipient: input.transfer.to,
      asset: input.request.assetSymbol,
      amountMinorUnits: input.transfer.minorUnits.toString(),
    };
  }
}
