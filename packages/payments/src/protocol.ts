import type { Result } from '@meter402/shared';
import type { PaymentStatus } from './status.js';
import type { PaymentRequest } from './payment-request.js';
import type {
  ReplayGuard,
  SettlementVerifier,
  VerificationFailure,
  VerifiedTransfer,
} from './verification.js';

/**
 * PaymentProtocolAdapter — the seam that keeps Meter402 from being an x402
 * company (product rules 9 and 30).
 *
 * x402 is the first machine-payment protocol with traction, but it will not be
 * the last; MPP and AP2 are already circling. Every piece of protocol-specific
 * encoding — header names, challenge shape, proof format — lives behind this
 * interface. Application code depends on `PaymentProtocolAdapter`, never on
 * `X402Adapter`, so adding a protocol is a new implementation rather than a
 * migration.
 *
 * The test for whether this boundary is holding: grep the API app for "x402".
 * It should appear only where an adapter is selected, never where a payment is
 * processed.
 */

export interface ProtocolHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** The machine-readable payment instruction served with a 402 (rule 26). */
export interface PaymentChallenge {
  readonly paymentRequestId: string;
  readonly protocol: string;
  /** Protocol-specific settlement scheme, e.g. "exact" for an exact-amount transfer. */
  readonly scheme: string;
  /** Minor units as a decimal string — never a JSON number, which is a double. */
  readonly amountMinorUnits: string;
  readonly asset: {
    readonly symbol: string;
    readonly address: string;
    readonly decimals: number;
  };
  readonly chain: {
    readonly id: number;
    readonly slug: string;
  };
  readonly recipient: string;
  readonly nonce: string;
  /** RFC 3339 UTC. */
  readonly expiresAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** What an agent sends back to claim it has paid. */
export interface PaymentProof {
  readonly protocol: string;
  readonly transactionHash: string;
  readonly payer: string | null;
  readonly nonce: string | null;
  /** The undecoded proof, retained for audit and dispute resolution. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ParseProofInput {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

export interface VerifyPaymentInput {
  readonly request: PaymentRequest;
  readonly proof: PaymentProof;
  readonly verifier: SettlementVerifier;
  readonly replayGuard: ReplayGuard;
  readonly requiredConfirmations: number;
  readonly now?: Date;
}

export interface BuildSuccessInput {
  readonly request: PaymentRequest;
  readonly transfer: VerifiedTransfer;
  readonly receiptId: string;
}

export interface ReceiptMetadataInput {
  readonly request: PaymentRequest;
  readonly transfer: VerifiedTransfer;
}

/**
 * The decision returned by verification, together with the status the payment
 * should move to. The adapter recommends; the caller performs the transition
 * through `assertTransition`, so the state machine stays the single authority.
 */
export interface PaymentAuthorization {
  readonly decision: 'AUTHORIZED' | 'PENDING' | 'REJECTED';
  readonly nextStatus: PaymentStatus;
  readonly transfer: VerifiedTransfer | null;
  readonly failure: VerificationFailure | null;
}

export interface PaymentProtocolAdapter {
  /** Stable protocol identifier, e.g. "x402". Appears in challenges and receipts. */
  readonly protocol: string;

  createChallenge(request: PaymentRequest): PaymentChallenge;

  /** Render the challenge as the HTTP response the protocol specifies. */
  buildChallengeResponse(challenge: PaymentChallenge): ProtocolHttpResponse;

  /** Decode a proof from request headers/body. Offline and total — never throws. */
  parsePaymentProof(input: ParseProofInput): Result<PaymentProof, VerificationFailure>;

  /** Structural checks only: shape, nonce binding. No network access. */
  validatePaymentProof(
    proof: PaymentProof,
    challenge: PaymentChallenge,
  ): Result<void, VerificationFailure>;

  /** Full verification against the chain, including replay protection. */
  verifyPayment(input: VerifyPaymentInput): Promise<PaymentAuthorization>;

  buildSuccessResponse(input: BuildSuccessInput): ProtocolHttpResponse;

  buildFailureResponse(
    failure: VerificationFailure,
    challenge?: PaymentChallenge,
  ): ProtocolHttpResponse;

  createReceiptMetadata(input: ReceiptMetadataInput): Readonly<Record<string, unknown>>;
}

/**
 * Registry of available protocols. The API resolves an adapter per endpoint,
 * which is what will let a merchant serve x402 and a future protocol from the
 * same endpoint during a migration window.
 */
export class PaymentProtocolRegistry {
  private readonly adapters = new Map<string, PaymentProtocolAdapter>();

  constructor(adapters: readonly PaymentProtocolAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: PaymentProtocolAdapter): void {
    if (this.adapters.has(adapter.protocol)) {
      throw new Error(`Protocol ${adapter.protocol} is already registered`);
    }
    this.adapters.set(adapter.protocol, adapter);
  }

  get(protocol: string): PaymentProtocolAdapter | undefined {
    return this.adapters.get(protocol);
  }

  list(): readonly string[] {
    return [...this.adapters.keys()];
  }
}
