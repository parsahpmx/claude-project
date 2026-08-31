import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Meter402Error, isMeter402Error, newRequestId, toPublicError } from '@meter402/shared';
import type { AppConfig } from '@meter402/config';
import { registerHealthRoutes, type HealthProbes } from './routes/health.js';

export interface BuildAppOptions {
  readonly config: AppConfig;
  /**
   * Dependency probes for /ready. Injected rather than constructed here so
   * tests can exercise degraded states — "Redis is down" is a case worth
   * testing and impossible to stage otherwise.
   */
  readonly probes?: HealthProbes;
  /**
   * Disable logging entirely. For tests only — several of them deliberately
   * provoke 500s, and the resulting stack traces drown the actual results.
   */
  readonly silent?: boolean;
}

/**
 * Header and body fields that must never reach a log sink.
 *
 * pino applies this at serialisation time, so a stray `request.log.info({ req })`
 * cannot leak a credential even if someone adds one carelessly. The list is
 * deliberately broader than what we log today — it costs nothing and protects
 * against future carelessness.
 */
const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-payment"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.secret',
  '*.password',
  '*.apiKey',
  '*.keyHash',
  '*.signingSecret',
  '*.authSecret',
  '*.pepper',
];

/**
 * Map anything thrown during a request to a client-safe error.
 *
 * Three cases, in order:
 *
 *  1. A domain error already says exactly what it is.
 *  2. A framework error carrying a 4xx status is the *caller's* mistake —
 *     malformed JSON, an unsupported content type, a body over the limit.
 *     Reporting those as 500 would mislead the client and page us for their
 *     bug, so the status is preserved. Their messages are framework-generated
 *     and safe to forward, which we confirm by requiring an `FST_ERR_` code
 *     rather than trusting any object that happens to carry a `statusCode`.
 *  3. Everything else is unexpected. `toPublicError` discards the message,
 *     because an arbitrary throwable can carry a connection string, another
 *     tenant's row, or a filesystem path.
 */
function toResponseError(error: unknown): Meter402Error {
  if (isMeter402Error(error)) {
    return error;
  }

  const candidate = error as { statusCode?: unknown; code?: unknown; validation?: unknown };
  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined;

  if (status !== undefined && status >= 400 && status < 500) {
    const isFastifyError = typeof candidate.code === 'string' && candidate.code.startsWith('FST_');
    const isSchemaValidation = candidate.validation !== undefined;
    const safeMessage =
      (isFastifyError || isSchemaValidation) && error instanceof Error ? error.message : undefined;

    switch (status) {
      case 401:
        return new Meter402Error('AUTHENTICATION_REQUIRED');
      case 403:
        return new Meter402Error('PERMISSION_DENIED');
      case 404:
        return new Meter402Error('RESOURCE_NOT_FOUND');
      case 429:
        return new Meter402Error('RATE_LIMITED');
      case 413:
        return new Meter402Error('VALIDATION_FAILED', 'Request body exceeds the size limit.', {
          httpStatus: 413,
        });
      default:
        // Keep the framework's status (400, 415, …) so intermediaries and
        // client libraries see the accurate transport-level reason, while the
        // machine-readable code stays stable.
        return new Meter402Error('VALIDATION_FAILED', safeMessage, { httpStatus: status });
    }
  }

  return toPublicError(error);
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  /*
   * Typed as FastifyServerOptions rather than passed inline. `logger` is a
   * `boolean | object` union here, and inline that makes TypeScript select
   * Fastify's HTTP/2 constructor overload, which then fails declaration emit.
   */
  const serverOptions: FastifyServerOptions = {
    /*
     * Every request gets a ULID-based ID that appears on every log line for
     * that request and in every error body. A support conversation then starts
     * from a single identifier instead of the customer pasting a payload.
     */
    genReqId: () => newRequestId(),
    requestIdHeader: false,
    logger:
      options.silent === true
        ? false
        : {
            level: config.logLevel,
            redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
            /*
             * Narrow the request/response serialisers to the fields we actually
             * debug with. Fastify's defaults already exclude headers, so this is not
             * what keeps credentials out of logs — `redact` above is — but a smaller
             * log line is cheaper at volume and leaves less room for a future field
             * to arrive carrying something sensitive.
             *
             * Parameter types are inferred from FastifyServerOptions rather than
             * annotated: the serialiser signatures use Fastify's internal
             * RawRequest/ResSerializerReply types, not FastifyRequest/FastifyReply.
             */
            serializers: {
              req(request) {
                return { method: request.method, url: request.url, requestId: request.id };
              },
              res(reply) {
                return { statusCode: reply.statusCode };
              },
            },
          },
    /*
     * A payment challenge and a proof are both small. Anything larger is not a
     * legitimate API call, and accepting it just gives an attacker a cheap way
     * to make us allocate.
     */
    bodyLimit: 256 * 1024,
    /* Trust the ALB's X-Forwarded-For so rate limiting sees the real client. */
    trustProxy: config.deployEnv !== 'local',
  };

  const app = Fastify(serverOptions);

  await app.register(helmet, {
    // The API serves JSON only, so nothing needs to execute or embed.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    // Explicit origin, never `*`. A wildcard with credentials is refused by
    // browsers anyway, and permitting arbitrary origins on a credentialed API
    // is how a dashboard XSS becomes an account takeover.
    origin: [config.api.dashboardOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Payment'],
    exposedHeaders: ['X-Request-Id', 'X-Payment-Response', 'Retry-After'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    /*
     * In-memory store. Correct for a single instance; production must switch
     * this to the Redis store or each task will enforce its own independent
     * limit, multiplying the effective ceiling by the task count.
     */
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (request) => {
      const error = new Meter402Error('RATE_LIMITED');
      return error.toEnvelope(String(request.id));
    },
  });

  /* Echo the request ID so a client can quote it without parsing the body. */
  app.addHook('onRequest', async (request, reply) => {
    void reply.header('X-Request-Id', String(request.id));
  });

  /**
   * Single error exit.
   *
   * `toPublicError` maps anything unrecognised to INTERNAL_ERROR and discards
   * its message: an arbitrary throwable can carry a connection string, a row
   * belonging to another tenant, or a file path, and none of that belongs in
   * an HTTP response. The original is logged under the same request ID, so
   * nothing is lost operationally.
   */
  app.setErrorHandler((error, request, reply) => {
    const publicError = toResponseError(error);

    if (publicError.httpStatus >= 500) {
      request.log.error({ err: error, code: publicError.code }, 'Request failed');
    } else {
      request.log.warn(
        { code: publicError.code, status: publicError.httpStatus },
        'Request rejected',
      );
    }

    if (publicError.retryable && publicError.httpStatus === 503) {
      void reply.header('Retry-After', '5');
    }

    void reply.status(publicError.httpStatus).send(publicError.toEnvelope(String(request.id)));
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new Meter402Error(
      'RESOURCE_NOT_FOUND',
      `No route matches ${request.method} ${request.url}.`,
    );
    void reply.status(404).send(error.toEnvelope(String(request.id)));
  });

  registerHealthRoutes(app, options.probes ?? {});

  return app;
}
