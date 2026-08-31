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
import type { HttpMethod } from '../../lib/http-path.js';
import { normalizePath } from '../../lib/http-path.js';
import type { TenantScope } from '../../lib/tenant.js';
import { findEndpointByRoute, type EndpointRecord } from '../endpoints/endpoint.repository.js';
import {
  createPaymentRequestForEndpoint,
  type PaymentRequestActor,
} from './payment-request.service.js';
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
    };

export interface PaidRequestInput {
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

function hasPaymentHeader(headers: Readonly<Record<string, string | string[] | undefined>>) {
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
   * Honest refusal rather than an unanswerable challenge. Nothing in this
   * release can verify a real on-chain settlement, so issuing a LIVE 402
   * would advertise a payment flow that cannot complete.
   */
  if (endpoint.environment === MerchantEnvironment.Live) {
    throw new Meter402Error('LIVE_SETTLEMENT_UNAVAILABLE');
  }

  if (!hasPaymentHeader(input.headers)) {
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
