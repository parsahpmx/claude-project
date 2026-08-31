/**
 * x402 wire constants.
 *
 * IMPORTANT — implementation status.
 *
 * This adapter implements the x402 request/response *shape* as described in
 * the public x402 v1 material: a 402 carrying an `accepts` array of payment
 * requirements, a client retry bearing a base64url `X-PAYMENT` header, and an
 * `X-PAYMENT-RESPONSE` header on success.
 *
 * It has NOT been conformance-tested against the published specification or
 * against a third-party x402 client. Before Meter402 advertises x402
 * compatibility publicly, this package must be validated against the spec
 * document and an independent implementation, and any divergence resolved
 * here. That task is tracked in docs/ROADMAP.md under Phase 3.
 *
 * Everything x402-specific is confined to this package precisely so that
 * correcting a wire-format divergence is a change here and nowhere else.
 */

export const X402_PROTOCOL = 'x402';
export const X402_VERSION = 1;

/** Client -> server: the payment payload, base64-encoded JSON. */
export const PAYMENT_HEADER = 'x-payment';
/** Server -> client: the settlement result, base64-encoded JSON. */
export const PAYMENT_RESPONSE_HEADER = 'x-payment-response';

/** The only settlement scheme Meter402 supports today: an exact-amount transfer. */
export const SCHEME_EXACT = 'exact';

/**
 * Cap on the decoded `X-PAYMENT` header.
 *
 * Without a bound, an attacker can make an unauthenticated endpoint allocate
 * and JSON-parse an arbitrarily large buffer on every request. 8 KiB is far
 * more than a legitimate payload — a transaction hash and a few addresses —
 * needs.
 */
export const MAX_PAYMENT_HEADER_BYTES = 8 * 1024;
