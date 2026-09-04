import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { toIsoDate } from '@forge/core';
import { createDatabase, runMigrations, seedDatabase, users, type DatabaseHandle } from '@forge/db';
import { sql } from 'drizzle-orm';
import { loadConfig, type Config } from './config.js';
import { ApiError } from './lib/errors.js';
import type { AppContext } from './lib/context.js';
import { loadPrincipal, type Principal } from './auth/guards.js';
import { resolveSession, SESSION_COOKIE } from './auth/session.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerMemberRoutes } from './routes/member.js';
import { registerTrainingRoutes } from './routes/training.js';
import { registerNutritionRoutes } from './routes/nutrition.js';
import { registerCoachingRoutes } from './routes/coaching.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerCommerceRoutes } from './routes/commerce.js';
import { registerCoachRoutes } from './routes/coach.js';
import { registerAiRoutes } from './routes/ai.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Null for anonymous requests. Routes decide whether that is acceptable. */
    principal: Principal | null;
    readonly ctx: AppContext;
  }
}

export interface BuildOptions {
  config?: Partial<Config>;
  handle?: DatabaseHandle;
  today?: () => string;
  seed?: boolean;
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...options.config } as Config;

  const handle =
    options.handle ??
    (await createDatabase({ url: config.DATABASE_URL, dataDir: config.FORGE_DATA_DIR }));

  if (!options.handle) {
    await runMigrations(handle);
    const shouldSeed = options.seed ?? config.AUTO_SEED;
    if (shouldSeed) {
      const [existing] = await handle.db.select({ count: sql<number>`count(*)::int` }).from(users);
      if ((existing?.count ?? 0) === 0) {
        await seedDatabase(handle, { today: (options.today ?? (() => toIsoDate(new Date())))() });
      }
    }
  }

  const ctx: AppContext = {
    config,
    handle,
    db: handle.db,
    today: options.today ?? (() => toIsoDate(new Date())),
  };

  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    // Behind a proxy the rate limiter must key on the real client, not the LB.
    trustProxy: config.NODE_ENV === 'production',
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // The API serves JSON; the web app sets its own CSP.
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, { secret: config.COOKIE_SECRET });

  await app.register(rateLimit, {
    max: config.NODE_ENV === 'test' ? 100_000 : 600,
    timeWindow: '1 minute',
    // Authenticated members share a much higher budget than an anonymous IP,
    // which is what stops a shared office NAT from locking everyone out.
    keyGenerator: (request: FastifyRequest) => request.principal?.userId ?? request.ip,
  });

  app.decorateRequest('principal', null);
  // Fastify 5 refuses a shared object as a request decorator value, and it is
  // right to: a mutable object would be shared across every in-flight request.
  // The context is genuinely a read-only singleton, so it is exposed as a getter.
  app.decorateRequest('ctx', { getter: () => ctx });

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const session = await resolveSession(ctx.db, token);
    request.principal = session ? await loadPrincipal(ctx.db, session.userId, session.sessionId) : null;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? undefined },
      });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    // Never leak an internal message or stack to a client.
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong on our side.' },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'No such endpoint.' } }),
  );

  app.get('/health', async () => ({
    status: 'ok',
    driver: handle.driver,
    today: ctx.today(),
    version: '1.0.0',
  }));

  await app.register(
    async (v1) => {
      await registerAuthRoutes(v1);
      await registerCatalogRoutes(v1);
      await registerMemberRoutes(v1);
      await registerTrainingRoutes(v1);
      await registerNutritionRoutes(v1);
      await registerCoachingRoutes(v1);
      await registerCommunityRoutes(v1);
      await registerCommerceRoutes(v1);
      await registerCoachRoutes(v1);
      await registerAiRoutes(v1);
    },
    { prefix: '/v1' },
  );

  app.addHook('onClose', async () => {
    if (!options.handle) await handle.close();
  });

  return app;
}
