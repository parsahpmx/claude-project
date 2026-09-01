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

/**
 * Dependencies that only real payment processing needs.
 *
 * Kept separate from `HealthProbes` on purpose — see `/health/payments` below
 * for why a facilitator outage must not take the whole task out of rotation.
 */
export interface PaymentHealth {
  readonly settlementEnabled: boolean;
  readonly enabledNetworks: readonly string[];
  readonly probes: HealthProbes;
  readonly metrics: () => unknown;
}

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

/**
 * Payment-processing health.
 *
 * ── Why this is separate from `/ready` ───────────────────────────────────
 * A facilitator outage must NOT fail readiness. `/ready` decides whether this
 * task stays in the load-balancer rotation, and pulling every task out because
 * an external payment vendor is down would also take out the dashboard, the
 * simulated TEST flow, and every read endpoint — converting a partial
 * degradation into a total outage, which is strictly worse than the problem.
 *
 * So the split is deliberate and is the answer to Phase 3 STEP 54:
 *
 *   /health          liveness      — is this process alive? touches nothing
 *   /ready           rotation      — database only; can this task serve at all?
 *   /health/payments capability    — can real settlement happen right now?
 *
 * The last one is what an alert should watch, and what a status page should
 * report. It returns 200 with `settlement: "degraded"` rather than a 5xx,
 * because the question it answers is "what is true", not "should I restart".
 * It reports honestly when settlement is switched off, which is not an error
 * either — it is a configuration, and a deployment with settlement disabled is
 * perfectly healthy.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function registerPaymentHealthRoute(app: FastifyInstance, payments: PaymentHealth): void {
  app.get('/health/payments', async () => {
    const names = Object.keys(payments.probes);
    const results = await Promise.all(
      names.map(async (name) => {
        const probe = payments.probes[name];
        /* istanbul ignore next -- names come from the same object. */
        if (!probe) return [name, false] as const;
        try {
          return [name, await probe()] as const;
        } catch {
          // A probe that throws is a probe that failed. Never a 500 here.
          return [name, false] as const;
        }
      }),
    );

    const dependencies = Object.fromEntries(results);
    const allHealthy = results.every(([, healthy]) => healthy);

    return {
      // Three honest states rather than a boolean that has to lie about one.
      settlement: !payments.settlementEnabled ? 'disabled' : allHealthy ? 'available' : 'degraded',
      enabledNetworks: payments.enabledNetworks,
      dependencies,
      metrics: payments.metrics(),
    };
  });
}
