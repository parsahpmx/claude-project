import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Meter402Error } from '@meter402/shared';
import { requireScope } from '@meter402/auth';
import { requireApiKeyPrincipal } from '../../auth/authenticate.js';
import { getPrincipal, type RouteDeps } from '../context.js';
import { isHttpMethod } from '../../lib/http-path.js';
import { scopeFromApiKey } from '../../lib/tenant.js';
import { authorizePaidRequest } from '../../modules/payments/payment-gate.service.js';
import { X402V2PaymentProtocolAdapter } from '@meter402/x402';
import type { EndpointRecord } from '../../modules/endpoints/endpoint.repository.js';

/**
 * The merchant handler.
 *
 * Phase 3 still does not forward to merchant infrastructure — that is outbound
 * HTTP to a merchant-chosen address, and the SSRF gate remains open. This
 * built-in handler stands in for it, and exists so the payment flow has a real
 * success and failure point to order settlement around.
 */
function runMerchantHandler(endpoint: EndpointRecord) {
  return {
    endpoint: {
      id: endpoint.id,
      name: endpoint.name,
      path: endpoint.normalizedPath,
      method: endpoint.method,
    },
    result: { served: true, servedAt: new Date().toISOString() },
  };
}

/**
 * The absolute origin this server is reachable at, for `resource.url`.
 *
 * Read from configuration, never from a request header. The resource URL is
 * part of what a payer signs against, so a caller who could set it via `Host`
 * or `X-Forwarded-Host` could obtain a signature for one resource and present
 * it at another.
 */
function resourceBaseUrl(): string {
  return process.env['PUBLIC_BASE_URL'] ?? 'https://api.meter402.local';
}

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
      ...(deps.facilitator ? { facilitator: deps.facilitator } : {}),
      resourceBaseUrl: resourceBaseUrl(),
      resourcePath: request.url,
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
     * x402: verified but not yet settled.
     *
     * This is where the protocol's flow ordering becomes real code. The
     * `authorization` flow settles *after* the handler, so the handler runs
     * here — and if it throws, `settle()` is never called and the payer is
     * never charged. That behaviour is not a special case we added; it is
     * what the ordering means.
     */
    if (decision.outcome === 'AUTHORIZED_PENDING_SETTLEMENT') {
      const merchantResult = runMerchantHandler(decision.endpoint);

      const settled = await decision.settle();

      const successResponse = new X402V2PaymentProtocolAdapter(
        resourceBaseUrl(),
      ).buildSuccessResponse({
        request: decision.request,
        transfer: {
          transactionHash: settled.settlement.transaction,
          chainId: decision.request.chainId,
          tokenAddress: decision.request.assetAddress,
          from: decision.payer,
          to: decision.request.recipientAddress,
          minorUnits: decision.request.amountMinorUnits,
          blockNumber: 0n,
          blockHash: `0x${'0'.repeat(64)}`,
          confirmations: 0,
          logIndex: 0,
          observedAt: new Date(),
        },
        receiptId: settled.receipt.id,
      });

      for (const [name, value] of Object.entries(successResponse.headers)) {
        void reply.header(name, value);
      }
      void reply.header('meter402-receipt-id', settled.receipt.id);
      void reply.header('meter402-payment-id', settled.payment.id);

      return {
        data: {
          endpoint: merchantResult.endpoint,
          result: { ...merchantResult.result, simulated: false },
          payment: {
            id: settled.payment.id,
            receiptId: settled.receipt.id,
            paymentRequestId: decision.request.id,
            amountMinorUnits: decision.request.amountMinorUnits.toString(),
            asset: decision.request.assetSymbol,
            transactionHash: settled.settlement.transaction,
            payer: decision.payer,
          },
        },
      };
    }

    /*
     * Simulated settlement. The payment was already settled out of band, is
     * bound to this endpoint, and is now spent — the usage event was recorded
     * inside the gate's transaction, so this proof cannot buy a second
     * request.
     */
    void reply.header('meter402-receipt-id', decision.receipt.id);
    void reply.header('meter402-payment-id', decision.payment.id);

    const merchantResult = runMerchantHandler(decision.endpoint);
    return {
      data: {
        endpoint: merchantResult.endpoint,
        result: { ...merchantResult.result, simulated: decision.payment.simulated },
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
   * A tighter limit than the global one.
   *
   * This is the only unauthenticated-ish surface that can cause **outbound**
   * work: an unpaid request creates a payment request row, and a request with
   * an authorization causes a facilitator call. Without a per-key ceiling,
   * Meter402 becomes an amplifier — one cheap inbound request turning into an
   * expensive call at someone else's infrastructure — and a cheap way to fill
   * our own payment_requests table.
   *
   * Keyed on the API key rather than the IP, because the credential is the
   * accountable identity here and a single agent behind a NAT should not be
   * limited by its neighbours.
   */
  const paidRateLimit = {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          const header = request.headers.authorization;
          return typeof header === 'string' && header.length > 0
            ? // The token itself is never used as a label anywhere it could be
              // logged; this key stays inside the limiter's memory.
              `paid:${header}`
            : `paid-ip:${request.ip}`;
        },
      },
    },
  };

  /*
   * Registered per method rather than with `app.all`, so a method the product
   * does not support is a 404 from the router instead of reaching a handler
   * that has to reject it.
   */
  app.get('/v1/paid/*', paidRateLimit, handler);
  app.post('/v1/paid/*', paidRateLimit, handler);
  app.put('/v1/paid/*', paidRateLimit, handler);
  app.patch('/v1/paid/*', paidRateLimit, handler);
  app.delete('/v1/paid/*', paidRateLimit, handler);
}
