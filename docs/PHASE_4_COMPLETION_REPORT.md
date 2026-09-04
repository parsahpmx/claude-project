# Phase 4 — Completion Report

Commits `5d2ff54` … `e53cda7` and the two that follow, on
`claude/meter402-startup-master-wkzasr`.

---

## PRODUCT

Before Phase 4, Meter402 could take payments but no merchant could use it.
`/v1/paid/*` served requests *inside* Meter402 — fine for a demo, useless for a
merchant whose handler lives on their own server with their own data.

A developer can now:

```bash
npx meter402 init --path /research --price 0.03
pnpm add @meter402/sdk
```

```ts
app.post('/research', protect(meter, { price: '0.03' }), researchHandler);
```

and their route costs 0.03 USDC. Their handler is unchanged and knows nothing
about payments.

They can also: check the setup with `meter402 doctor`, pay a challenge with
`meter402 test-payment`, inspect payments and receipts, charge for an MCP tool,
and write an agent that meets a 402 and decides for itself whether to pay.

---

## SDK

**`@meter402/sdk`** — one package, adapter exports, no dependencies, no
internal domain type in the public API.

| Framework | Import | Shape |
| --- | --- | --- |
| Express | `@meter402/sdk/express` | `protect(meter, { price })` middleware |
| Fastify | `@meter402/sdk/fastify` | `protect(meter, { price })` preHandler |
| Next.js | `@meter402/sdk/next` | `withMeter402(meter, { price }, handler)` |

Minimal integration, complete:

```ts
import { createMeter402 } from '@meter402/sdk';
import { protect } from '@meter402/sdk/express';

const meter = createMeter402({ apiKey: process.env.METER402_API_KEY! });

app.post('/research', protect(meter, { price: '0.03' }), researchHandler);
```

Three decisions worth stating:

**Fails closed.** An outage that served requests for free would mean anyone who
can degrade us gets the merchant's API for nothing. A merchant may opt into
failing open; they do not inherit it. A wrong API key never fails open at all,
because that would hide the one problem they most need to see.

**Forwards only payment headers.** The merchant's own cookies, authorization
headers and customer identifiers are not our business and do not enter our
logs.

**Prices are checked, never corrected.** `verifyRoute()` at startup compares the
declared price against the registered one and refuses to boot on a mismatch —
in either direction. What agents are charged should not change as a side effect
of a deploy.

**`@meter402/client`** — the paying side. `fetch`, plus: on 402, read the
challenge, check it against a local spending policy, pay, retry once. The
policy is not optional and `maxPerRequest` has no default; networks default to
Base Sepolia only, so an under-configured agent cannot reach real funds. It
holds no key and signs nothing — paying is an injected function.

---

## CLI

| Command | Does |
| --- | --- |
| `meter402 init` | Organization, project, priced endpoint, TEST key, and the code to paste |
| `meter402 doctor` | Checks the setup end to end; a remedy per failure; non-zero exit |
| `meter402 whoami` | What this credential is |
| `meter402 endpoints` | What is registered and what it costs |
| `meter402 payments` / `receipts` | Recent activity |
| `meter402 test-payment <id>` | Pays a challenge; TEST only |

Secrets are structural. Identifiers go in `.meter402.json` (committed); the key
goes in `.env`, and `init` **refuses to write it** unless `.env` is genuinely
git-ignored. No command prints a key — doctor output is exactly what people
paste into issues.

`test-payment` refuses a LIVE credential before contacting the server at all.

---

## MCP

`paidTool()` wraps a tool handler and runs it only when the call was paid for.
It is a shape adapter, not an engine: the call goes through `/v1/authorize`, so
a tool gets the same price snapshot, exactly-once settlement, replay protection
and receipt as an HTTP request. A second payment path for MCP would mean two
implementations of exactly-once and a guarantee they eventually disagree.

MCP has no 402, so an unpaid call returns a structured result carrying the
challenge; the caller pays out of band and calls again with the proof in a
reserved argument, which is stripped before the handler sees it.

