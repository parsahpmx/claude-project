import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Meter402Error } from '@meter402/shared';
import type { RouteDeps } from '../context.js';
import { createUser, findUserByEmail } from '../../modules/identity/user.repository.js';
import { parseBody } from '../../lib/validation.js';

/**
 * Development-only session minting.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  This route is an authentication bypass by design: it issues a session for
 *  any email without proving control of it. It exists so Phase 1's
 *  authorization and tenant-isolation behaviour can be exercised end to end
 *  before a real identity provider is integrated (Phase 4+).
 *
 *  Two independent guards keep it out of production:
 *    1. `registerV1Routes` only calls this function when DEPLOY_ENV is local
 *       or development — in staging/production the route is never added.
 *    2. The runtime check below refuses even if that call site is changed.
 *
 *  Defence in depth on purpose: guard (1) is easy to break in a refactor, and
 *  the failure mode is catastrophic, so guard (2) makes the mistake loud.
 * ─────────────────────────────────────────────────────────────────────────
 */

const createSessionSchema = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().max(120).optional(),
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
});

export function registerDevSessionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/v1/dev/sessions', async (request, reply) => {
    if (deps.config.isProduction) {
      /* istanbul ignore next -- unreachable via registerV1Routes; kept as a backstop. */
      throw new Meter402Error('RESOURCE_NOT_FOUND');
    }

    const body = parseBody(createSessionSchema, request.body);

    const existing = await findUserByEmail(deps.db, body.email);
    const user =
      existing ??
      (await createUser(deps.db, {
        email: body.email,
        displayName: body.displayName ?? null,
        // Development identities are usable immediately; there is no
        // verification flow to complete yet.
        status: 'ACTIVE',
      }));

    const token = deps.sessionIssuer.issue(user.id, body.ttlSeconds);

    void reply.status(201);
    return {
      data: {
        token,
        userId: user.id,
        email: user.email,
        warning: 'Development session. This endpoint does not exist in staging or production.',
      },
    };
  });
}
