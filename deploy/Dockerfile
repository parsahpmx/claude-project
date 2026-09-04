# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Meter402 API and reconciliation worker.
#
# One image, two entry points. They share every dependency and differ only in
# which file they start, so building them separately would double the build for
# no benefit and let the two drift apart.
#
# Multi-stage so the runtime image carries no build toolchain, no source, and
# no dev dependencies. Nothing is COPYed into a layer that should not survive:
# in particular no .env, and no secrets — those are injected at runtime, and a
# secret baked into a layer is in the registry forever.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────────────
# Manifests first, so a source change does not invalidate the install layer.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/auth/package.json packages/auth/
COPY packages/blockchain/package.json packages/blockchain/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/payments/package.json packages/payments/
COPY packages/pricing/package.json packages/pricing/
COPY packages/shared/package.json packages/shared/
COPY packages/x402/package.json packages/x402/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @meter402/api...

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @meter402/api... build

# Drop dev dependencies now that nothing needs to compile.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm prune --prod

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Unprivileged. The node image ships a `node` user; use it rather than root.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api

EXPOSE 8080

# Liveness only — it touches no dependency, so a slow database does not get a
# healthy process restarted. Readiness is the orchestrator's job, against
# /ready.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The API by default. The worker overrides this — see deploy/README.md.
CMD ["node", "apps/api/dist/index.js"]
