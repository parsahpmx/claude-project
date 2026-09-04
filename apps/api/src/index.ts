/**
 * API entrypoint.
 *
 * Composition root: this is the only file that constructs concrete
 * implementations and wires them together. Everything below it receives its
 * dependencies, which is what keeps the rest of the codebase testable without
 * a database, a chain, or a network.
 */

import { loadConfig, redactConfig, ConfigurationError } from '@meter402/config';
import { createDatabase } from '@meter402/database';
import { FailoverBlockchainProvider, ViemBlockchainProvider } from '@meter402/blockchain';
import type { BlockchainProvider } from '@meter402/blockchain';
import { buildApp } from './app.js';
import { DevelopmentSessionIssuer } from './auth/session.js';
import { HttpFacilitatorClient, preflightFacilitator } from '@meter402/x402';
import { paymentMetrics } from './lib/metrics.js';
import { settlementBacklog } from './modules/payments/settlement-backlog.js';

/**
 * How long to let in-flight requests finish before closing anyway.
 *
 * Under a typical orchestrator's 30-second SIGKILL timer, so the process ends
 * on its own terms with room to spare rather than being killed mid-write.
 */
const SHUTDOWN_DEADLINE_MS = 20_000;

async function main(): Promise<void> {
  /*
   * Flipped at the first signal, read by the readiness probe. Declared here so
   * the probe closes over it before `shutdown` is defined.
   */
  let draining = false;

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Configuration problems must be legible without a log aggregator: this
    // is the failure a deploy hits, and the operator is reading a terminal.
    if (error instanceof ConfigurationError) {
      console.error(`\nMeter402 refused to start.\n\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const database = createDatabase(config.database.url, {
    maxConnections: 10,
    ssl: config.isProduction,
  });

  /*
   * Providers are pooled behind failover only when a secondary is configured.
   * A single-element failover pool would still work, but wrapping one provider
   * in a breaker means an outage takes the circuit open and then has nothing
   * to fail over to — better to let the single provider's own errors surface.
   */
  const primary = new ViemBlockchainProvider({
    chainId: config.chain.chainId,
    rpcUrl: config.chain.primaryRpcUrl,
    name: 'primary',
  });

  let blockchain: BlockchainProvider = primary;
  if (config.chain.secondaryRpcUrl) {
    blockchain = new FailoverBlockchainProvider(
      [
        primary,
        new ViemBlockchainProvider({
          chainId: config.chain.chainId,
          rpcUrl: config.chain.secondaryRpcUrl,
          name: 'secondary',
        }),
      ],
      {
        onProviderError: (providerName, error) => {
          app?.log.warn({ providerName, err: error }, 'RPC provider call failed');
        },
      },
    );
  }

  /*
   * The x402 facilitator, constructed only when real settlement is switched
   * on. Absent otherwise, so a deployment with settlement disabled has no
   * client that could accidentally be called — the capability does not exist
   * rather than existing and being guarded.
   */
  const facilitator = config.settlement.liveSettlementEnabled
    ? new HttpFacilitatorClient({
        // Config validation guarantees a URL whenever settlement is enabled.
        baseUrl: config.settlement.facilitator.url as string,
        apiKey: config.settlement.facilitator.apiKey,
        timeoutMs: config.settlement.facilitator.timeoutMs,
      })
    : undefined;

  /*
   * Prove the facilitator can actually settle what this deployment will
   * promise, before the deployment starts promising it. See
   * `preflightFacilitator` for why an incompatible answer stops the boot and
   * an unreachable one does not.
   */
  let facilitatorPreflight: string | null = null;
  if (facilitator) {
    const preflight = await preflightFacilitator({
      facilitator,
      chainIds: config.settlement.enabledChainIds,
    });

    if (preflight.status === 'INCOMPATIBLE') {
      console.error(
        `\nMeter402 refused to start.\n\n${preflight.message}\n\n` +
          'Fix X402_FACILITATOR_URL, or set LIVE_SETTLEMENT_ENABLED=false to ' +
          'run without real settlement.\n',
      );
      await database.close();
      process.exitCode = 1;
      return;
    }

    facilitatorPreflight = preflight.status;
  }

  const app = await buildApp({
    config,
    routes: {
      db: database.db,
      config,
      // Development adapter. The route that mints these tokens is only
      // registered outside staging and production; see routes/v1/index.ts.
      sessionIssuer: new DevelopmentSessionIssuer(config.secrets.authSecret),
      ...(facilitator ? { facilitator } : {}),
    },
    /*
     * Readiness names only the dependencies this deployment actually needs to
     * serve traffic.
     *
     * Redis is configured but unused by the API, so it is absent rather than
     * reported as a hardcoded `true` — a check that always passes is worse
     * than no check, because it reports health nobody verified.
     *
     * The chain is conditional for a sharper reason. With settlement disabled
     * no request path touches an RPC provider: TEST payments are simulated
     * end to end. Probing it anyway means a deployment that is completely
     * healthy for what it does is held out of the load balancer because
     * something it never calls is unreachable — and the first thing a
     * developer meets, running locally behind a firewall, is a server that
     * says it is not ready and is wrong about it. When settlement *is*
     * enabled the chain is genuinely required, and then it is probed.
     */
    probes: {
      /*
       * Named for what it reports, not for the state it watches: every other
       * probe here answers "is this healthy", and a check called `draining`
       * answering `true` for "not draining" reads backwards at exactly the
       * moment someone is reading it in a hurry.
       *
       * Flips the instant shutdown begins, before anything is actually closed,
       * so the load balancer stops routing here while in-flight requests
       * finish.
       */
      acceptingTraffic: async () => !draining,
      database: () => database.ping(),
      ...(config.settlement.liveSettlementEnabled
        ? { blockchain: () => blockchain.healthCheck() }
        : {}),
    },
    /*
     * Payment capability is reported separately from readiness. A facilitator
     * outage degrades payments; it must not pull the task out of rotation and
     * take the dashboard down with it. See routes/health.ts.
     */
    paymentHealth: {
      settlementEnabled: config.settlement.liveSettlementEnabled,
      enabledNetworks: config.settlement.enabledChainIds.map((id) => `eip155:${id}`),
      /*
       * Same reasoning as readiness: with settlement disabled nothing here
       * touches a chain or a facilitator, so reporting either as unhealthy
       * describes a dependency this deployment does not have.
       */
      probes: config.settlement.liveSettlementEnabled
        ? {
            blockchain: () => blockchain.healthCheck(),
            ...(facilitator ? { facilitator: () => facilitator.health() } : {}),
          }
        : {},
      metrics: () => paymentMetrics.snapshot(),
      backlog: () => settlementBacklog(database.db),
    },
  });

  app.log.info({ config: redactConfig(config) }, 'Starting Meter402 API');

  if (facilitatorPreflight === 'UNREACHABLE') {
    /*
     * Not fatal, but not a footnote either: real settlement is enabled and
     * the facilitator did not answer, so payments will fail until it does.
     */
    app.log.error(
      { facilitatorUrl: config.settlement.facilitator.url },
      'Facilitator unreachable at startup; real settlement will fail until it recovers',
    );
  }

  /*
   * Graceful shutdown. On SIGTERM the orchestrator has already stopped routing
   * new traffic; we finish in-flight requests before closing the pool. Killing
   * connections mid-verification would strand payments in SUBMITTED that we
   * would then have to reconcile.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');

    /*
     * Leave the rotation first, and only then drain.
     *
     * `/ready` starts answering not-ready immediately, so the load balancer
     * stops sending new requests while the ones already in flight finish. The
     * other order — close, then stop being routed to — means every request
     * arriving during the close is refused by a socket that is going away, and
     * some of those are payments.
     */
    draining = true;

    /*
     * A deadline, because `app.close()` waits for in-flight requests and a
     * request waiting on an unresponsive facilitator can outlive the
     * orchestrator's patience. Being killed mid-close is worse than closing
     * ourselves: it strands a payment in SUBMITTED that reconciliation then has
     * to work out from the chain.
     *
     * Deliberately shorter than a typical 30s SIGKILL timer, so we finish on
     * our own terms with room to spare.
     */
    const deadline = new Promise<'timeout'>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), SHUTDOWN_DEADLINE_MS);
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([app.close().then(() => 'closed' as const), deadline]);
      if (outcome === 'timeout') {
        app.log.warn(
          { deadlineMs: SHUTDOWN_DEADLINE_MS },
          'Requests still in flight at the shutdown deadline; closing anyway',
        );
      }

      // The pool last, so nothing is still trying to write when it goes.
      await database.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
      process.exitCode = 1;
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.api.port, host: config.api.host });
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});
