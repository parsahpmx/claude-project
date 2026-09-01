import { Meter402Error, findAsset, toCaip2, type TokenAsset } from '@meter402/shared';
import type { PaymentRequest } from '@meter402/payments';
import { ASSET_TRANSFER_METHOD_EIP3009, SCHEME_EXACT, X402_VERSION } from './constants.js';
import type { X402PaymentRequired, X402PaymentRequirements, X402ResourceInfo } from './wire.js';

/**
 * Domain -> wire mapping.
 *
 * One direction only, and one source: everything below is derived from the
 * stored `PaymentRequest` and the server's own asset registry. No argument to
 * these functions comes from a client, which is what makes the resulting 402
 * a statement of what the server will accept rather than a repetition of what
 * someone asked for.
 */

export interface PaymentRequiredInput {
  readonly request: PaymentRequest;
  /** Absolute URL of the paid resource. */
  readonly resourceUrl: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/**
 * Look up the asset a request is denominated in, from the trusted registry.
 *
 * Deliberately keyed on `(symbol, chainId)` from the request snapshot rather
 * than on the address stored alongside it: the registry is the authority on
 * which contract is USDC, and re-deriving the address here means a tampered
 * `asset_address` column could not redirect a payment to a lookalike token.
 */
export function resolveTrustedAsset(request: PaymentRequest): TokenAsset {
  const asset = findAsset(request.assetSymbol, request.chainId);
  if (!asset) {
    throw new Meter402Error(
      'INTERNAL_ERROR',
      `Payment request references asset ${request.assetSymbol} which is not registered on chain ${request.chainId}.`,
    );
  }
  if (!asset.supportsEip3009) {
    throw new Meter402Error(
      'INVALID_PRICE',
      `Asset ${asset.symbol} does not support signed-authorization transfers and cannot be used with the x402 exact scheme.`,
    );
  }
  return asset;
}

/** The single `accepts` entry Meter402 offers for a payment request. */
export function toPaymentRequirements(request: PaymentRequest): X402PaymentRequirements {
  const asset = resolveTrustedAsset(request);

  /*
   * The validity window offered to the payer. Derived from the request's own
   * deadline rather than a fixed constant, so the signed authorization cannot
   * outlive the PaymentRequest it pays for. Floored at one second: a
   * requirement that has already expired is not worth serving.
   */
  const secondsRemaining = Math.floor((request.expiresAt.getTime() - Date.now()) / 1000);
  const maxTimeoutSeconds = Math.max(1, secondsRemaining);

  return {
    scheme: SCHEME_EXACT,
    network: toCaip2(request.chainId),
    // From the registry, not from the request row.
    asset: asset.address,
    // BigInt -> string. Never through Number.
    amount: request.amountMinorUnits.toString(),
    payTo: request.recipientAddress,
    maxTimeoutSeconds,
    extra: {
      /*
       * The EIP-712 domain the token contract signs under. The payer needs it
       * to build the digest, and it is a property of the deployed contract —
       * Base Sepolia USDC signs as "USDC" while Base mainnet USDC signs as
       * "USD Coin", so it cannot be derived from the symbol.
       */
      name: asset.eip712.name,
      version: asset.eip712.version,
      assetTransferMethod: ASSET_TRANSFER_METHOD_EIP3009,
    },
  };
}

export function toPaymentRequired(input: PaymentRequiredInput): X402PaymentRequired {
  const resource: X402ResourceInfo = {
    url: input.resourceUrl,
    ...(input.description ? { description: input.description } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
  };

  return {
    x402Version: X402_VERSION,
    resource,
    accepts: [toPaymentRequirements(input.request)],
  };
}
