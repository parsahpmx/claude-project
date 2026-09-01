import { timingSafeEqual } from 'node:crypto';
import { MerchantEnvironment, Meter402Error } from '@meter402/shared';
import type { AppConfig } from '@meter402/config';
import type { Database } from '@meter402/database';
import {
  PaymentStatus,
  TEST_PAYMENT_HEADER,
  TEST_PROTOCOL,
  TestPaymentProtocolAdapter,
  type PaymentChallenge,
  type PaymentRequest,
  type ProtocolHttpResponse,
} from '@meter402/payments';
import {
  PAYMENT_SIGNATURE_HEADER,
  X402_PROTOCOL,
  X402V2PaymentProtocolAdapter,
  parsePaymentPayload,
  readHeader,
  type FacilitatorClient,
} from '@meter402/x402';
import type { HttpMethod } from '../../lib/http-path.js';
import { normalizePath } from '../../lib/http-path.js';
import type { TenantScope } from '../../lib/tenant.js';
import { findEndpointByRoute, type EndpointRecord } from '../endpoints/endpoint.repository.js';
import { chainIdForEnvironment } from '../endpoints/endpoint.service.js';
import { paymentMetrics } from '../../lib/metrics.js';
import {
  createPaymentRequestForEndpoint,
  type PaymentRequestActor,
} from './payment-request.service.js';
import {
  settleX402Payment,
  verifyX402Payment,
  type SettleOutcome,
} from './x402-payment.service.js';
import {
  findPaymentByRequest,
  findPaymentRequestForUpdate,
  findReceiptByPayment,
  recordUsageEventIfAbsent,
  type PaymentRecord,
  type ReceiptRecord,
} from './payment.repository.js';

/**
 * The HTTP payment gate.
 *
 * This is the function that makes an endpoint *paid*. It answers one question
 * — may this request run? — and it answers it in exactly two ways:
 *
 *   • `PAYMENT_REQUIRED`: here is a 402 with a machine-readable requirement.
 *   • `AUTHORIZED`: a settled, unspent payment exists for this exact endpoint.
 *
 * There is no third outcome and no override parameter. A caller cannot pass a
 * flag that skips the check, because there is no flag to pass.
 *
 * Two properties are worth stating plainly, because they are what an attacker
 * would go after:
 *
 *  1. **A payment authorizes the endpoint it was issued for, and no other.**
 *     The payment request carries its `endpointId`, and it is compared against
 *     the endpoint actually being called. Paying 0.001 USDC for a cheap route
 *     and presenting that proof at an expensive one fails here.
 *
 *  2. **A payment authorizes exactly one request.** Consumption is a usage
 *     event keyed on the payment, inserted in the same transaction that
 *     authorizes. A second presentation of the same proof finds the event
 *     already there and is refused. Without this, one payment would buy
 *     unlimited calls.
 */

const adapter = new TestPaymentProtocolAdapter();

export type PaymentGateDecision =
  | {
      readonly outcome: 'PAYMENT_REQUIRED';
      readonly endpoint: EndpointRecord;
      readonly request: PaymentRequest;
      readonly challenge: PaymentChallenge;
      readonly response: ProtocolHttpResponse;
    }
  | {
      readonly outcome: 'AUTHORIZED';
      readonly endpoint: EndpointRecord;
      readonly request: PaymentRequest;
      readonly payment: PaymentRecord;
      readonly receipt: ReceiptRecord;
    }
  /**
   * x402 only: the authorization is verified but **not yet settled**.
   *
   * The x402 `authorization` flow settles *after* the merchant handler
   * succeeds, so the gate cannot finish the payment on its own — it would have
   * to run the handler, which is not its job. Instead it returns the
   * verified state plus a `settle` continuation, and the transport layer,
   * which owns the handler, calls it at the right moment.
   *
   * Modelling the pause explicitly is what keeps the ordering honest: there is
   * no way to reach a settled x402 payment without having passed through a
   * point where the handler could have failed.
   */
  | {
      readonly outcome: 'AUTHORIZED_PENDING_SETTLEMENT';
      readonly endpoint: EndpointRecord;
      readonly request: PaymentRequest;
      readonly payer: string;
      readonly settle: () => Promise<SettleOutcome>;
    };