Verified live: unpaid call refused, paid through the simulator, second call
served with its payment and receipt.

---

## DASHBOARD

**Not built, deliberately.**

It needs production human authentication, which does not exist — `POST
/v1/dev/sessions` is a development adapter and is not registered in staging or
production. Building a console on a development-only auth adapter produces
something that cannot be deployed and would be rebuilt when real auth arrives.

---

## DEBUGGING — every real defect found

Six. All found by running the system, not by reading it.

### 1. Hyphenated placeholder secrets passed production validation

- **Impact.** A secret left as `replace-me-...` from a template would be
  accepted as genuine in production. Every deployment copying the example file
  with the common hyphen spelling would run on a publicly-known secret.
- **Root cause.** `PLACEHOLDER_MARKERS` held `replace_me` literally, matched by
  substring. `replace-me` did not match.
- **Fix.** Markers matched against the value with punctuation stripped, so
  every spelling of the same word is caught rather than requiring someone to
  have anticipated the separator.
- **Test.** `packages/config/src/production-safety.test.ts` — four placeholder
  spellings, plus missing, empty, short and duplicated secrets. 24 tests.

### 2. `/ready` failed on a dependency the deployment never uses

- **Impact.** A TEST-only deployment could never become ready. The first thing
  a developer met, running locally behind a firewall, was a server saying it
  was not ready and being wrong about it. In production it would hold a
  perfectly healthy task out of the load balancer.
- **Root cause.** The blockchain probe was unconditional. With settlement
  disabled no request path touches an RPC provider — TEST payments are
  simulated end to end.
- **Fix.** Both `/ready` and `/health/payments` probe the chain only when
  settlement is enabled.
- **Test.** Exercised by the live clean-room run; `payments-health` covers the
  reporting shape.

### 3. `endpoints:read` granted nothing

- **Impact.** The scope existed in the API-key vocabulary and no route accepted
  a key for it. A merchant's server could not check at startup that the route
  it was about to protect is registered at the price its own source declares —
  the SDK's `verifyRoute()` could never have worked.
- **Root cause.** `GET /v1/endpoints` required a user session.
- **Fix.** It now accepts a key for its own project and its own environment.
  Read-only; the project comes from the credential, so there is no ID to
  substitute. Creating and repricing stay human work.
- **Tests.** 5 in `defect-audit`, including that one project cannot see
  another's and that a key cannot create or reprice.

### 4. A replayed payment returned 500

- **Impact.** An agent presenting one payment twice — the common case — was
  told the merchant was broken and invited to retry. Exactly the wrong response
  to "you already spent this".
- **Root cause.** The SDK's adapters flattened every non-`unavailable` error to
  500 `PAYMENT_MISCONFIGURED`. `PAYMENT_ALREADY_USED` is a 409 about the caller.
- **Fix.** `rejected` outcomes pass through with the status Meter402 chose.
  Configuration and authentication problems still answer 500 and say nothing
  specific, because the specifics are about the merchant's account.
- **Tests.** 2 in `adapters.test.ts`, including that the merchant's key never
  appears in the body.

### 5. The CLI called list routes that did not exist

- **Impact.** `meter402 payments` and `meter402 receipts` always failed.
- **Root cause.** The repository functions existed; no route exposed them.
- **Fix.** `GET /v1/payments` and `GET /v1/receipts`, over those functions,
  accepting either principal with the same project-from-credential rule.
- **Tests.** 5 in `defect-audit`, including cross-project isolation and limit
  bounds.

### 6. High-severity SQL injection in `drizzle-orm`

- **Impact.** GHSA advisory: SQL injection via improperly escaped identifiers,
  in `< 0.45.2`. Every payment query in the system goes through this library.
- **Root cause.** Pinned at `^0.44.7`.
- **Fix.** Upgraded to `^0.45.2`. All 921 tests pass on the patched version.
- **Test.** `pnpm audit` is the regression test; the finding is gone.

