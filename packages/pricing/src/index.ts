/**
 * @meter402/pricing
 *
 * The pricing engine answers exactly one question: given an endpoint and an
 * incoming request, what must the caller pay?
 *
 * It is a strategy pattern (product rule 22) because pricing is the axis we
 * expect to change most: today every endpoint is a flat per-request price, but
 * inference providers price per token, GPU providers per second, and data
 * providers by volume tier. Those belong behind the same interface rather than
 * as `if` branches grown into the payment path.
 *
 * Only `FixedPriceStrategy` is implemented. Rule 22 is explicit that
 * speculative strategies should not be built before a customer needs them —
 * the interface is the extension point, not a directory of stubs.
 */

export * from './types.js';
export * from './fixed-price-strategy.js';
export * from './engine.js';
