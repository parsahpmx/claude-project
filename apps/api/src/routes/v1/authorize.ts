import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Meter402Error } from '@meter402/shared';
import { requireScope } from '@meter402/auth';
import { requireApiKeyPrincipal } from '../../auth/authenticate.js';
import { getPrincipal, type RouteDeps } from '../context.js';
import { parseBody } from '../../lib/validation.js';
import { isHttpMethod } from '../../lib/http-path.js';
import { scopeFromApiKey } from '../../lib/tenant.js';
import { authorizePaidRequest } from '../../modules/payments/payment-gate.service.js';

/**
 * The authorization surface.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This is the route the SDK exists to call, and the reason Meter402 can claim
 * to sit in the authorization path rather than the data path.
 *
 * `/v1/paid/*` serves a request *inside* Meter402. That is fine for a demo and
 * useless for a real merchant, whose handler lives on their own server with
 * their own data. So the middleware asks one question — "may this request
 * proceed, and if not, what should I tell the caller?" — and the merchant's
 * own process does everything else. The merchant's response never transits our
 * infrastructure, which is what keeps their customers' content out of our
 * threat model.
 *
 * The reply is deliberately shaped as *an HTTP response to send*, not as facts
 * to interpret. A middleware author should never have to know what a 402 body
 * looks like, which headers a payment challenge needs, or what changes when
 * the protocol version moves. They copy `status`, `headers` and `body` onto
 * their own reply and return.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ### Why x402 endpoints are refused here
 *
 * The x402 `authorization` flow settles *after* the merchant handler
 * succeeds. In-process that is expressible — the gate hands back a `settle`
 * continuation and the transport calls it at the right moment. Across a
 * network boundary it needs two calls, and the state between them has to be
 * durable, because the merchant's process may die holding it.
 *
 * Every safe way to make that state durable is a decision this increment is
 * not in a position to make well:
 *
 *  - Storing the signed authorization would put spendable signing material at
 *    rest, which Phase 3.5 deliberately refused to do even for reconciliation.
 *  - Re-presenting the signature on the settle call avoids that, but needs a
 *    locking protocol around "who owns the claim now" whose failure modes
 *    cannot be validated here: this environment has no route to a real
 *    facilitator, so the concurrency behaviour would be proven only against a
 *    test double and then handed real money.
 *
 * So an x402 endpoint is refused with a specific, actionable error rather than
 * half-supported. TEST endpoints — the whole developer-preview experience —
 * work completely.
 */

const authorizeBodySchema = z.object({
  /** The HTTP method the caller used against the merchant's route. */
  method: z.string().trim().min(1).max(16),
  /** The path as the merchant registered it. */
  path: z.string().trim().min(1).max(2048),
  /**
   * Headers from the incoming request, so payment proof can be found.
   *
   * The merchant forwards its caller's headers; we read only the payment ones.
   * Bounded because this is attacker-influenced input arriving over a
   * merchant's credential.
   */
  headers: z.record(z.string().max(256), z.string().max(8192)).default({}),
});

export function registerAuthorizeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/v1/authorize',
    {
      /*
       * One authorization per inbound merchant request, so this is the
       * highest-volume authenticated route in the product. The ceiling is per
       * credential and sits above a realistic merchant's traffic while still
       * bounding a runaway loop.
       */
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      /*
       * API-key only, exactly as `/v1/paid/*`. A human session carries no
       * project and no environment, and inventing one would mean guessing
       * whether a dashboard click is TEST or LIVE money.
       */
      const principal = requireApiKeyPrincipal(getPrincipal(request));
      requireScope(principal, 'payments:write');

      /*
       * Through `parseBody`, not `schema.parse`. The helper maps a Zod failure
       * onto VALIDATION_FAILED; calling the schema directly lets a raw
       * ZodError escape to the error handler, which cannot recognise it and
       * correctly refuses to leak its message — so a merchant sending a
       * malformed body gets a 500 and no idea what is wrong.
       */
      const body = parseBody(authorizeBodySchema, request.body ?? {});

      const method = body.method.toUpperCase();
      if (!isHttpMethod(method)) {
        throw new Meter402Error(
          'VALIDATION_FAILED',
          `Method ${method} cannot be used for a paid endpoint.`,
        );
      }

      const decision = await authorizePaidRequest(
        deps.db,
        scopeFromApiKey(principal),
        deps.config,
        {
          ...(deps.facilitator ? { facilitator: deps.facilitator } : {}),
          projectId: principal.projectId,
          // From the credential, never from the body. A TEST key resolves the
          // TEST definition of this route or nothing.
          environment: principal.environment,
          method,
          path: body.path,
          headers: body.headers,
          actor: {
            actorType: 'api_key',
            actorId: principal.apiKeyId,
            requestId: String(request.id),
          },
        },
      );

      if (decision.outcome === 'PAYMENT_REQUIRED') {
        /*
         * 200, carrying a 402 to send. The authorization call itself
         * succeeded; the *caller's* request is the one that needs payment.
         * Returning 402 here would make every middleware author write a
         * special case for "the successful case that looks like a failure".
         */
        return {
          data: {
            outcome: 'PAYMENT_REQUIRED',
            paymentRequestId: decision.request.id,
            respondWith: {
              status: decision.response.status,
              headers: decision.response.headers,
              body: decision.response.body,
            },
          },
        };
      }

      if (decision.outcome === 'AUTHORIZED_PENDING_SETTLEMENT') {
        /*
         * Refused rather than half-supported — see the note at the top of this
         * file. The error names the endpoint so the merchant knows exactly
         * which one to change, and says what to do about it.
         */
        throw new Meter402Error(
          'LIVE_SETTLEMENT_UNAVAILABLE',
          'This endpoint settles over x402, which the authorization API does not yet ' +
            'support out of process. Use a TEST endpoint with the simulated protocol, ' +
            'or call /v1/paid/* directly.',
          { details: { endpointId: decision.endpoint.id, settlementProtocol: 'x402' } },
        );
      }

      void reply.header('meter402-payment-id', decision.payment.id);
      void reply.header('meter402-receipt-id', decision.receipt.id);

      /*
       * Authorized. The merchant runs its handler now.
       *
       * The usage event was already recorded inside the gate's transaction, so
       * this payment is spent whether or not the handler succeeds. That is the
       * honest ordering for a simulated payment: there is no settlement to
       * order around, and pretending otherwise would imply a rollback that
       * does not exist.
       */
      return {
        data: {
          outcome: 'AUTHORIZED',
          paymentRequestId: decision.request.id,
          payment: {
            id: decision.payment.id,
            receiptId: decision.receipt.id,
            amountMinorUnits: decision.request.amountMinorUnits.toString(),
            asset: decision.request.assetSymbol,
            simulated: decision.payment.simulated,
          },
          endpoint: {
            id: decision.endpoint.id,
            name: decision.endpoint.name,
            path: decision.endpoint.normalizedPath,
            method: decision.endpoint.method,
          },
        },
      };
    },
  );
}
