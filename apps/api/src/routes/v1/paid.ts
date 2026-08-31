import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Meter402Error } from '@meter402/shared';
import { requireScope } from '@meter402/auth';
import { requireApiKeyPrincipal } from '../../auth/authenticate.js';
import { getPrincipal, type RouteDeps } from '../context.js';
import { isHttpMethod } from '../../lib/http-path.js';
import { scopeFromApiKey } from '../../lib/tenant.js';
import { authorizePaidRequest } from '../../modules/payments/payment-gate.service.js';

/**
 * The agent-facing paid surface.
 *
 * `/v1/paid/<merchant path>` — the project comes from the API key, not the
 * URL, so an agent addresses a merchant's route exactly as the merchant
 * registered it. This is the surface the whole product exists to provide: an
 * autonomous caller meets a 402, pays, retries, and is served.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What Phase 2 deliberately does NOT do: forward the authorized request to
 * merchant-controlled infrastructure.
 *
 * Proxying to a merchant-supplied URL is outbound HTTP to an address the
 * merchant chooses, which is server-side request forgery unless it is behind
 * DNS-rebinding-resistant resolution, private-range blocking, and redirect
 * confinement. Those controls are a known open release gate and they are not
 * built. Rather than ship the forwarding and hope nobody points an endpoint at
 * 169.254.169.254, the authorized request is served by the built-in handler
 * below.
 *
 * That is the honest scope of this phase: the payment path is real and
 * complete; merchant execution is a stub, and the gate that must precede it
 * remains open.
 * ─────────────────────────────────────────────────────────────────────────
 */

interface WildcardParams {
  readonly '*': string;
}

export function registerPaidRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    /*
     * API-key only. A human session has no project and no environment, and
     * inventing one for it would mean guessing whether a dashboard click is a
     * TEST or LIVE payment. This is the machine surface; machines carry keys.
     */
    const principal = requireApiKeyPrincipal(getPrincipal(request));
    requireScope(principal, 'payments:write');

    const method = request.method.toUpperCase();
    if (!isHttpMethod(method)) {
      throw new Meter402Error(
        'VALIDATION_FAILED',
        `Method ${method} cannot be used for a paid endpoint.`,
      );
    }

    const params = request.params as WildcardParams;
    const path = `/${params['*'] ?? ''}`;

    const decision = await authorizePaidRequest(deps.db, scopeFromApiKey(principal), deps.config, {
      projectId: principal.projectId,
      // From the credential, never from the request. A TEST key resolves the
      // TEST definition of this route or nothing.
      environment: principal.environment,
      method,
      path,
      headers: request.headers,
      actor: {
        actorType: 'api_key',
        actorId: principal.apiKeyId,
        requestId: String(request.id),
      },
    });

    if (decision.outcome === 'PAYMENT_REQUIRED') {
      const response = decision.response;
      void reply.status(response.status);
      for (const [name, value] of Object.entries(response.headers)) {
        void reply.header(name, value);
      }
      return response.body;
    }

    /*
     * Authorized. The payment is settled, bound to this endpoint, and now
     * spent — the usage event was recorded inside the gate's transaction, so
     * this proof cannot buy a second request.
     */
    void reply.header('meter402-receipt-id', decision.receipt.id);
    void reply.header('meter402-payment-id', decision.payment.id);

    return {
      data: {
        endpoint: {
          id: decision.endpoint.id,
          name: decision.endpoint.name,
          path: decision.endpoint.normalizedPath,
          method: decision.endpoint.method,
        },
        // Evidence the paid handler actually ran, which is the thing the
        // end-to-end test asserts. A real merchant integration replaces this
        // body; the payment machinery around it does not change.
        result: {
          served: true,
          simulated: decision.payment.simulated,
          servedAt: new Date().toISOString(),
        },
        payment: {
          id: decision.payment.id,
          receiptId: decision.receipt.id,
          paymentRequestId: decision.request.id,
          amountMinorUnits: decision.request.amountMinorUnits.toString(),
          asset: decision.request.assetSymbol,
        },
      },
    };
  };

  /*
   * Registered per method rather than with `app.all`, so a method the product
   * does not support is a 404 from the router instead of reaching a handler
   * that has to reject it.
   */
  app.get('/v1/paid/*', handler);
  app.post('/v1/paid/*', handler);
  app.put('/v1/paid/*', handler);
  app.patch('/v1/paid/*', handler);
  app.delete('/v1/paid/*', handler);
}
