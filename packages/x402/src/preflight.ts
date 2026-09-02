import { toCaip2 } from '@meter402/shared';
import { SCHEME_EXACT, X402_VERSION } from './constants.js';
import type { FacilitatorClient } from './facilitator.js';

/**
 * Startup validation of the configured facilitator.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A facilitator is not a generic service: it settles a specific scheme on
 * specific networks. Pointing Meter402 at one that does not handle
 * `exact` on our chain produces a deployment that issues payment challenges,
 * takes signed authorizations from agents, and then fails at `/settle` — after
 * the agent believes it has paid. That is the worst possible time to discover
 * a configuration mistake, so it is discovered at boot instead.
 *
 * The two failure modes are deliberately not treated alike:
 *
 *   INCOMPATIBLE  the facilitator answered, and does not support what we need.
 *                 A fact about the configuration. It will not fix itself, and
 *                 every payment this deployment accepts will fail. Refuse to
 *                 start.
 *
 *   UNREACHABLE   the facilitator did not answer. A fact about right now, and
 *                 nothing about whether the configuration is correct. Blocking
 *                 the deploy on it would mean a facilitator blip stops us
 *                 shipping unrelated fixes — including a fix for the outage.
 *                 Start, log loudly, and let `/health/payments` carry it.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type FacilitatorPreflight =
  | { readonly status: 'OK'; readonly networks: readonly string[] }
  | { readonly status: 'UNREACHABLE'; readonly message: string }
  | { readonly status: 'INCOMPATIBLE'; readonly message: string };

export interface FacilitatorPreflightInput {
  readonly facilitator: FacilitatorClient;
  /** Chain IDs this deployment intends to settle on. */
  readonly chainIds: readonly number[];
}

export async function preflightFacilitator(
  input: FacilitatorPreflightInput,
): Promise<FacilitatorPreflight> {
  const supported = await input.facilitator.getSupportedCapabilities();

  if (!supported.ok) {
    if (supported.error.kind === 'MALFORMED_RESPONSE') {
      /*
       * It answered, and the answer was not an x402 `/supported` document.
       * Almost always a URL pointing at something that is not a facilitator,
       * which is a configuration fact, not an outage.
       */
      return {
        status: 'INCOMPATIBLE',
        message: `The configured facilitator did not return a valid x402 /supported document (${supported.error.message}).`,
      };
    }
    return { status: 'UNREACHABLE', message: supported.error.message };
  }

  const required = input.chainIds.map((chainId) => toCaip2(chainId));
  const offered = new Set(
    supported.value.kinds
      .filter((kind) => kind.x402Version === X402_VERSION && kind.scheme === SCHEME_EXACT)
      .map((kind) => kind.network),
  );

  const missing = required.filter((network) => !offered.has(network));
  if (missing.length > 0) {
    return {
      status: 'INCOMPATIBLE',
      message:
        `The configured facilitator does not support x402 v${X402_VERSION} ` +
        `scheme "${SCHEME_EXACT}" on ${missing.join(', ')}. ` +
        `It offers: ${[...offered].join(', ') || 'nothing matching'}.`,
    };
  }

  return { status: 'OK', networks: required };
}
