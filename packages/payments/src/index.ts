/**
 * @meter402/payments
 *
 * The payment domain: what a payment request is, the states it may occupy, how
 * a claimed payment is authorized, and the protocol-agnostic adapter interface
 * that keeps x402 from leaking into the rest of the platform.
 *
 * This package deliberately has no I/O dependencies — no database, no HTTP, no
 * RPC client. Everything it needs is injected. That is what makes the
 * authorization pipeline exhaustively testable.
 */

export * from './status.js';
export * from './payment-request.js';
export * from './verification.js';
export * from './protocol.js';
export * from './authorization.js';
