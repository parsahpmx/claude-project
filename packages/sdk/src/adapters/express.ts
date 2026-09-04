import type { Meter402 } from '../index.js';
import type { Meter402Context } from '../types.js';
import { decisionFrom, decisionFromError, resolveRoute, type AdapterOptions } from './shared.js';

/**
 * Express.
 *
 *     import { createMeter402 } from '@meter402/sdk';
 *     import { protect } from '@meter402/sdk/express';
 *
 *     const meter = createMeter402({ apiKey: process.env.METER402_API_KEY! });
 *
 *     app.post('/research', protect(meter, { price: '0.03' }), researchHandler);
 *
 * The handler is unchanged. `req.meter402` carries the payment that bought
 * the request, for merchants who want to record it against their own usage.
 */

/** The shape we need from Express, declared structurally so we need no dependency on it. */
interface ExpressRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  meter402?: Meter402Context;
}

interface ExpressResponse {
  status(code: number): ExpressResponse;
  set(field: string, value: string): ExpressResponse;
  json(body: unknown): unknown;
  send(body?: unknown): unknown;
}

type NextFunction = (error?: unknown) => void;

export type Meter402Request = ExpressRequest & { meter402?: Meter402Context };

export function protect(meter: Meter402, options: AdapterOptions = {}) {
  const failureMode = options.onUnavailable ?? 'closed';

  return async function meter402Middleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const route = resolveRoute(options, {
      method: req.method,
      // `path` first: on a mounted router `originalUrl` includes the mount
      // prefix, which is not what the endpoint was registered as.
      path: req.path ?? req.originalUrl ?? req.url ?? '/',
    });

    let decision;
    try {
      decision = decisionFrom(await meter.authorize({ ...route, headers: req.headers }));
    } catch (error) {
      options.onError?.(error);
      decision = decisionFromError(error, failureMode);
    }

    if (decision.action === 'proceed') {
      if (decision.context) req.meter402 = decision.context;
      next();
      return;
    }

    for (const [name, value] of Object.entries(decision.headers ?? {})) {
      res.set(name, value);
    }
    res.status(decision.status ?? 402).json(decision.body);
  };
}
