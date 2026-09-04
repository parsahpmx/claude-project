# Deploying Meter402

## Status

**Not deployed, and the image has not been built.** These artifacts are
written but unverified: there is no Docker daemon in the environment they were
authored in, and no host or credentials to deploy to.

What *has* been verified is the part the Dockerfile depends on — that
`pnpm build` produces `apps/api/dist/index.js` and `apps/api/dist/worker.js`,
the two entry points the image starts. Everything else here — the layer
caching, the prune, the healthcheck, the compose wiring — is unexercised and
should be treated as a first draft until someone runs `docker build`.

See `docs/PHASE_4_COMPLETION_REPORT.md`.

## What is here

| File | What it is |
| --- | --- |
| `Dockerfile` | One image, two entry points: API and reconciliation worker |
| `docker-compose.staging.yml` | The smallest production-shaped topology |

Deliberately not Kubernetes. The topology is an API, a worker, a database and a
cache; an orchestrator adds operational surface and buys nothing at this size.
The image is the same either way, so this is not a decision that has to be
re-made later.

## Environments

Four, and they share nothing:

| | Database | Secrets | Settlement | Mainnet |
| --- | --- | --- | --- | --- |
| development | local | `.env`, git-ignored | off | off |
| test | ephemeral | fixtures | off | off |
| staging | own instance | secret manager | testnet, optional | **off** |
| production | own instance | secret manager | testnet only today | **off** |

**Never reuse a secret between environments.** The config loader refuses to
start if two secrets within one environment are equal; nothing can enforce
separation *across* environments except the people setting them.

## Deploying to staging

```bash
# 1. Secrets, from your secret manager. Never from a file in the repository.
export AUTH_SECRET=$(...)  API_KEY_HASH_PEPPER=$(...)  # etc.

# 2. Back up first. Always, even when the migration looks harmless.
docker compose -f deploy/docker-compose.staging.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backup-$(date -Is).sql.gz"

# 3. Migrate, as its own step.
docker compose -f deploy/docker-compose.staging.yml run --rm api \
  node packages/database/dist/migrate.js

# 4. Deploy.
docker compose -f deploy/docker-compose.staging.yml up -d --build

# 5. Verify. Not optional — a deploy is not done because it started.
curl -fsS "$PUBLIC_BASE_URL/health"
curl -fsS "$PUBLIC_BASE_URL/ready"
curl -fsS "$PUBLIC_BASE_URL/health/payments" | jq .
```

### Why migration is a separate step

Running migrations from application startup means every replica races to apply
them, and a failed migration takes down a process that was otherwise fine. As
its own step it either succeeds or the deploy stops before anything is
replaced.

**No destructive migration runs automatically.** A migration that drops a
column or a table is applied by hand, after a backup, by someone who has read
it. The tooling will not stop you; this document is the control.

### Rolling back

The application rolls back by deploying the previous image. The database does
not: a migration that has run has run, and the previous image must still work
against the new schema. So migrations are additive by default — add a column,
deploy, migrate reads, and only remove the old one a release later.

If a migration must be reversed, restore from the backup taken in step 2 and
read [`../docs/runbooks/DATABASE_OUTAGE.md`](../docs/runbooks/DATABASE_OUTAGE.md)
first — the chain does not roll back with you, and payments that settled after
the restore point still exist on it.

## The worker

```bash
docker compose -f deploy/docker-compose.staging.yml up -d worker
```

Run one or several. The queue is claimed with `FOR UPDATE SKIP LOCKED`, so
workers partition it rather than fighting over its head, and adding one needs
no coordination.

It **exits immediately when settlement is disabled**, by design: a running
reconciliation worker should mean uncertain payments are being resolved, and
there are none without real settlement. A worker that exits in a TEST-only
deployment is correct, not broken.

## Shutdown

Both processes handle SIGTERM and SIGINT.

The API stops reporting ready *before* it closes, so the load balancer stops
routing while in-flight requests finish, then closes with a 20-second deadline
— under a typical 30-second SIGKILL timer, so it finishes on its own terms
rather than being killed mid-write. Then the pool closes.

The worker stops claiming new jobs, waits up to 15 seconds for the pass already
running, and closes.

`stop_grace_period` in the compose file is set above each deadline. Setting it
lower would make the deadlines pointless.

## Secrets

Injected at runtime, from a secret manager. Never in the repository, never in
an image layer — a secret baked into a layer is in the registry forever, and
deleting the tag does not remove it.

Required in production: `DATABASE_URL`, `AUTH_SECRET`, `API_KEY_HASH_PEPPER`,
`WEBHOOK_SIGNING_SECRET`, `TEST_SIMULATOR_SECRET`, `BASE_RPC_URL`,
`USDC_CONTRACT_ADDRESS`. With settlement enabled, also `X402_FACILITATOR_URL`
and usually `X402_FACILITATOR_API_KEY`.

The config loader refuses to start on a missing, empty, too-short, duplicated,
or placeholder-looking secret. `packages/config/src/production-safety.test.ts`
asserts each of those.

## Mainnet

`ENABLE_BASE_MAINNET` is pinned to `'false'` in the staging compose file rather
than left to a variable. It stays that way until
[`../docs/MAINNET_READINESS.md`](../docs/MAINNET_READINESS.md) says otherwise,
which today it does not.
