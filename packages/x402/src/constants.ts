/**
 * x402 v2 wire constants.
 *
 * Every value here was verified against the official reference implementation
 * (`@x402/core@2.24.0`, `@x402/evm@2.24.0`) rather than transcribed from
 * prose. See docs/X402_V2_CONFORMANCE_PLAN.md for the evidence.
 *
 * This package is the ONLY place in Meter402 that knows x402 wire format. The
 * test for whether that boundary is holding: grep the API app for "x402" — it
 * should appear where an adapter is selected, never where a payment is
 * processed.
 */

export const X402_PROTOCOL = 'x402';

/**
 * The protocol version this adapter speaks.
 *
 * Exactly 2. A v1 payload is rejected, never reinterpreted: v1 and v2 differ
 * in ways that are silently compatible in the wrong direction — v1's
 * `maxAmountRequired` is absent in v2, and v1 network slugs (`"base-sepolia"`)
 * would parse as neither valid nor obviously invalid CAIP-2. Accepting both
 * through one code path is how a payer ends up bound to a requirement the
 * server never issued. Backward compatibility, if ever wanted, is a separate
 * versioned adapter.
 */
export const X402_VERSION = 2;

/** Server -> client, alongside the 402 body. Base64 JSON `PaymentRequired`. */
export const PAYMENT_REQUIRED_HEADER = 'payment-required';
/** Client -> server. Base64 JSON `PaymentPayload`. */
export const PAYMENT_SIGNATURE_HEADER = 'payment-signature';
/** Server -> client on success. Base64 JSON `SettleResponse`. */
export const PAYMENT_RESPONSE_HEADER = 'payment-response';

/** The only settlement scheme Meter402 implements. */
export const SCHEME_EXACT = 'exact';

/**
 * The EVM asset transfer method for the exact scheme: EIP-3009
 * `transferWithAuthorization`. The payer signs; the facilitator submits.
 * Meter402 never holds a key that can move payer funds.
 */
export const ASSET_TRANSFER_METHOD_EIP3009 = 'eip3009';

/**
 * Cap on the decoded `PAYMENT-SIGNATURE` header.
 *
 * A real payload, measured from the official client, is ~1 KiB. 8 KiB is
 * generous for a legitimate caller and still bounds the work an unauthenticated
 * request can force: without a limit, an attacker makes the server allocate and
 * JSON-parse an arbitrarily large buffer on every request.
 */
export const MAX_PAYMENT_HEADER_BYTES = 8 * 1024;

/**
 * Cap on the base64 text before decoding.
 *
 * Checked first, so an oversized header is refused without ever being decoded.
 * Base64 expands by 4/3, plus room for padding and any transfer encoding.
 */
export const MAX_PAYMENT_HEADER_ENCODED_BYTES = Math.ceil(MAX_PAYMENT_HEADER_BYTES * (4 / 3)) + 64;

/** A 65-byte secp256k1 signature, hex-encoded with the 0x prefix. */
export const SIGNATURE_HEX_LENGTH = 2 + 130;

/** EIP-3009 authorization nonces are 32 bytes. */
export const NONCE_HEX_LENGTH = 2 + 64;