### Also fixed

- The SDK and CLI both read a price field the API does not return
  (`amountMinorUnits` rather than `amount`), so `verifyRoute` could never have
  matched and `meter402 endpoints` crashed.
- The CLI printed `[object Object]` for a payment amount.
- The new authorize route used `schema.parse` directly, letting a raw ZodError
  escape as a 500. No other route had the same mistake.

### Product gap pinned by test, not fixed

`live_mode_enabled` gates LIVE endpoint creation, defaults to false, and **no
route can set it** — so the LIVE path is unreachable by omission rather than by
decision. Consistent with mainnet being disabled. A test now fails if someone
adds the field to the project update schema, so the path gets review rather
than opening silently.

---

## SECURITY

Every property listed in the phase brief was preserved and re-verified. The
audit was written as attacks rather than demonstrations; a passing test means
an attack failed.

| Property | Evidence |
| --- | --- |
| Cross-tenant isolation | 33 isolation + 24 audit tests: ID substitution across payment requests, endpoints, API keys, payments, receipts and endpoint listings |
| RBAC | 58 tests, full role × permission matrix |
| API-key scopes | Scope bypass refused; `endpoints:write` still cannot reprice |
| Principal separation | Machine credential refused on the human-only settlement route with **every** scope; human session refused on the machine-only paid surface |
| Revocation / rotation | Both take effect on the next request; a revoked key cannot redeem a payment it already made |
| TEST/LIVE separation | Environment is part of the endpoint lookup key; a LIVE key finds nothing at a TEST path |
| Exactly-once settlement | 20 simultaneous authorizations through the new surface produce one payment, one receipt, one usage event |
| Replay protection | Two database constraints; a replayed proof is refused with 409 |
| Immutable price snapshot | A merchant raising the price mid-flight does not change what the in-flight payer owes |
| Mainnet lockout | 12 tests across env flags, derived chain list, settlement writes, reported networks, and a scan of tracked deployment files |
| Secret handling | Tracked files scanned; only the public ERC-20 `Transfer` topic matched |

**Unresolved:**

- **No external security review.** Scope prepared; not performed.
- **Webhook SSRF gate: open and untouched.** No webhooks are shipped.
- **Production human authentication does not exist.**
- One moderate advisory, deliberately not fixed: `esbuild <= 0.24.2`, reachable
  only via `drizzle-kit > @esbuild-kit/esm-loader`. The advisory concerns
  esbuild's development server, which nothing here runs, in a dev dependency
  that never reaches a deployed image. Recorded rather than suppressed.

---

## TESTS

Exact counts, from a single run against a database migrated from empty.

| Category | Tests |
| --- | --- |
| **Total** | **921** |
| PostgreSQL-backed integration | 257 |
| SDK | 47 |
| Client (agent + policy) | 36 |
| CLI | 28 |
| MCP | 10 |
| Unit and offline (packages) | 543 |

Within the PostgreSQL-backed set: 24 defect-audit, 33 tenant isolation, 58
RBAC, 28 API-key security, 26 payment security, 12 mainnet lockout, 12 x402
security, 11 x402 flow, 10 reconciliation, 10 authorize, 7 economic integrity,
10 concurrency, 6 payments health, 6 OpenAPI, 1 release-gate E2E.

Concurrency tests specifically: 10, all against real PostgreSQL, including
20-way races on payment completion, payment spending, authorization, and
reconciliation claiming.

0 failed. 0 skipped in this environment except the database-gated suites when
`DATABASE_URL` is unset.

---

## PERFORMANCE

Measured against the built artifact on this machine, warm, 200 sequential
requests per case. Local loopback, so these are lower bounds on real latency —
useful for spotting pathology, not for capacity planning.

