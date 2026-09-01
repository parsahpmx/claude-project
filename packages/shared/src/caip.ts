import { findChainById, type ChainDescriptor } from './assets.js';

/**
 * CAIP-2 chain identifiers.
 *
 * CAIP-2 ("chain_namespace:chain_reference") is a chain-agnostic standard, not
 * an x402 invention — x402 v2 happens to use it, and so will most protocols
 * that follow. It therefore lives here in shared rather than in the x402
 * adapter: the identifier for "Base Sepolia" should not be owned by whichever
 * payment protocol happened to need it first.
 *
 * The domain continues to key chains by numeric `chainId`. This module is the
 * translation at the edge, in both directions, and it is deliberately total:
 * an unregistered chain yields `undefined` rather than a plausible-looking
 * string for a chain we do not support.
 */

/** The only namespace Meter402 supports. EVM chains, per CAIP-2. */
export const EIP155_NAMESPACE = 'eip155';

export type Caip2ChainId = `${string}:${string}`;

/**
 * Strict CAIP-2 syntax: a namespace and a reference, each bounded.
 *
 * Bounded because this pattern is applied to attacker-supplied strings; an
 * unbounded `.+` on both sides of a colon is a cheap way to make a regex
 * engine do more work than it should.
 */
const CAIP2_PATTERN = /^([a-z0-9]{3,8}):([a-zA-Z0-9]{1,32})$/;

export interface ParsedCaip2 {
  readonly namespace: string;
  readonly reference: string;
}

/** Split a CAIP-2 identifier without interpreting it. Returns null if malformed. */
export function parseCaip2(value: string): ParsedCaip2 | null {
  const match = CAIP2_PATTERN.exec(value.trim());
  if (!match) return null;
  const namespace = match[1];
  const reference = match[2];
  /* istanbul ignore next -- both groups are required by the pattern. */
  if (namespace === undefined || reference === undefined) return null;
  return { namespace, reference };
}

/** The CAIP-2 identifier for a registered EVM chain. */
export function toCaip2(chainId: number): Caip2ChainId {
  return `${EIP155_NAMESPACE}:${chainId}`;
}

/**
 * Resolve a CAIP-2 identifier to a chain this server actually supports.
 *
 * Returns undefined for anything unregistered, malformed, in another
 * namespace, or numerically odd. In particular a leading zero or a `+` sign is
 * refused rather than normalised: `eip155:084532` and `eip155:84532` must not
 * both resolve, or a comparison made on the string form could disagree with
 * one made on the numeric form.
 */
export function chainFromCaip2(value: string): ChainDescriptor | undefined {
  const parsed = parseCaip2(value);
  if (!parsed || parsed.namespace !== EIP155_NAMESPACE) return undefined;
  if (!/^[1-9][0-9]*$/.test(parsed.reference)) return undefined;

  const chainId = Number(parsed.reference);
  if (!Number.isSafeInteger(chainId)) return undefined;
  return findChainById(chainId);
}

/** True when the identifier names a chain this server supports. */
export function isSupportedCaip2(value: string): boolean {
  return chainFromCaip2(value) !== undefined;
}
