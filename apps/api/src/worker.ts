import { loadConfig, redactConfig, ConfigurationError } from '@meter402/config';
import { createDatabase } from '@meter402/database';
import { ViemSettlementOracle } from '@meter402/blockchain';
import type { SettlementOracle } from '@meter402/blockchain';
import { ReconciliationWorker } from './modules/payments/reconciliation.service.js';
import { paymentMetrics } from './lib/metrics.js';

/**
 * The reconciliation worker process.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Separate from the API on purpose. Reconciliation is operational work with
 * its own failure modes, its own pace, and its own appetite for connections;
 * running it inside a request-serving process means it competes with payments
 * for the pool exactly when there is a backlog — which is exactly when
 * payments are already struggling.
 *
 * Run one, or run several. The queue is claimed with `FOR UPDATE SKIP
 * LOCKED`, so workers partition it between them rather than fighting over its
 * head, and a worker that dies mid-job leaves a row that the next pass
 * requeues.
 *
 *     pnpm --filter @meter402/api worker
 * ─────────────────────────────────────────────────────────────────────────
 */

const POLL_INTERVAL_MS = Number(process.env['RECONCILIATION_INTERVAL_MS'] ?? 30_000);

/**
 * How long to let an in-flight pass finish on shutdown.
 *
 * A pass is a sequence of database transactions, each of which is safe to be
 * interrupted between — the constraints do the work, not the process. This is
 * about not leaving a job stuck in IN_PROGRESS for the stall timeout when a
 * couple of seconds would have let it resolve cleanly.
 */
const SHUTDOWN_DEADLINE_MS = 15_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(`\nThe reconciliation worker refused to start.\n\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  /*
   * A minimal structured logger rather than a logging dependency. This process
   * emits a handful of lines an hour; pulling in a framework for that would be
   * more configuration surface than logging.
   */
  const log = {
    info: (fields: Record<string, unknown>, message: string) =>
      console.log(JSON.stringify({ level: 'info', time: Date.now(), ...fields, msg: message })),
    warn: (message: string) =>
      console.warn(JSON.stringify({ level: 'warn', time: Date.now(), msg: message })),
    error: (fields: Record<string, unknown>, message: string) =>
      console.error(JSON.stringify({ level: 'error', time: Date.now(), ...fields, msg: message })),
  };

  if (!config.settlement.liveSettlementEnabled) {
    /*
     * Nothing to reconcile. Simulated TEST payments settle synchronously and
     * cannot be uncertain, so a worker here would poll an empty queue forever
     * and give an operator a green process that means nothing.
     */
    log.warn(
      'Real settlement is disabled, so there is nothing to reconcile. Exiting rather than ' +
        'idling — a running worker should mean uncertain payments are being resolved.',
    );
    return;
  }

  const database = createDatabase(config.database.url, {
    // Smaller than the API's: this is a background drain, not a request path,
    // and it must not be able to starve payments of connections.
    maxConnections: 5,
    ssl: config.isProduction,
  });

  /*
   * One oracle per enabled chain. A chain with no oracle cannot be reconciled,
   * and the worker says so per job rather than failing at startup — a
   * misconfigured second chain must not stop the first from being resolved.
   */
  const oracles = new Map<number, SettlementOracle>();
  for (const chainId of config.settlement.enabledChainIds) {
    oracles.set(chainId, new ViemSettlementOracle(chainId, config.chain.primaryRpcUrl));
  }

  const worker = new ReconciliationWorker({ db: database.db, config, oracles }, POLL_INTERVAL_MS, {
    // This process exists to run the loop; it should not exit when idle.
    keepProcessAlive: true,
  });

  log.info(
    { config: redactConfig(config), intervalMs: POLL_INTERVAL_MS, chains: [...oracles.keys()] },
    'Starting the reconciliation worker',
  );
  worker.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Stopping the reconciliation worker');

    // Stop claiming new work first, so the deadline below covers only what is
    // already in flight.
    worker.stop();

    const deadline = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SHUTDOWN_DEADLINE_MS);
      timer.unref?.();
    });

    try {
      await Promise.race([worker.drain(), deadline]);
      await database.close();
      log.info({ metrics: paymentMetrics.snapshot() }, 'Reconciliation worker stopped');
      process.exitCode = 0;
    } catch (error) {
      log.error({ err: error }, 'Error stopping the reconciliation worker');
      process.exitCode = 1;
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('Fatal worker error:', error);
  process.exitCode = 1;
});
