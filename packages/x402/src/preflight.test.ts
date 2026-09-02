import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@meter402/shared';
import { preflightFacilitator } from './preflight.js';
import type { FacilitatorClient, FacilitatorError } from './facilitator.js';
import type { X402SettleResponse, X402SupportedResponse, X402VerifyResponse } from './wire.js';

/**
 * Startup validation of the facilitator.
 *
 * The distinction under test is the one that matters operationally: a
 * facilitator that cannot do what we need stops the deploy, and a facilitator
 * that merely did not answer does not.
 */

type Supported = Result<X402SupportedResponse, FacilitatorError>;

function facilitatorReturning(supported: Supported): FacilitatorClient {
  return {
    async verify(): Promise<Result<X402VerifyResponse, FacilitatorError>> {
      throw new Error('preflight must not verify');
    },
    async settle(): Promise<Result<X402SettleResponse, FacilitatorError>> {
      throw new Error('preflight must not settle');
    },
    async getSupportedCapabilities() {
      return supported;
    },
    async health() {
      return supported.ok;
    },
  };
}

const baseSepoliaExact = {
  x402Version: 2,
  scheme: 'exact',
  network: 'eip155:84532',
} as const;

describe('preflightFacilitator', () => {
  it('accepts a facilitator that supports exact on the configured network', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(
        ok({ kinds: [baseSepoliaExact], extensions: [], signers: {} }),
      ),
      chainIds: [84532],
    });

    expect(result.status).toBe('OK');
  });

  it('refuses a facilitator that does not support our network', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(
        ok({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      ),
      chainIds: [84532],
    });

    expect(result.status).toBe('INCOMPATIBLE');
    expect(result.status === 'INCOMPATIBLE' && result.message).toContain('eip155:84532');
  });

  it('refuses a facilitator that does not support the exact scheme', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(
        ok({
          kinds: [{ x402Version: 2, scheme: 'upto', network: 'eip155:84532' }],
          extensions: [],
          signers: {},
        }),
      ),
      chainIds: [84532],
    });

    expect(result.status).toBe('INCOMPATIBLE');
  });

  it('refuses a facilitator speaking a different protocol version', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(
        ok({
          kinds: [{ x402Version: 1, scheme: 'exact', network: 'eip155:84532' }],
          extensions: [],
          signers: {},
        }),
      ),
      chainIds: [84532],
    });

    expect(result.status).toBe('INCOMPATIBLE');
  });

  it('treats a non-x402 response as a configuration error, not an outage', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(
        err({ kind: 'MALFORMED_RESPONSE', message: 'Supported response has no `kinds` array.' }),
      ),
      chainIds: [84532],
    });

    // Pointing at something that is not a facilitator will not fix itself.
    expect(result.status).toBe('INCOMPATIBLE');
  });

  it('does not block the boot when the facilitator is merely unreachable', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(err({ kind: 'UNAVAILABLE', message: 'timeout' })),
      chainIds: [84532],
    });

    expect(result.status).toBe('UNREACHABLE');
  });

  it('requires every configured network, not just one of them', async () => {
    const result = await preflightFacilitator({
      facilitator: facilitatorReturning(
        ok({ kinds: [baseSepoliaExact], extensions: [], signers: {} }),
      ),
      chainIds: [84532, 8453],
    });

    expect(result.status).toBe('INCOMPATIBLE');
    expect(result.status === 'INCOMPATIBLE' && result.message).toContain('eip155:8453');
  });
});
