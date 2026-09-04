import type { Meter402 } from '../index.js';
import type { Meter402Context } from '../types.js';
import { decisionFrom, decisionFromError, resolveRoute, type AdapterOptions } from './shared.js';

/**
 * Fastify.
 *
 *     import { createMeter402 } from '@meter402/sdk';
 *     import { protect } from '@meter402/sdk/fastify';
 *
 *     const meter = createMeter402({ apiKey: process.env.METER402_API_KEY! });
 *
 *     app.post(
 *       '/research',
 *       { preHandler: protect(meter, { price: '0.03' }) },
 *       researchHandler,
 *     );
 *
 * A `preHandler`, not an `onRequest` hook: the payment decision belongs after
 * Fastify has parsed and validated the request, so a malformed call is
 * rejected as malformed rather than charged for.
 */

interface FastifyLikeRequest {
  method: string;
  url: string;
  routeOptions?: { url?: string };
  headers: Record<string, string | string[] | undefined>;
  meter402?: Meter402Context;
}

interface FastifyLikeReply {
  code(status: number): FastifyLikeReply;
  header(name: string, value: string): FastifyLikeReply;
  send(body: unknown): unknown;
}

export function protect(meter: Meter402, options: AdapterOptions = {}) {
  const failureMode = options.onUnavailable ?? 'closed';

  return async function meter402PreHandler(
    request: FastifyLikeRequest,
    reply: FastifyLikeReply,
  ): Promise<void> {
    const route = resolveRoute(options, {
      method: request.method,
      /*
       * The route pattern, not the concrete URL. `/research/:id` is what was
       * registered; `/research/42` is what arrived. Using the latter would
       * mean every distinct ID looked like an unregistered endpoint.
       */
      path: request.routeOptions?.url ?? request.url,
    });

    let decision;
    try {
      decision = decisionFrom(await meter.authorize({ ...route, headers: request.headers }));
    } catch (error) {
      options.onError?.(error);
      decision = decisionFromError(error, failureMode);
    }

    if (decision.action === 'proceed') {
      if (decision.context) request.meter402 = decision.context;
      return;
    }

    for (const [name, value] of Object.entries(decision.headers ?? {})) {
      void reply.header(name, value);
    }
    /*
     * `return reply.send(...)` rather than falling through: in a Fastify
     * preHandler, sending without returning the reply lets the route handler
     * run anyway — which would serve the resource for free.
     */
    await reply.code(decision.status ?? 402).send(decision.body);
  };
}
