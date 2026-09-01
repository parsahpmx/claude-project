import { recoverTypedDataAddress, isAddress, getAddress } from 'viem';
import { addressesEqual, err, ok, type Result, type TokenAsset } from '@meter402/shared';
import { verificationFailure, type VerificationFailure } from '@meter402/payments';
import type { X402ExactEvmPayload } from './wire.js';

/**
 * EIP-3009 `TransferWithAuthorization` signature verification.
 *
 * The cryptography is viem's, not ours (product rule: never invent
 * cryptography). This module's job is to build the *correct typed-data
 * struct* and check that the recovered signer is the address claiming to pay.
 *
 * Why verify locally at all, when the facilitator also verifies? Two reasons:
 *
 *  1. **We are not obliged to trust the facilitator.** It is external
 *     infrastructure, and a compromised or buggy one reporting `isValid: true`
 *     for an unsigned authorization must not be able to make Meter402 serve a
 *     paid resource.
 *  2. **It is free and it is local.** Rejecting a forged signature here costs
 *     no outbound request, which also keeps Meter402 from being used to
 *     amplify traffic at a facilitator.
 */

/**
 * The EIP-712 type definition for EIP-3009.
 *
 * Field order is part of the type hash, so this array is not merely a list of
 * names — reordering it silently changes every digest and every signature
 * fails to recover. Taken from the EIP-3009 specification and cross-checked
 * against the x402 reference implementation's `authorizationTypes`.
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface SignatureCheckInput {
  readonly exact: X402ExactEvmPayload;
  readonly asset: TokenAsset;
  readonly chainId: number;
}

/**
 * Recover the signer and confirm it is the declared payer.
 *
 * Returns the checksummed payer address on success. A signature that recovers
 * to *some* address but not the declared `from` is rejected: that is the
 * signature-confusion case where an attacker replays a valid signature from
 * one payer under another payer's name.
 */
export async function verifyAuthorizationSignature(
  input: SignatureCheckInput,
): Promise<Result<string, VerificationFailure>> {
  const { exact, asset, chainId } = input;
  const authorization = exact.authorization;

  if (!isAddress(authorization.from) || !isAddress(authorization.to)) {
    /* istanbul ignore next -- the parser has already checked address shape. */
    return err(verificationFailure('MALFORMED_PROOF', 'Authorization address is malformed.'));
  }

  const domain = {
    name: asset.eip712.name,
    version: asset.eip712.version,
    chainId,
    verifyingContract: getAddress(asset.address),
  } as const;

  const message = {
    from: getAddress(authorization.from),
    to: getAddress(authorization.to),
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce as `0x${string}`,
  } as const;

  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      domain,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
      signature: exact.signature as `0x${string}`,
    });
  } catch {
    /*
     * A signature that is structurally well-formed but cryptographically
     * unrecoverable (bad `v`, point not on the curve) lands here. Treated as
     * an invalid payment, never as a server error.
     */
    return err(
      verificationFailure('MALFORMED_PROOF', 'The authorization signature could not be recovered.'),
    );
  }

  if (!addressesEqual(recovered, authorization.from)) {
    return err(
      verificationFailure(
        'MALFORMED_PROOF',
        'The authorization signature does not belong to the declared payer.',
        { declared: authorization.from, recovered },
      ),
    );
  }

  return ok(getAddress(recovered));
}
