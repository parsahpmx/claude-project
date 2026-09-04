import type { FastifyInstance } from 'fastify';
import { DeployEnvironment } from '@meter402/shared';
import { authenticate } from '../../auth/authenticate.js';
import type { RouteDeps } from '../context.js';
import { registerOrganizationRoutes } from './organizations.js';
import { registerProjectRoutes } from './projects.js';
import { registerApiKeyRoutes } from './api-keys.js';
import { registerMeRoutes } from './me.js';
import { registerDevSessionRoutes } from './dev-sessions.js';
import { registerEndpointRoutes } from './endpoints.js';
import { registerPaymentRoutes } from './payments.js';
import { registerPaidRoutes } from './paid.js';
import { registerAuthorizeRoutes } from './authorize.js';
import { registerSettlementRoutes } from './settlement.js';

/**
 * The /v1 surface.
 *
 * Authentication is a `preHandler` on this whole scope rather than a call at
 * the top of each handler. A route added later is authenticated by default;
 * forgetting is not an available mistake. Handlers then narrow the principal
 * to the kind they accept and check permissions or scopes.
 */
export async function registerV1Routes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook('preHandler', async (request) => {
      request.principal = await authenticate(
        {
          db: deps.db,
          sessionIssuer: deps.sessionIssuer,
          apiKeyPepper: deps.config.secrets.apiKeyHashPepper,
        },
        request.headers.authorization,
      );
    });

    registerMeRoutes(scope, deps);
    registerOrganizationRoutes(scope, deps);
    registerProjectRoutes(scope, deps);
    registerApiKeyRoutes(scope, deps);
    registerEndpointRoutes(scope, deps);
    registerPaymentRoutes(scope, deps);
    registerPaidRoutes(scope, deps);
    registerAuthorizeRoutes(scope, deps);
    registerSettlementRoutes(scope, deps);
  });

  /*
   * The development session route is registered OUTSIDE the authenticated
   * scope (it mints the credential) and only in local/development. In staging
   * and production the route does not exist at all — not disabled by a flag
   * that could be flipped, simply never added to the router. There is a test
   * asserting it 404s under a production config.
   */
  const devEnvironments: readonly DeployEnvironment[] = [
    DeployEnvironment.Local,
    DeployEnvironment.Development,
  ];
  if (devEnvironments.includes(deps.config.deployEnv)) {
    registerDevSessionRoutes(app, deps);
  }
}
