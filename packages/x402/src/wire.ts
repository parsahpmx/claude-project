/**
 * x402 v2 wire types.
 *
 * These mirror `@x402/core@2.24.0` exactly and describe **the wire**, not the
 * Meter402 domain. That separation is deliberate and load-bearing (STEP 4):
 * `X402PaymentRequirements` is not an alias of a domain type, and
 * `X402SettleResponse` is not an alias of `Payment`. A protocol revision
 * changes this file and the mapping module; it must not reach the domain.
 *
 * Everything here is `readonly` and every field arriving from a client is
 * typed as it is *received*, not as we wish it were — amounts are strings
 * because the wire carries strings, and they stay strings until a mapping
 * function converts them under explicit validation.
 */

/** CAIP-2, e.g. `eip155:84532`. */
export type X402Network = `${string}:${string}`;

export interface X402ResourceInfo {
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly serviceName?: string;
  readonly tags?: readonly string[];
  readonly iconUrl?: string;
}

/**
 * One acceptable way to pay.
 *
 * `amount` is atomic units as a decimal string. It is never a JSON number:
 * a JSON number is an IEEE-754 double, and USDC amounts above 2^53 minor units
 * would silently lose precision. This is the same rule the domain enforces
 * with BigInt, restated at the wire boundary.
 */
export interface X402PaymentRequirements {
  readonly scheme: string;
  readonly network: X402Network;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  /** For EIP-3009 assets this carries the EIP-712 domain `{ name, version }`. */
  readonly extra: Readonly<Record<string, unknown>>;
}

/** The 402 body. */
export interface X402PaymentRequired {
  readonly x402Version: number;
  readonly error?: string;
  readonly resource: X402ResourceInfo;
  readonly accepts: readonly X402PaymentRequirements[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** EIP-3009 `TransferWithAuthorization` message, as it appears on the wire. */
export interface X402ExactEvmAuthorization {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: string;
}

export interface X402ExactEvmPayload {
  readonly authorization: X402ExactEvmAuthorization;
  readonly signature: string;
}

/**
 * What the client sends back.
 *
 * Note `accepted`: the client echoes the requirement it chose. It is
 * **evidence of what the client believed**, never a statement of what is owed.
 * Meter402 compares it against the stored PaymentRequest and rejects any
 * divergence — see `binding.ts`.
 */
export interface X402PaymentPayload {
  readonly x402Version: number;
  readonly resource?: X402ResourceInfo;
  readonly accepted: X402PaymentRequirements;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** Facilitator request bodies. */
export interface X402VerifyRequest {
  readonly x402Version: number;
  readonly paymentPayload: X402PaymentPayload;
  readonly paymentRequirements: X402PaymentRequirements;
}

export type X402SettleRequest = X402VerifyRequest;

export interface X402VerifyResponse {
  readonly isValid: boolean;
  readonly invalidReason?: string;
  readonly invalidMessage?: string;
  readonly payer?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface X402SettleResponse {
  readonly success: boolean;
  readonly errorReason?: string;
  readonly errorMessage?: string;
  readonly payer?: string;
  /** The settlement transaction hash. Empty string when settlement failed. */
  readonly transaction: string;
  readonly network: X402Network;
  /** Present for schemes where the settled amount may differ from the maximum. */
  readonly amount?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface X402SupportedKind {
  readonly x402Version: number;
  readonly scheme: string;
  readonly network: X402Network;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface X402SupportedResponse {
  readonly kinds: readonly X402SupportedKind[];
  readonly extensions: readonly string[];
  readonly signers: Readonly<Record<string, readonly string[]>>;
}
