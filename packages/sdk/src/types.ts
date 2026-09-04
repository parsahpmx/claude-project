/**
 * The SDK's public vocabulary.
 *
 * Nothing here mirrors a database row or a domain object. Merchants integrate
 * against these names, so they are chosen for what a merchant needs to know
 * and nothing else — leaking an internal type here would freeze our schema
 * into everyone else's codebase.
 */

/** A price written the way a person writes one: `'0.03'`, not `30000n`. */
export type Price = string;

export interface Meter402Options {
  /**
   * A Meter402 API key with `payments:write`.
   *
   * Server-side only. This is a bearer credential for charging money; a build
   * that ships it to a browser has published it.
   */
  readonly apiKey: string;
  /** Meter402's base URL. Defaults to the hosted control plane. */
  readonly baseUrl?: string;
  /** Per-call timeout in milliseconds. Default 10 000. */
  readonly timeoutMs?: number;
  /**
   * Replaceable `fetch`, for tests and for runtimes with their own.
   * Defaults to the global.
   */
  readonly fetch?: typeof fetch;
}

export interface ProtectOptions {
  /**
   * What this route costs, as a decimal string: `'0.03'`.
   *
   * Declared here so the price lives next to the handler it applies to. It is
   * checked against Meter402's record of the endpoint at startup; a
   * disagreement is a startup error rather than a silent change, because
   * changing what agents are charged should never be a side effect of a
   * deploy.
   *
   * Omit it to accept whatever price the endpoint is configured with.
   */
  readonly price?: Price;
  /** Asset symbol. Only USDC today. */
  readonly currency?: string;
  /**
   * The route path as registered with Meter402.
   *
   * Usually inferred from the incoming request by the framework adapter.
   * Supply it when the framework's path differs from the registered one —
   * a mounted router, a rewrite, a catch-all.
   */
  readonly path?: string;
  /** The method as registered. Usually inferred. */
  readonly method?: string;
}

/** What Meter402 decided about one inbound request. */
export type AuthorizationResult =
  | {
      readonly outcome: 'PAYMENT_REQUIRED';
      readonly paymentRequestId: string;
      /**
       * Send this, verbatim. Status, headers and body together are a complete
       * payment challenge; a middleware should not need to know what is in it.
       */
      readonly respondWith: {
        readonly status: number;
        readonly headers: Readonly<Record<string, string>>;
        readonly body: unknown;
      };
    }
  | {
      readonly outcome: 'AUTHORIZED';
      readonly paymentRequestId: string;
      readonly payment: PaymentSummary;
      readonly endpoint: EndpointSummary;
    };

export interface PaymentSummary {
  readonly id: string;
  readonly receiptId: string;
  /** The amount charged, in the asset's smallest unit, as a string. */
  readonly amountMinorUnits: string;
  readonly asset: string;
  /** True when no real money moved. Always true for TEST endpoints. */
  readonly simulated: boolean;
}

export interface EndpointSummary {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly method: string;
}

/**
 * What the merchant's handler can read about the payment that bought this
 * request. Attached to the request object by every framework adapter.
 */
export interface Meter402Context {
  readonly paymentRequestId: string;
  readonly payment: PaymentSummary;
  readonly endpoint: EndpointSummary;
}