| Operation | p50 | p95 |
| --- | --- | --- |
| 402 challenge creation | 9.33 ms | 13.08 ms |
| Credential introspection | 1.85 ms | 3.07 ms |
| Payment list read | 0.79 ms | 3.15 ms |
| `/health` (no dependency) | 0.68 ms | 1.10 ms |
| `/ready` (database ping) | 0.94 ms | 1.33 ms |
| `/health/payments` + backlog | 0.62 ms | 1.05 ms |

| Concurrency | Total | Per request | Succeeded |
| --- | --- | --- | --- |
| 20 concurrent challenges | 172 ms | 8.58 ms | 20/20 |
| 50 concurrent challenges | 246 ms | 4.92 ms | 50/50 |
| 100 concurrent challenges | 410 ms | 4.10 ms | 100/100 |

Challenge creation is the slowest path and should be: it is the only one that
writes, taking a price snapshot inside a transaction. Per-request time *falls*
with concurrency, which is what a healthy pool looks like. No pathological
bottleneck found, and nothing was optimised — there is no traffic to optimise
against.

**Not measured:** sustained load, pool saturation under stress, reconciliation
throughput at scale, or anything on real hardware under real latency.

---

## DEPLOYMENT

**DEPLOYMENT NOT EXECUTED — CREDENTIALS/ENVIRONMENT UNAVAILABLE.**

There is no Docker daemon in this environment and no host or credentials to
deploy to. `deploy/Dockerfile` and `deploy/docker-compose.staging.yml` are
written and **have not been built**. They should be treated as a first draft
until someone runs `docker build`.

What *was* verified locally, against a database migrated from empty:

| Check | Result |
| --- | --- |
| `pnpm build` produces both entry points | **PASS** — `dist/index.js`, `dist/worker.js` |
| API starts and serves | **PASS** |
| `/health` | **PASS** — `{"status":"ok"}` |
| `/ready` | **PASS** — `{"status":"ready","checks":{"acceptingTraffic":true,"database":true}}` |
| `/health/payments` | **PASS** — settlement disabled, backlog empty, no identifiers in the body |
| SIGTERM handling | **PASS** — logs `Shutting down`, exits 0 |
| Migrations from empty | **PASS** |
| TEST payment flow | **PASS** — 402 → pay → 200 → replay 409 |
| SDK flow | **PASS** — example merchant, `verifyRoute` at boot |
| CLI flow | **PASS** — init, doctor, endpoints, test-payment, payments, receipts |
| MCP flow | **PASS** — challenge → pay → served with receipt |
| Agent flow | **PASS** — policy allowed 0.03, refused it at a 0.01 cap without calling the payer |

Graceful shutdown drains readiness *before* closing, with a 20-second deadline
under a typical 30-second SIGKILL timer. The signal handling and clean exit
were verified; the drain window with slow in-flight requests was not separately
exercised.

---

## REAL NETWORK

| | Status |
| --- | --- |
| Base Sepolia E2E | **NOT EXECUTED** |
| Real facilitator | **NOT EXECUTED** |
| Real reconciliation | **NOT EXECUTED** |

Unchanged from Phase 3.5, for the same reason: every RPC endpoint and
facilitator host tested is refused at CONNECT by this environment's network
policy. `ViemSettlementOracle` — the component that actually reads
`authorizationState` from a token contract — has still never been executed.

---

## MAINNET

**DISABLED.**

`ENABLE_BASE_MAINNET=false`, pinned to the literal `'false'` in the staging
compose file rather than left to a variable. Nothing in Phase 4 changed it, and
12 tests fail if it becomes reachable through the environment, the derived
chain list, the settlement write path, the reported networks, or a committed
deployment file.

---

## RELEASE GATES

| Gate | Status |
| --- | --- |
| x402 conformance | **OPEN** |
| Webhook SSRF | **OPEN** (untouched — no webhooks shipped) |
| External security review | **OPEN** |
| Production authentication | **NOT READY** |
| Production secrets | **NOT READY** |

---

## LAUNCH READINESS

**READY FOR DEVELOPER PREVIEW.**

