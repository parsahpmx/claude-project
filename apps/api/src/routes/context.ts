import type { FastifyRequest } from 'fastify';
import { Meter402Error } from '@meter402/shared';
import type { Database } from '@meter402/database';
import type { AppConfig } from '@meter402/config';
import type { Principal } from '@meter402/auth';
import type { SessionIssuer } from '../auth/session.js';
import type { ActorContext } from '../modules/identity/membership.service.js';

export interface RouteDeps {
  readonly db: Database;
  readonly config: AppConfig;
  readonly sessionIssuer: SessionIssuer;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by the authentication hook on every /v1 route. Optional in the type
     * because Fastify decorates lazily; `getPrincipal` is the only sanctioned
     * reader and it fails closed.
     */
    principal?: Principal;
  }
}

/**
 * Read the authenticated principal.
 *
 * Throws rather than returning undefined, so a route that is somehow reached
 * without the authentication hook fails closed instead of running with no
 * caller identity.
 */
export function getPrincipal(request: FastifyRequest): Principal {
  const principal = request.principal;
  /* istanbul ignore next -- the hook runs for every /v1 route. */
  if (!principal) {
    throw new Meter402Error('AUTHENTICATION_REQUIRED');
  }
  return principal;
}

/** Request metadata attached to audit events. */
export function actorContext(request: FastifyRequest, actorUserId: string): ActorContext {
  return {
    actorUserId,
    requestId: String(request.id),
    ipAddress: request.ip,
    // Bounded: a User-Agent is attacker-controlled and unbounded in principle.
    userAgent: (request.headers['user-agent'] ?? null)?.slice(0, 256) ?? null,
  };
}
