import type { FastifyInstance } from 'fastify';
import { listOrganizationsForUser } from '../../modules/identity/organization.repository.js';
import { getPrincipal, type RouteDeps } from '../context.js';

/**
 * Credential introspection.
 *
 * "What is this credential, and what can it do?" — the first thing anyone
 * integrating asks, and the first thing they need when a call is unexpectedly
 * rejected. Accepts either principal type and describes it accurately.
 *
 * Requires no scope: a credential is always entitled to describe itself, and
 * gating self-introspection behind a scope would make the endpoint useless
 * for exactly the debugging case it exists for. It reveals nothing the holder
 * of the credential does not already possess.
 */
export function registerMeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/v1/me', async (request) => {
    const principal = getPrincipal(request);

    if (principal.type === 'api_key') {
      return {
        data: {
          type: 'api_key',
          apiKeyId: principal.apiKeyId,
          organizationId: principal.organizationId,
          projectId: principal.projectId,
          environment: principal.environment,
          scopes: principal.scopes,
        },
      };
    }

    const organizations = await listOrganizationsForUser(deps.db, principal.userId);
    return {
      data: {
        type: 'user',
        userId: principal.userId,
        organizations: organizations.map((organization) => ({
          id: organization.id,
          slug: organization.slug,
          role: organization.role,
        })),
      },
    };
  });
}
