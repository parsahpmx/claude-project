import type { Meter402 } from '../index.js';
import type { Meter402Context } from '../types.js';
import { decisionFrom, decisionFromError, resolveRoute, type AdapterOptions } from './shared.js';

/**
 * Next.js route handlers (the App Router).
 *
 *     import { createMeter402 } from '@meter402/sdk';
 *     import { withMeter402 } from '@meter402/sdk/next';
 *
 *     const meter = createMeter402({ apiKey: process.env.METER402_API_KEY! });
 *
 *     export const POST = withMeter402(meter, { price: '0.03' }, async (request) => {
 *       return Response.json({ result: await research() });
 *     });
 *
 * A wrapper rather than middleware, because Next middleware runs on the Edge
 * runtime for the whole app and a payment decision belongs to one route.
 *
 * The wrapped handler receives the payment as a second argument. Nothing is
 * attached to the request: `Request` is immutable in the Fetch API, and
 * pretending otherwise breaks in ways that only appear in production.
 */

/** The subset of the Fetch API this adapter needs. */
interface FetchLikeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: { forEach(callback: (value: string, key: string) => void): void };
}

export type Meter402RouteHandler<Req extends FetchLikeRequest, Res> = (
  request: Req,
  payment: Meter402Context | null,
) => Res | Promise<Res>;

export function withMeter402<Req extends FetchLikeRequest, Res extends object>(
  meter: Meter402,
  options: AdapterOptions,
  handler: Meter402RouteHandler<Req, Res>,
): (request: Req) => Promise<Res | Response> {
  const failureMode = options.onUnavailable ?? 'closed';

  return async function meter402Route(request: Req): Promise<Res | Response> {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const route = resolveRoute(options, {
      method: request.method,
      path: pathOf(request.url),
    });

    let decision;
    try {
      decision = decisionFrom(await meter.authorize({ ...route, headers }));
    } catch (error) {
      options.onError?.(error);
      decision = decisionFromError(error, failureMode);
    }

    if (decision.action === 'proceed') {
      return handler(request, decision.context ?? null);
    }

    return new Response(JSON.stringify(decision.body), {
      status: decision.status ?? 402,
      headers: { 'content-type': 'application/json', ...(decision.headers ?? {}) },
    });
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // A relative URL, which some runtimes hand over. Already a path.
    const index = url.indexOf('?');
    return index === -1 ? url : url.slice(0, index);
  }
}
