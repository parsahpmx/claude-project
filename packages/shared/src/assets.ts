/**
 * Chain and asset registry.
 *
 * Meter402's MVP settles USDC on Base. This registry is the only place chain
 * IDs and token contract addresses are written down, so adding Solana or
 * Arbitrum later is a data change here rather than a search-and-replace
 * through payment code.
 *
 * The `assertChainAllowedForEnvironment` guard below implements product rule
 * 14 — a TEST-mode project must never be able to produce a mainnet payment
 * instruction. That rule is enforced structurally rather than by convention,
 * because "we'll remember not to" is not a control.
 */

import { MerchantEnvironment } from './environment.js';

export type HexAddress = `0x${string}`;

export interface ChainDescriptor {
  readonly id: number;
  readonly name: string;
  /** Stable slug used in APIs and webhooks. Never renamed once shipped. */
  readonly slug: string;
  readonly isTestnet: boolean;
  readonly blockExplorerTxUrl: (txHash: string) => string;
  /**
   * Confirmations at which we treat a transfer as economically final for
   * ordinary payment sizes. See docs/PAYMENTS.md on reorg handling.
   */
  readonly defaultConfirmations: number;
}

export const BASE_MAINNET: ChainDescriptor = {
  id: 8453,
  name: 'Base',
  slug: 'base',
  isTestnet: false,
  blockExplorerTxUrl: (txHash) => `https://basescan.org/tx/${txHash}`,
  defaultConfirmations: 3,
};

export const BASE_SEPOLIA: ChainDescriptor = {
  id: 84532,
  name: 'Base Sepolia',
  slug: 'base-sepolia',
  isTestnet: true,
  blockExplorerTxUrl: (txHash) => `https://sepolia.basescan.org/tx/${txHash}`,
  defaultConfirmations: 1,
};

export const CHAINS: readonly ChainDescriptor[] = Object.freeze([BASE_MAINNET, BASE_SEPOLIA]);

export function findChainById(chainId: number): ChainDescriptor | undefined {
  return CHAINS.find((chain) => chain.id === chainId);
}

export function findChainBySlug(slug: string): ChainDescriptor | undefined {
  return CHAINS.find((chain) => chain.slug === slug);
}

export interface TokenAsset {
  /** Ticker used in APIs and challenges, e.g. "USDC". */
  readonly symbol: string;
  readonly name: string;
  /** Smallest-unit exponent. USDC is 6, so 1 USDC === 1_000_000 minor units. */
  readonly decimals: number;
  readonly chainId: number;
  readonly address: HexAddress;
}

/**
 * USDC contract addresses. These are consensus-critical constants: paying the
 * wrong contract means paying a different token, so they are checked against
 * the official Circle deployment list rather than copied from a block explorer
 * search result.
 */
export const USDC_BASE_MAINNET: TokenAsset = {
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: BASE_MAINNET.id,
  address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};

export const USDC_BASE_SEPOLIA: TokenAsset = {
  symbol: 'USDC',
  name: 'USD Coin (Base Sepolia)',
  decimals: 6,
  chainId: BASE_SEPOLIA.id,
  address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
};

export const SUPPORTED_ASSETS: readonly TokenAsset[] = Object.freeze([
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
]);

export function findAsset(symbol: string, chainId: number): TokenAsset | undefined {
  const upper = symbol.toUpperCase();
  return SUPPORTED_ASSETS.find((asset) => asset.symbol === upper && asset.chainId === chainId);
}

/**
 * Lowercase an EVM address for comparison.
 *
 * Addresses arrive from RPC responses, merchant config, and agent-supplied
 * proofs in inconsistent casing (EIP-55 checksummed or not). Comparing raw
 * strings is a real source of false "wrong recipient" rejections, so all
 * address equality in this codebase goes through `addressesEqual`.
 */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function addressesEqual(left: string, right: string): boolean {
  return normalizeAddress(left) === normalizeAddress(right);
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(address: string): address is HexAddress {
  return ADDRESS_PATTERN.test(address.trim());
}

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function isValidTransactionHash(hash: string): boolean {
  return TX_HASH_PATTERN.test(hash.trim());
}

export class EnvironmentChainMismatchError extends Error {
  constructor(
    readonly environment: MerchantEnvironment,
    readonly chainId: number,
  ) {
    super(
      `Environment ${environment} cannot transact on chain ${chainId}. ` +
        `TEST projects are restricted to testnets and LIVE projects to mainnets.`,
    );
    this.name = 'EnvironmentChainMismatchError';
  }
}

/**
 * Hard separation between TEST and LIVE (product rule 14).
 *
 * A TEST project may only ever be pointed at a testnet chain, and a LIVE
 * project only at a mainnet chain. Every path that turns a merchant's
 * configuration into a payment instruction calls this first.
 */
export function assertChainAllowedForEnvironment(
  chainId: number,
  environment: MerchantEnvironment,
): ChainDescriptor {
  const chain = findChainById(chainId);
  if (!chain) {
    throw new EnvironmentChainMismatchError(environment, chainId);
  }
  const wantsTestnet = environment === MerchantEnvironment.Test;
  if (chain.isTestnet !== wantsTestnet) {
    throw new EnvironmentChainMismatchError(environment, chainId);
  }
  return chain;
}
