import { keccak256, toHex } from 'viem';
import { ok, err, type Result } from '@meter402/shared';
import type {
  FacilitatorClient,
  FacilitatorError,
  FacilitatorRequest,
  X402SettleResponse,
  X402SupportedResponse,
  X402VerifyResponse,
} from '@meter402/x402';

/**
 * A controllable facilitator, for integration tests.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **This is a test double, not a conformance oracle.** It proves that
 * Meter402 drives the flow correctly and reacts correctly to each answer a
 * facilitator can give — including the answers that are hard to provoke
 * against a real one, like a timeout mid-settlement or a report naming the
 * wrong network.
 *
 * It emphatically does NOT prove interoperability with a real facilitator, and
 * no test using it may be described that way. Real facilitator verification is
 * an open item; see docs/X402_V2_CONFORMANCE_PLAN.md §9.
 * ─────────────────────────────────────────────────────────────────────────
 */
export class FakeFacilitator implements FacilitatorClient {
  /** Every settle call, in order. Lets a test assert none happened. */
  readonly settleCalls: FacilitatorRequest[] = [];
  readonly verifyCalls: FacilitatorRequest[] = [];

  verifyResult: 'VALID' | 'INVALID' | 'UNAVAILABLE' = 'VALID';
  settleResult: 'SUCCESS' | 'FAILED' | 'UNAVAILABLE' | 'MALFORMED' = 'SUCCESS';
  /** Overrides the network the settle response claims. */
  settleNetworkOverride: string | null = null;
  /** Overrides the amount the settle response claims. */
  settleAmountOverride: string | null = null;
  /** Overrides the payer the verify response claims. */
  verifyPayerOverride: string | null = null;
  /**
   * Whether the facilitator answers a health probe at all.
   *
   * Separate from `verifyResult` because reachability and verdict are separate
   * in reality: a facilitator can be up and rejecting authorizations, or down
   * while the last verdict it gave was fine.
   */
  healthy = true;

  async verify(request: FacilitatorRequest): Promise<Result<X402VerifyResponse, FacilitatorError>> {
    this.verifyCalls.push(request);

    if (this.verifyResult === 'UNAVAILABLE') {
      return err({ kind: 'UNAVAILABLE', message: 'facilitator unreachable' });
    }
    if (this.verifyResult === 'INVALID') {
      return ok({
        isValid: false,
        invalidReason: 'invalid_exact_evm_payload_signature',
        invalidMessage: 'signature rejected by facilitator',
      });
    }

    const payer = this.payerOf(request);
    return ok({
      isValid: true,
      ...((this.verifyPayerOverride ?? payer) ? { payer: this.verifyPayerOverride ?? payer } : {}),
    } as X402VerifyResponse);
  }

  async settle(request: FacilitatorRequest): Promise<Result<X402SettleResponse, FacilitatorError>> {
    this.settleCalls.push(request);

    if (this.settleResult === 'UNAVAILABLE') {
      return err({ kind: 'UNAVAILABLE', message: 'settle timed out' });
    }
    if (this.settleResult === 'MALFORMED') {
      return err({ kind: 'MALFORMED_RESPONSE', message: 'nonsense body' });
    }
    if (this.settleResult === 'FAILED') {
      return ok({
        success: false,
        transaction: '',
        network: request.paymentRequirements.network,
        errorReason: 'insufficient_funds',
        errorMessage: 'payer cannot cover the transfer',
      });
    }

    return ok({
      success: true,
      // Deterministic per authorization, so a retry of the same payment
      // produces the same hash — which is what makes the transaction-replay
      // guard's idempotent path reachable in tests.
      transaction: this.transactionFor(request),
      network: (this.settleNetworkOverride ??
        request.paymentRequirements.network) as `${string}:${string}`,
      payer: this.payerOf(request) ?? undefined,
      ...(this.settleAmountOverride !== null ? { amount: this.settleAmountOverride } : {}),
    } as X402SettleResponse);
  }

  async getSupportedCapabilities(): Promise<Result<X402SupportedResponse, FacilitatorError>> {
    return ok({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }],
      extensions: [],
      signers: {},
    });
  }

  async health(): Promise<boolean> {
    return this.healthy && this.verifyResult !== 'UNAVAILABLE';
  }

  private payerOf(request: FacilitatorRequest): string | null {
    const authorization = request.paymentPayload.payload['authorization'];
    if (typeof authorization !== 'object' || authorization === null) return null;
    const from = (authorization as Record<string, unknown>)['from'];
    return typeof from === 'string' ? from : null;
  }

  private transactionFor(request: FacilitatorRequest): string {
    const authorization = request.paymentPayload.payload['authorization'];
    const nonce =
      typeof authorization === 'object' && authorization !== null
        ? String((authorization as Record<string, unknown>)['nonce'])
        : 'none';
    return keccak256(toHex(`settle:${nonce}`));
  }
}
