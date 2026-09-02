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

async function main(): Promise<void> {
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
     * Only dependencies we genuinely check appear here. Redis is configured
     * but not yet used by the API, so it is deliberately absent rather than
     * reported as a hardcoded `true` — a check that always passes is worse
     * than no check, because it reports health nobody verified.
     */
    /*
     * Only dependencies we genuinely check. The facilitator probe is added
     * only when settlement is enabled: reporting on a dependency this
     * deployment does not use would be noise, and reporting it as healthy
     * when it is not configured would be a lie.
     */
    probes: {
      database: () => database.ping(),
      blockchain: () => blockchain.healthCheck(),
    },
    /*
     * Payment capability is reported separately from readiness. A facilitator
     * outage degrades payments; it must not pull the task out of rotation and
     * take the dashboard down with it. See routes/health.ts.
     */
    paymentHealth: {
      settlementEnabled: config.settlement.liveSettlementEnabled,
      enabledNetworks: config.settlement.enabledChainIds.map((id) => `eip155:${id}`),
      probes: {
        blockchain: () => blockchain.healthCheck(),
        ...(facilitator ? { facilitator: () => facilitator.health() } : {}),
      },
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
    try {
      await app.close();
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
