import { Meter402Client, type AuthorizeInput } from './client.js';
import { Meter402SdkError } from './errors.js';
import type { AuthorizationResult, Meter402Options, ProtectOptions } from './types.js';

export { Meter402SdkError, isMeter402SdkError } from './errors.js';
export { Meter402Client } from './client.js';
export type {
  AuthorizationResult,
  EndpointSummary,
  Meter402Context,
  Meter402Options,
  PaymentSummary,
  Price,
  ProtectOptions,
} from './types.js';
export type { AuthorizeInput } from './client.js';

/**
 * @meter402/sdk
 *
 * Turn an existing route into a paid AI-agent service.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *     import { createMeter402 } from '@meter402/sdk';
 *     import { protect } from '@meter402/sdk/express';
 *
 *     const meter = createMeter402({ apiKey: process.env.METER402_API_KEY! });
 *
 *     app.post('/research', protect(meter, { price: '0.03' }), researchHandler);
 * ─────────────────────────────────────────────────────────────────────────
 *
 * What a merchant never has to know: CAIP-2, Base chain IDs, USDC decimals,
 * EIP-3009, EIP-712, facilitator APIs, replay protection, transaction
 * finality, or anything about a payment state machine. All of that is on the
 * other side of one HTTP call.
 *
 * What a merchant does have to know: their route costs money now, and their
 * handler runs only when it has been paid for.
 */

export interface Meter402 {
  /**
   * Decide one request. Framework-agnostic; the adapters wrap it.
   *
   * Returns either a response to send or permission to proceed. It never
   * throws for an unpaid caller — that is a normal outcome, not an error.
   */
  authorize(input: AuthorizeInput): Promise<AuthorizationResult>;

  /**
   * Check, once, that a route is registered as the code says it is.
   *
   * Call this at startup. It exists because the alternative — discovering at
   * 3am that the endpoint was never created, or that its price is not the
   * price in the source file — is discovered by an agent, in production, one
   * payment at a time.
   *
   * A price disagreement is an error rather than an automatic correction:
   * what agents are charged should never change as a side effect of a deploy.
   */
  verifyRoute(options: ProtectOptions & { path: string; method: string }): Promise<void>;

  /** The underlying client, for anything the adapters do not cover. */
  readonly client: Meter402Client;
}

export function createMeter402(options: Meter402Options): Meter402 {
  const client = new Meter402Client(options);

  return {
    client,
    authorize: (input) => client.authorize(input),

    async verifyRoute(route) {
      const endpoints = await client.listEndpoints();
      const method = route.method.toUpperCase();
      const path = normalizePath(route.path);

      const match = endpoints.find(
        (endpoint) =>
          endpoint.method.toUpperCase() === method && normalizePath(endpoint.path) === path,
      );

      if (!match) {
        throw new Meter402SdkError(
          'configuration',
          `No Meter402 endpoint is registered for ${method} ${path}. ` +
            `Run \`meter402 endpoints create --path ${path} --method ${method}\` ` +
            `or create it in the dashboard.`,
        );
      }

      if (match.status !== 'ACTIVE') {
        throw new Meter402SdkError(
          'configuration',
          `The Meter402 endpoint for ${method} ${path} is ${match.status}, so it will not ` +
            `serve requests.`,
        );
      }

      if (route.price !== undefined && match.price) {
        /*
         * Both sides normalised to minor units before comparing, so '0.03',
         * '0.030' and '0.0300' all agree with each other and with the stored
         * price. Done on strings: 0.03 * 1e6 is 30000.000000000004, and a
         * price that is wrong in the seventh decimal place is a wrong price.
         */
        const declared = toMinorUnits(route.price, match.price.decimals);
        const registered = toMinorUnits(match.price.amount, match.price.decimals);
        if (declared !== registered) {
          throw new Meter402SdkError(
            'configuration',
            `Price mismatch for ${method} ${path}: this code declares ` +
              `${route.price} ${route.currency ?? match.price.asset}, but Meter402 has it ` +
              `registered at ${match.price.amount} ${match.price.asset}. Change one of them ` +
              `deliberately — a price is what agents agreed to pay, so it is not adjusted ` +
              `automatically.`,
          );
        }
      }
    },
  };
}

function normalizePath(path: string): string {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const withoutQuery = withLeadingSlash.split('?')[0] ?? withLeadingSlash;
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

/**
 * Decimal string to minor units, without floating point.
 *
 * `'0.03'` with 6 decimals is `'30000'`. Done on strings because
 * `0.03 * 1e6` is `30000.000000000004`, and a price that is wrong in the
 * seventh decimal place is a price that is wrong.
 */
function toMinorUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Meter402SdkError(
      'configuration',
      `"${amount}" is not a valid price. Use a plain decimal string like '0.03'.`,
    );
  }

  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    throw new Meter402SdkError(
      'configuration',
      `Price ${amount} has more precision than this asset supports (${decimals} decimals).`,
    );
  }

  const padded = fraction.padEnd(decimals, '0');
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return combined;
}
