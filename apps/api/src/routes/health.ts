import type { FastifyInstance } from 'fastify';

/**
 * Named dependency probes.
 *
 * A map rather than a fixed shape so that readiness reports exactly the
 * dependencies we actually check. A hardcoded `true` for something we do not
 * probe is worse than omitting it: it reports health we have not verified, and
 * the first time that dependency fails the endpoint says everything is fine.
 */
export type HealthProbes = Readonly<Record<string, () => Promise<boolean>>>;

const startedAt = Date.now();

export function registerHealthRoutes(app: FastifyInstance, probes: HealthProbes): void {
  /**
   * Liveness.
   *
   * Deliberately touches no dependency. A liveness probe that fails when the
   * database is slow causes the orchestrator to restart healthy processes
   * during a database incident — turning a degradation into an outage, and
   * dropping in-flight payment verifications with it. Liveness answers exactly
   * one question: is this process still able to serve?
   */
  app.get('/health', async () => ({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  /**
   * Readiness.
   *
   * This one does check dependencies, because a task that cannot reach its
   * database should leave the load balancer rotation — but not be restarted.
   *
   * Probes run in parallel and never throw: one that rejects is reported as
   * not-ready rather than producing a 500, so the readiness endpoint stays
   * reliable precisely when everything else is not.
   */
  app.get('/ready', async (request, reply) => {
    const names = Object.keys(probes);
    const results = await Promise.all(
      names.map(async (name) => {
        const probe = probes[name];
        /* istanbul ignore next -- names come from the same object. */
        if (!probe) return [name, false] as const;
        try {
          return [name, await probe()] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );

    const checks = Object.fromEntries(results);
    const ready = results.every(([, ok]) => ok);

    if (!ready) {
      request.log.warn({ checks }, 'Readiness check failed');
      void reply.status(503);
    }

    return { status: ready ? 'ready' : 'not_ready', checks };
  });
}
