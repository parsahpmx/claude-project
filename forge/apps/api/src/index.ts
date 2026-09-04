import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/**
 * Server entry point. Boot failures exit non-zero rather than leaving a
 * half-started process that a health check would call healthy.
 */
const config = loadConfig();

try {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
} catch (error) {
  console.error('[forge-api] failed to start', error);
  process.exit(1);
}