A developer can integrate Meter402, run the complete payment flow, and form a
judgement — with no real money involved, so nothing depends on settlement being
verified. That is the whole scope of the claim.

Not testnet beta: nothing has settled on a real chain. Not mainnet: that needs
an external security review, production authentication, production secrets,
alerting, tested backups, and a controlled mainnet transaction, none of which
exist.

The word "production ready" is not used anywhere in this report, and should not
be used about this system.

---

## TIME TO FIRST PAID REQUEST

**Measured: about 1 second of command execution.** Honestly: **dominated by
reading and typing, not by the tool.**

A clean-room run from an empty database and a directory containing only a
`package.json` and a `.gitignore`, following `docs/QUICKSTART.md` alone:

| Step | Time | Result |
| --- | --- | --- |
| 1. `meter402 init` | 216 ms | organization, project, endpoint, TEST key, config |
| 2. Write the protected route | — | 12 lines, copied from what init printed |
| 3. `meter402 doctor` | 193 ms | exit 0 |
| 4. Start the app, unpaid request | 35 ms | **402** |
| 5. `meter402 test-payment` | 224 ms | proof header |
| 6. Retry with the proof | 27 ms | **200**, handler ran |
| — Replay the same proof | — | **409** |
| 7. `meter402 payments` / `receipts` | — | one payment, one receipt |

**The under-10-minutes target is met on the evidence available, and that
evidence is weaker than the number suggests.** What was measured is a scripted
run by someone who wrote the tool. It is not a person unfamiliar with the
product reading the document for the first time — which is what the target
actually asks about, and which no automated run can establish. The claim that
holds is narrower: *nothing in the flow is slow, and no step requires
undocumented knowledge.*

**One caveat recorded rather than hidden:** `pnpm add @meter402/sdk` could not
be exercised, because the packages are unpublished (`"private": true`).
Dependency resolution in the clean room was linked by hand. A real developer's
install time is therefore not included in the numbers above.

---

## RUN INSTRUCTIONS

```bash
# Install
pnpm install

# Configure
cp .env.example .env    # then fill in every secret it names

# Infrastructure
docker compose up -d                       # Postgres + Redis
pnpm --filter @meter402/database db:migrate

# API
pnpm --filter @meter402/api dev            # or: node apps/api/dist/index.js

# Reconciliation worker (exits if settlement is disabled — by design)
pnpm --filter @meter402/api worker

# Example merchant
export METER402_API_KEY=...  METER402_URL=http://127.0.0.1:4000
pnpm --filter @meter402/example-merchant start

# Test payment
npx meter402 init --api-url http://127.0.0.1:4000
curl -X POST http://127.0.0.1:3000/research          # → 402
npx meter402 test-payment <paymentRequestId>          # → proof header
curl -X POST http://127.0.0.1:3000/research -H 'meter402-payment: <proof>'

# Example agent (pays for itself)
pnpm --filter @meter402/example-agent start

# Example MCP server
pnpm --filter @meter402/example-mcp-server start

# Tests
export DATABASE_URL=postgresql://meter402:meter402@localhost:5432/meter402
pnpm test
pnpm lint && pnpm typecheck && pnpm build
pnpm audit --audit-level moderate
```

---

## COMMITS

| Commit | |
| --- | --- |
| `5d2ff54` | `fix(config)` — hyphenated placeholder secrets, plus the adversarial audit |
| `67b6906` | `feat(sdk)` — authorization API and `@meter402/sdk` with framework adapters |
| `defafa9` | `feat(cli)` — the `meter402` command, and two defects it exposed |
| `c081c21` | `feat(client)` — paying agent with a spending policy, plus examples |
| `4018081` | `feat(mcp)` — paid MCP tools over the same payment domain |
| `e53cda7` | `feat(api)` — payment/receipt listing, quickstart, measured clean-room run |
| _(this)_ | `feat(deploy)` — OpenAPI, worker process, shutdown, runbooks, launch docs |

## PUSH STATUS

See the final section of the response accompanying this report.