export interface PaidRequestInput {
  /** Required for x402 endpoints; unused by the simulated protocol. */
  readonly facilitator?: FacilitatorClient;
  /** Absolute base URL used to render the x402 `resource.url`. */
  readonly resourceBaseUrl?: string;
  /** The request path as the client addressed it, for `resource.url`. */
  readonly resourcePath?: string;
  readonly projectId: string;
  readonly environment: MerchantEnvironment;
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly actor: PaymentRequestActor;
}

/** Constant-time comparison of two settlement references. */
function referencesMatch(expected: string | null, provided: string): boolean {
  if (expected === null) {
    return false;
  }
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(provided.toLowerCase(), 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function hasTestPaymentHeader(headers: Readonly<Record<string, string | string[] | undefined>>) {
  return Object.keys(headers).some((key) => key.toLowerCase() === TEST_PAYMENT_HEADER);
}

export async function authorizePaidRequest(
  db: Database,
  scope: TenantScope,
  config: AppConfig,
  input: PaidRequestInput,
): Promise<PaymentGateDecision> {
  const normalizedPath = normalizePath(input.path);

  /*
   * Environment is part of the lookup key, not a filter afterwards. A TEST
   * credential resolves the TEST definition of a route or nothing at all — it
   * can never reach the LIVE row for the same path.
   */
  const endpoint = await findEndpointByRoute(db, scope, {
    projectId: input.projectId,
    environment: input.environment,
    method: input.method,
    normalizedPath,
  });

  if (!endpoint) {
    throw new Meter402Error('ENDPOINT_NOT_FOUND');
  }
  if (endpoint.status !== 'ACTIVE') {
    throw new Meter402Error(
      'ENDPOINT_DISABLED',
      `This endpoint is ${endpoint.status} and is not serving requests.`,
    );
  }

  /*
   * Which protocol settles this endpoint. Two orthogonal axes decide what a
   * payment means here, and conflating them is what Phase 3 had to undo:
   *
   *   environment  (TEST | LIVE)  — which chain, which credentials
   *   protocol     (test | x402)  — simulated, or real money
   *
   * So TEST+test is a simulation with no blockchain, TEST+x402 is a real
   * signed payment on Base Sepolia, and LIVE+x402 is real money on mainnet.
   */
  if (endpoint.settlementProtocol === X402_PROTOCOL) {
    /*
     * Real settlement is gated twice more: by the operational kill switch,
     * and by whether this specific chain is enabled. Both are checked before
     * a challenge is issued, so a server that cannot settle never asks anyone
     * to pay.
     */
    if (!config.settlement.liveSettlementEnabled) {
      throw new Meter402Error(
        'LIVE_SETTLEMENT_UNAVAILABLE',
        'Real settlement is disabled on this server.',
      );
    }
    if (!config.settlement.enabledChainIds.includes(chainIdForEnvironment(endpoint.environment))) {
      throw new Meter402Error(
        'LIVE_SETTLEMENT_UNAVAILABLE',
        "Settlement is not enabled for this endpoint's network.",
      );
    }
    return authorizeX402Request(db, scope, config, input, endpoint);
  }

  /*
   * Simulated settlement. A LIVE environment cannot be simulated — pretending
   * to take real money is worse than refusing.
   */
  if (endpoint.environment === MerchantEnvironment.Live) {
    throw new Meter402Error(
      'LIVE_SETTLEMENT_UNAVAILABLE',
      'This endpoint is configured for simulated payments and cannot run in LIVE mode.',
    );
  }

  if (!hasTestPaymentHeader(input.headers)) {
    return issueChallenge(db, scope, endpoint, config, input.actor);
  }

  const parsed = adapter.parsePaymentProof({ headers: input.headers });
  if (!parsed.ok) {
    throw new Meter402Error('PAYMENT_INVALID', parsed.error.message, {
      details: { reason: parsed.error.reason },
    });
  }
  const proof = parsed.value;

  const claimedRequestId = proof.raw['paymentRequestId'];
  if (typeof claimedRequestId !== 'string') {
    throw new Meter402Error('PAYMENT_INVALID', 'The payment proof names no payment request.');
  }

  return db.transaction(async (tx) => {
    /*
     * Locked for the duration, because the decision and the consumption that
     * follows it must be one atomic step. Two concurrent requests presenting
     * the same proof serialise here, and the second finds the usage event
     * already recorded.
     */
    const request = await findPaymentRequestForUpdate(tx, scope, claimedRequestId);
    if (!request) {
      /*
       * Reported as an invalid proof, not as a missing resource. The agent
       * supplied this ID; whether it belongs to another tenant or never
       * existed is not something a 402 should distinguish.
       */
      throw new Meter402Error('PAYMENT_INVALID', 'No payment request matches this proof.');
    }

    // Property 1: this payment buys *this* endpoint.
    if (request.endpointId !== endpoint.id) {
      throw new Meter402Error(
        'PAYMENT_ENDPOINT_MISMATCH',
        'This payment was made for a different endpoint.',
      );
    }
    if (request.environment !== endpoint.environment) {
      /* istanbul ignore next -- the request was created from this endpoint. */
      throw new Meter402Error('TEST_LIVE_MISMATCH');
    }

    const payment = await findPaymentByRequest(tx, scope, request.id);
    if (!payment || payment.status !== PaymentStatus.Confirmed) {
      throw new Meter402Error(
        'PAYMENT_NOT_CONFIRMED',
        'This payment request has not been paid yet.',
        { details: { paymentRequestId: request.id } },
      );
    }

    /*
     * The reference is the bearer part of the proof. Comparing it in constant
     * time means a caller who knows a payment request ID — which is not
     * secret; it appears in the 402 — still cannot present someone else's
     * settled payment without the reference the simulator issued for it.
     */
    if (!referencesMatch(payment.externalTransactionReference, proof.transactionHash)) {
      throw new Meter402Error('PAYMENT_INVALID', 'The payment reference does not match.');
    }

    const receipt = await findReceiptByPayment(tx, scope, payment.id);
    /* istanbul ignore next -- payment and receipt are written together. */
    if (!receipt) {
      throw new Meter402Error(
        'INTERNAL_ERROR',
        'A confirmed payment exists without a receipt, which should be impossible.',
      );
    }

    // Property 2: one payment, one request. This insert is the consumption.
    const consumed = await recordUsageEventIfAbsent(tx, scope, {
      projectId: endpoint.projectId,
      endpointId: endpoint.id,
      paymentId: payment.id,
      requestId: input.actor.requestId ?? null,
    });
    if (!consumed) {
      throw new Meter402Error(
        'PAYMENT_ALREADY_USED',
        'This payment has already been used for a request. Pay again to make another.',
        { details: { paymentId: payment.id } },
      );
    }

    return { outcome: 'AUTHORIZED', endpoint, request, payment, receipt };
  });
}

/**
 * The x402 half of the gate: 402, or verify-and-pause-for-settlement.
 */
async function authorizeX402Request(
  db: Database,
  scope: TenantScope,
  config: AppConfig,
  input: PaidRequestInput,
  endpoint: EndpointRecord,
): Promise<PaymentGateDecision> {
  const facilitator = input.facilitator;
  if (!facilitator) {
    /* istanbul ignore next -- the app always supplies one when configured. */
    throw new Meter402Error(
      'LIVE_SETTLEMENT_UNAVAILABLE',
      'No facilitator is configured for real settlement.',
    );
  }

  const adapter = new X402V2PaymentProtocolAdapter(
    input.resourceBaseUrl ?? 'https://api.meter402.local',
  );
  const basePath = input.resourcePath ?? normalizePath(input.path);

  const raw = readHeader(input.headers, PAYMENT_SIGNATURE_HEADER);
  if (raw === null) {
    // No authorization presented: quote a price and serve the x402 402.
    const request = await createPaymentRequestForEndpoint(db, scope, input.actor, {
      endpoint,
      protocol: X402_PROTOCOL,
      ttlSeconds: config.chain.challengeTtlSeconds,
    });
    paymentMetrics.increment('challenges_issued', {
      network: `eip155:${request.chainId}`,
    });
    return {
      outcome: 'PAYMENT_REQUIRED',
      endpoint,
      request,
      challenge: adapter.createChallenge(request),
      response: adapter.buildPaymentRequiredResponse(request, resourceUrlFor(basePath, request.id)),
    };
  }
  if (raw === 'DUPLICATED') {
    throw new Meter402Error('PAYMENT_INVALID', `Multiple ${PAYMENT_SIGNATURE_HEADER} headers.`);
  }

  const parsed = parsePaymentPayload(raw);
  if (!parsed.ok) {
    throw new Meter402Error('PAYMENT_INVALID', parsed.error.message, {
      details: { reason: parsed.error.reason },
    });
  }
  const payload = parsed.value;

  /*
   * Which payment request is this paying? x402 does not carry our request ID
   * on the wire, so it is recovered from the authorization's binding to a
   * recipient, amount and network — the payment request is found by the
   * resource being paid for, and then every field is checked against it.
   */
  const requestId = readPaymentRequestId(payload);
  if (!requestId) {
    throw new Meter402Error(
      'PAYMENT_INVALID',
      'The payment payload does not identify a payment request.',
    );
  }

  const request = await findPaymentRequestForUpdate(db, scope, requestId);
  if (!request) {
    throw new Meter402Error('PAYMENT_INVALID', 'No payment request matches this proof.');
  }
  if (request.endpointId !== endpoint.id) {
    throw new Meter402Error(
      'PAYMENT_ENDPOINT_MISMATCH',
      'This payment was made for a different endpoint.',
    );
  }

  const verified = await verifyX402Payment(
    db,
    scope,
    config,
    facilitator,
    adapter,
    request,
    payload,
    input.actor,
  );

  if (verified.outcome === 'UNAVAILABLE') {
    /*
     * The facilitator could not be reached. Nothing has settled and nothing
     * has been charged, so this is explicitly not a payment failure — the
     * caller is told to retry.
     */
    throw new Meter402Error('UPSTREAM_UNAVAILABLE', verified.message);
  }
  if (verified.outcome === 'REJECTED') {
    throw new Meter402Error('PAYMENT_INVALID', verified.failure.message, {
      details: { reason: verified.failure.reason },
    });
  }

  return {
    outcome: 'AUTHORIZED_PENDING_SETTLEMENT',
    endpoint,
    request,
    payer: verified.payer,
    settle: async () => {
      const settled = await settleX402Payment(
        db,
        scope,
        config,
        facilitator,
        adapter,
        request,
        verified.payload,
        verified.payer,
        input.actor,
        verified.ownsAuthorizationClaim,
      );

      /*
       * Metering, recorded once settlement exists. Keyed on the payment, so a
       * retried authorization cannot bill twice — the same guarantee the
       * simulated path gets, from the same function.
       */
      await db.transaction(async (tx) => {
        await recordUsageEventIfAbsent(tx, scope, {
          projectId: endpoint.projectId,
          endpointId: endpoint.id,
          paymentId: settled.payment.id,
          requestId: input.actor.requestId ?? null,
        });
      });

      return settled;
    },
  };
}

/**
 * The resource URL for one payment request.
 *
 * x402 v2 identifies what is being paid for by `resource.url`, and has no
 * field for a server-side request ID — so the request ID travels as a query
 * parameter on that URL. That is the honest reading of the spec rather than a
 * proprietary extension: this URL genuinely does identify the thing being
 * paid for, which is *this quote for this resource*, not the route in general.
 */
function resourceUrlFor(path: string, paymentRequestId: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}preq=${paymentRequestId}`;
}

/**
 * Recover the payment request ID an x402 payload is paying.
 *
 * Read from the `resource.url` we issued and the client echoed back. This is
 * **not** trusted as authorization — it only selects which stored request to
 * check the authorization against, and every binding rule then applies. A
 * caller naming another tenant's request gets a scoped miss; a caller naming
 * their own gets the full amount, asset, recipient and network comparison.
 * Selecting the wrong record therefore cannot authorize anything; it can only
 * cause a rejection.
 */
function readPaymentRequestId(payload: {
  resource?: { url: string };
  accepted: { extra: Readonly<Record<string, unknown>> };
}): string | null {
  const url = payload.resource?.url;
  if (typeof url !== 'string') return null;
  const match = /(?:^|[/?&#=])(preq_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})\b/.exec(url);
  return match?.[1] ?? null;
}

/**
 * Price the endpoint, create the payment request, and render the 402.
 *
 * The challenge is built by the protocol adapter from the stored request, so
 * the amount an agent is told to pay is the amount recorded on the request —
 * they cannot drift apart.
 */
async function issueChallenge(
  db: Database,
  scope: TenantScope,
  endpoint: EndpointRecord,
  config: AppConfig,
  actor: PaymentRequestActor,
): Promise<PaymentGateDecision> {
  const request = await createPaymentRequestForEndpoint(db, scope, actor, {
    endpoint,
    protocol: TEST_PROTOCOL,
    ttlSeconds: config.chain.challengeTtlSeconds,
  });

  const challenge = adapter.createChallenge(request);
  return {
    outcome: 'PAYMENT_REQUIRED',
    endpoint,
    request,
    challenge,
    response: adapter.buildChallengeResponse(challenge),
  };
}
