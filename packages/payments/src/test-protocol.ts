import { createHmac, timingSafeEqual } from 'node:crypto';
import { MerchantEnvironment, err, findChainById, ok, type Result } from '@meter402/shared';
import { Meter402Error } from '@meter402/shared';
import { authorizePayment } from './authorization.js';
import { isExpired, type PaymentRequest } from './payment-request.js';
import type {
  BuildSuccessInput,
  ParseProofInput,
  PaymentAuthorization,
  PaymentChallenge,
  PaymentProof,
  PaymentProtocolAdapter,
  ProtocolHttpResponse,
  ReceiptMetadataInput,
  VerifyPaymentInput,
} from './protocol.js';
import {
  verificationFailure,
  type SettlementVerifier,
  type TransferVerificationRequest,
  type VerificationFailure,
  type VerifiedTransfer,
} from './verification.js';

/**
 * The TEST payment protocol.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  What this is for. A developer must be able to integrate and exercise a
 *  paid endpoint without acquiring testnet USDC, running a wallet, or waiting
 *  on block times. That is the difference between a five-minute first
 *  integration and an afternoon of yak-shaving.
 *
 *  What it is NOT. It is not a second payment domain. The tempting shortcut —
 *  a simulator that writes `status = CONFIRMED` and skips verification —
 *  would make the TEST path prove nothing, leaving expiry, replay protection,
 *  state-machine legality, and exactly-once payment creation untested until
 *  real money was already moving.
 *
 *  So this adapter drives the *real* `authorizePayment` pipeline. A TEST
 *  payment goes through the real expiry check, the real proof-shape and nonce
 *  checks, the real amount/recipient/asset/chain comparisons, the real
 *  ReplayGuard backed by the real UNIQUE (chain_id, transaction_hash)
 *  constraint, and the real state machine.
 *
 *  Honest limitation. The settlement evidence is synthesised from the
 *  PaymentRequest rather than read from a chain, so the amount and recipient
 *  comparisons inside authorization are trivially satisfied here. Those
 *  comparisons are exhaustively unit-tested elsewhere against hand-built
 *  receipts (wrong recipient, wrong amount, wrong asset, wrong network,
 *  reverted, spoofed logs). What TEST mode proves is the surrounding
 *  machinery; what those tests prove is the comparison logic. Phase 3 swaps
 *  `SimulatedSettlementVerifier` for `Erc20SettlementVerifier` and the rest of
 *  the path is already exercised.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const TEST_PROTOCOL = 'test';

/** Client -> server header carrying a TEST settlement reference. */
export const TEST_PAYMENT_HEADER = 'meter402-payment';

/** Cap before decoding. Same reasoning as the x402 header bound. */
const MAX_HEADER_BYTES = 4096;

/**
 * Derive the settlement reference for a payment request.
 *
 * Two properties, both load-bearing:
 *
 *  - **Deterministic.** The same request always yields the same reference, so
 *    a repeated completion presents the same value, the replay guard
 *    recognises it as already bound to *this* request, and the whole operation
 *    is idempotent rather than a duplicate-payment attempt.
 *
 *  - **Unforgeable.** Keyed with a server-side secret, so an agent that knows
 *    the request ID and nonce (both public, they are in the challenge) still
 *    cannot mint a reference without calling the simulator. Without the key
 *    this would be a public hash of public inputs, and "complete the payment"
 *    would reduce to "compute a SHA of two values you already have".
 *
 * The output is a 32-byte hex string so it satisfies the same structural
 * validation as a real transaction hash and flows through the identical code
 * path.
 */
export function deriveSimulatedReference(
  secret: string,
  paymentRequestId: string,
  nonce: string,
): string {
  if (secret.length < 32) {
    throw new Meter402Error(
      'INTERNAL_ERROR',
      'The simulated settlement secret is too short to be safe.',
    );
  }
  const digest = createHmac('sha256', secret)
    .update(`meter402:test-settlement:v1:${paymentRequestId}:${nonce}`, 'utf8')
    .digest('hex');
  return `0x${digest}`;
}

function referencesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(provided.toLowerCase(), 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * A `SettlementVerifier` that reports a simulated settlement.
 *
 * Constructed for one specific payment request, and refuses any reference
 * other than the one the simulator would have issued for it. That check is the
 * non-trivial part: it is what makes "the agent must actually have completed
 * the TEST payment" enforceable rather than assumed.
 */
export class SimulatedSettlementVerifier implements SettlementVerifier {
  constructor(
    private readonly expectedReference: string,
    private readonly payerReference: string,
  ) {}

  async verifyTransfer(
    request: TransferVerificationRequest,
  ): Promise<Result<VerifiedTransfer, VerificationFailure>> {
    if (!referencesMatch(this.expectedReference, request.transactionHash)) {
      // The caller presented something the simulator never issued.
      return err(
        verificationFailure(
          'TRANSACTION_NOT_FOUND',
          'No simulated settlement matches this reference.',
        ),
      );
    }

    return ok({
      transactionHash: request.transactionHash.toLowerCase(),
      chainId: request.chainId,
      tokenAddress: request.tokenAddress,
      from: this.payerReference,
      to: request.expectedRecipient,
      minorUnits: request.expectedMinorUnits,
      // Synthetic but plausible: a simulated settlement is immediately final,
      // which is the behaviour a developer wants from a simulator.
      blockNumber: 0n,
      blockHash: `0x${'0'.repeat(64)}`,
      confirmations: request.requiredConfirmations,
      logIndex: 0,
      observedAt: new Date(),
    });
  }
}

interface TestProofPayload {
  readonly paymentRequestId: string;
  readonly reference: string;
  readonly payer?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class TestPaymentProtocolAdapter implements PaymentProtocolAdapter {
  readonly protocol = TEST_PROTOCOL;

  createChallenge(request: PaymentRequest): PaymentChallenge {
    if (request.environment !== MerchantEnvironment.Test) {
      /*
       * Structural confinement. The TEST adapter refuses to describe a LIVE
       * payment at all, so a misrouted adapter cannot produce a challenge that
       * the TEST simulator would then be willing to settle.
       */
      throw new Meter402Error(
        'SIMULATOR_LIVE_FORBIDDEN',
        'The TEST payment protocol cannot issue a challenge for a LIVE payment request.',
      );
    }

    const chain = findChainById(request.chainId);
    if (!chain) {
      throw new Meter402Error(
        'INTERNAL_ERROR',
        `Payment request references unregistered chain ${request.chainId}.`,
      );
    }

    return {
      paymentRequestId: request.id,
      protocol: TEST_PROTOCOL,
      scheme: 'simulated',
      // A string, never a JSON number: a JSON number is a double.
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
      metadata: { simulated: true },
    };
  }

  buildChallengeResponse(challenge: PaymentChallenge): ProtocolHttpResponse {
    return {
      status: 402,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // A cached 402 is a replayable payment instruction.
        'cache-control': 'no-store',
      },
      /*
       * A protocol-neutral body. Deliberately NOT x402's `accepts` shape:
       * Phase 2 must not freeze the product around a wire format whose
       * conformance is still unverified. Phase 3 maps x402 onto the same
       * internal PaymentChallenge; this is simply a different rendering of it.
       */
      body: {
        error: 'PAYMENT_REQUIRED',
        message: 'This resource requires payment. Complete the payment and retry.',
        payment: {
          paymentRequestId: challenge.paymentRequestId,
          protocol: challenge.protocol,
          scheme: challenge.scheme,
          amount: challenge.amountMinorUnits,
          asset: challenge.asset,
          chain: challenge.chain,
          recipient: challenge.recipient,
          expiresAt: challenge.expiresAt,
          simulated: true,
        },
        instructions: {
          complete: `POST /v1/test/payment-requests/${challenge.paymentRequestId}/complete`,
          retryWith: `${TEST_PAYMENT_HEADER}: <base64 of {"paymentRequestId","reference"}>`,
        },
      },
    };
  }

  parsePaymentProof(input: ParseProofInput): Result<PaymentProof, VerificationFailure> {
    const raw = readHeader(input.headers, TEST_PAYMENT_HEADER);
    if (raw === null) {
      return err(verificationFailure('MALFORMED_PROOF', `Missing ${TEST_PAYMENT_HEADER} header.`));
    }
    if (raw === 'DUPLICATED') {
      // Which value a proxy forwards versus which we read is the ambiguity
      // request-smuggling attacks exploit.
      return err(
        verificationFailure('MALFORMED_PROOF', `Multiple ${TEST_PAYMENT_HEADER} headers.`),
      );
    }
    if (raw.length > MAX_HEADER_BYTES) {
      return err(verificationFailure('MALFORMED_PROOF', 'Payment header is too large.'));
    }

    let decoded: string;
    try {
      const buffer = Buffer.from(raw, 'base64');
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_HEADER_BYTES) {
        return err(verificationFailure('MALFORMED_PROOF', 'Payment header is not valid base64.'));
      }
      decoded = buffer.toString('utf8');
    } catch {
      return err(verificationFailure('MALFORMED_PROOF', 'Payment header is not valid base64.'));
    }

    let parsed: unknown;
    try {
      // Drop prototype-polluting keys, matching the x402 parser.
      parsed = JSON.parse(decoded, (key, value: unknown) =>
        key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
      );
    } catch {
      return err(verificationFailure('MALFORMED_PROOF', 'Payment header is not valid JSON.'));
    }

    if (!isRecord(parsed)) {
      return err(verificationFailure('MALFORMED_PROOF', 'Payment payload is not an object.'));
    }

    const paymentRequestId = readString(parsed, 'paymentRequestId');
    const reference = readString(parsed, 'reference');
    if (!paymentRequestId || !reference) {
      return err(
        verificationFailure(
          'MALFORMED_PROOF',
          'Payment payload must carry paymentRequestId and reference.',
        ),
      );
    }

    const payload: TestProofPayload = {
      paymentRequestId,
      reference,
      ...(readString(parsed, 'payer') ? { payer: readString(parsed, 'payer')! } : {}),
    };

    return ok({
      protocol: TEST_PROTOCOL,
      transactionHash: reference,
      payer: payload.payer ?? null,
      nonce: readString(parsed, 'nonce'),
      raw: { ...payload },
    });
  }

  validatePaymentProof(
    proof: PaymentProof,
    challenge: PaymentChallenge,
  ): Result<void, VerificationFailure> {
    if (proof.protocol !== TEST_PROTOCOL) {
      return err(verificationFailure('MALFORMED_PROOF', 'Expected a TEST payment proof.'));
    }

    const claimedRequestId = proof.raw['paymentRequestId'];
    if (typeof claimedRequestId === 'string' && claimedRequestId !== challenge.paymentRequestId) {
      /*
       * A proof minted for one payment request presented against another.
       * Caught here as well as by the nonce binding and the reference
       * derivation, because this is the substitution attack the whole design
       * is guarding against and one check is not enough for it.
       */
      return err(
        verificationFailure(
          'MALFORMED_PROOF',
          'This proof was issued for a different payment request.',
        ),
      );
    }

    if (proof.nonce !== null && proof.nonce !== challenge.nonce) {
      return err(
        verificationFailure('MALFORMED_PROOF', 'The proof does not match this challenge.'),
      );
    }

    return ok(undefined);
  }

  /**
   * Delegates to the shared authorization pipeline — the same one x402 uses.
   *
   * Every protocol inherits identical replay protection, expiry handling, and
   * outage semantics rather than each adapter growing its own subtly different
   * version.
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
    return {
      status: 200,
      headers: {
        'meter402-payment-response': Buffer.from(
          JSON.stringify({
            success: true,
            paymentRequestId: input.request.id,
            reference: input.transfer.transactionHash,
            receiptId: input.receiptId,
            simulated: true,
          }),
          'utf8',
        ).toString('base64'),
      },
      body: {
        success: true,
        receiptId: input.receiptId,
        simulated: true,
      },
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
        error: 'PAYMENT_INVALID',
        reason: failure.reason,
        message: failure.message,
        ...(challenge ? { payment: { paymentRequestId: challenge.paymentRequestId } } : {}),
      },
    };
  }

  createReceiptMetadata(input: ReceiptMetadataInput): Readonly<Record<string, unknown>> {
    const chain = findChainById(input.request.chainId);
    return {
      protocol: TEST_PROTOCOL,
      scheme: 'simulated',
      // Prominent, because a receipt that does not say it is simulated is a
      // receipt someone will eventually reconcile as real revenue.
      simulated: true,
      network: chain?.slug ?? String(input.request.chainId),
      chainId: input.request.chainId,
      reference: input.transfer.transactionHash,
      payer: input.transfer.from,
      recipient: input.transfer.to,
      asset: input.request.assetSymbol,
      amountMinorUnits: input.transfer.minorUnits.toString(),
    };
  }
}

/** Case-insensitive single-value header read. Returns 'DUPLICATED' on repeats. */
function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null | 'DUPLICATED' {
  const target = name.toLowerCase();
  let found: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(value)) {
      if (value.length > 1 || found !== undefined) return 'DUPLICATED';
      found = value[0];
      continue;
    }
    if (value === undefined) continue;
    if (found !== undefined) return 'DUPLICATED';
    found = value;
  }
  return found ?? null;
}

/**
 * Guard used by every simulator entry point.
 *
 * Kept here, beside the adapter, so there is one place to read when asking
 * "can the simulator touch LIVE?" — rather than a condition repeated across
 * handlers where one copy can drift.
 */
export function assertSimulatableRequest(request: PaymentRequest, now: Date = new Date()): void {
  if (request.environment !== MerchantEnvironment.Test) {
    throw new Meter402Error(
      'SIMULATOR_LIVE_FORBIDDEN',
      'The TEST payment simulator cannot be used on a LIVE payment request.',
      { details: { environment: request.environment } },
    );
  }
  if (isExpired(request, now)) {
    throw new Meter402Error('PAYMENT_EXPIRED', 'This payment request has expired.', {
      details: { expiresAt: request.expiresAt.toISOString() },
    });
  }
}
