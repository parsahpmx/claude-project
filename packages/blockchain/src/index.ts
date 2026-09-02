/**
 * @meter402/blockchain
 *
 * Chain access and settlement verification.
 *
 * Layering, from the network inward:
 *
 *   ViemBlockchainProvider     translates RPC responses into neutral shapes
 *   FailoverBlockchainProvider primary/secondary with per-provider breakers
 *   Erc20SettlementVerifier    decides whether a transfer satisfies a payment
 *
 * Only the first touches the network. Everything that decides whether money
 * was received is pure and unit-tested against constructed receipts.
 */

export * from './types.js';
export * from './erc20.js';
export * from './circuit-breaker.js';
export * from './failover-provider.js';
export * from './transfer-verifier.js';
export * from './viem-provider.js';
export * from './settlement-oracle.js';
