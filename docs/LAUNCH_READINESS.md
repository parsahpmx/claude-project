# Launch Readiness

**Status: READY FOR DEVELOPER PREVIEW.**

Not testnet beta, not mainnet. The three modes below are sequential and a label
is not a shortcut: nothing here advances because it would be convenient.

---

## The three modes

### Mode 1 — Developer Preview ✅ **available**

A developer can integrate Meter402, run the complete payment flow in TEST, and
form a judgement about the product. No real money is involved, so nothing here
depends on settlement being verified.

| Condition | Status |
| --- | --- |
| TEST simulator stable | **PASS** — 921 tests, exactly-once under 20-way concurrency |
| SDK stable | **PASS** — Express, Fastify, Next; 47 tests |
| Docs complete | **PASS** — quickstart, API, OpenAPI, runbooks |
| Staging deployed | **FAIL** — artifacts written, never built or deployed |
| No real-money dependency | **PASS** — TEST is simulated end to end |

Staging is the one gap, and it is a gap in *our* operations rather than in what
a developer can do: the flow works locally, which is where a developer
evaluates it. Preview is available; the staging item stays FAIL until someone
runs `docker build`.

### Mode 2 — Testnet Beta ❌ **not available**

| Condition | Status |
| --- | --- |
| Base Sepolia E2E verified | **NOT EXECUTED** — no network egress to any RPC |
| Real facilitator verified | **NOT EXECUTED** — no network egress to any facilitator |
| Real reconciliation verified | **NOT EXECUTED** — `ViemSettlementOracle` has never run |
| Monitoring running | **FAIL** — metrics and health exist; nothing is wired to a pager |

Every one of the first three is blocked by the same fact: this environment
refuses outbound connections to every RPC endpoint and facilitator host tested.
That is not a code problem and cannot be fixed by more code.

### Mode 3 — Limited Mainnet Beta ❌ **not available**

| Condition | Status |
| --- | --- |
| Controlled mainnet transaction succeeded | **NOT EXECUTED** |
| External security review | **FAIL** — scope prepared, no review performed |
| Production authentication | **FAIL** — human auth is a development adapter |
| Production secrets | **FAIL** — documented, no secret manager wired |
| Alerting ready | **FAIL** — thresholds specified, nothing wired |
| Backups ready | **FAIL** — procedure written, restore never tested |
| Kill switch tested | **PASS** — `LIVE_SETTLEMENT_ENABLED`, tested |
| Runbooks ready | **PASS** — nine runbooks |
| Reconciliation verified | **PARTIAL** — against a fake oracle only |

---

## Full checklist

### Product

| Item | Status | Note |
| --- | --- | --- |
| SDK usable | **PASS** | One package, three adapters, no internal types leaked |
| CLI usable | **PASS** | init, doctor, whoami, endpoints, payments, receipts, test-payment |
| Quickstart tested | **PASS** | Clean-room run from an empty database, following it alone |
| Examples work | **PASS** | Merchant, agent and MCP server all run against a live server |
| Dashboard usable | **NOT BUILT** | No dashboard exists. Deliberate — see below. |

### Security

| Item | Status | Note |
| --- | --- | --- |
| Tenant isolation | **PASS** | 33 isolation + 24 audit tests; attacks, not demonstrations |
| RBAC | **PASS** | 58 tests over the full role × permission matrix |
| API-key security | **PASS** | 28 tests; revoke and rotate take effect on the next request |
| Payment replay protection | **PASS** | Two database constraints, proven under concurrency |
| Mainnet lockout | **PASS** | 12 tests across five routes into the system |
| Secret scan | **PASS** | Tracked files scanned; only public constants matched |
| Dependency audit | **PASS** | One high-severity SQL injection found and fixed (below) |
| External review | **FAIL** | Scope prepared in `EXTERNAL_SECURITY_REVIEW_SCOPE.md` |

### Payments

| Item | Status | Note |
| --- | --- | --- |
| TEST end-to-end | **PASS** | Release-gate test, plus a live clean-room run |
| x402 conformance | **PARTIAL** | Wire-conformant against the official library; no facilitator |
| Real facilitator | **NOT EXECUTED** | No network egress |
| Base Sepolia | **NOT EXECUTED** | No network egress |
| Reconciliation | **PARTIAL** | Logic proven; the real oracle has never run |
| Controlled mainnet | **NOT EXECUTED** | Mainnet disabled |

### Operations

| Item | Status | Note |
| --- | --- | --- |
| Staging | **FAIL** | Artifacts written, never built — no Docker daemon available |
| Production config | **PASS** | 24 fail-closed tests: missing, empty, malformed, duplicate, placeholder |
| Migrations | **PASS** | Applied from empty; separate deploy step; no automatic destructive migration |
| Backups | **FAIL** | Procedure and targets written; restore never tested |
| Monitoring | **PARTIAL** | Metrics and `/health/payments` exist; nothing scrapes them |
| Alerts | **PARTIAL** | Thresholds in `ALERTING.md`; nothing wired |
| Health | **PASS** | `/health`, `/ready`, `/health/payments`, each answering a different question |
| Kill switch | **PASS** | Not reachable from any merchant credential |
| Runbooks | **PASS** | Nine, each with concrete commands |

### Developer

| Item | Status | Note |
| --- | --- | --- |
| Docs | **PASS** | |
| OpenAPI | **PASS** | Generated from the live routing table; a test fails on drift |
| Examples | **PASS** | |
| Troubleshooting | **PASS** | In the quickstart, keyed by symptom |
| Support contact | **FAIL** | No process exists |

---

## What Phase 4 found and fixed

Six real defects, all found by running the system rather than reading it:

1. **Placeholder secrets with hyphens passed production validation.** The
   detector held `replace_me` literally, so `replace-me-...` — the far more
   common template spelling — was accepted as a real secret.
2. **`/ready` failed on a blockchain probe with settlement disabled.** A
   TEST-only deployment could never become ready, because a dependency it never
   calls was unreachable.
3. **`endpoints:read` granted nothing.** The scope existed in the vocabulary
   and no route accepted an API key, so a merchant's server could not verify at
   startup that its route was registered at the price its own source declares.
4. **A replayed payment returned 500.** `PAYMENT_ALREADY_USED` is a 409 about
   the caller; answering 500 told the agent the merchant was broken and invited
   a retry.
5. **The CLI called payment and receipt list routes that did not exist.**
6. **A high-severity SQL injection in `drizzle-orm` (< 0.45.2).** Found by the
   dependency audit, in the library every payment query goes through. Upgraded;
   921 tests pass on the patched version.

One moderate advisory remains and is not being fixed: `esbuild <= 0.24.2`,
reachable only as `drizzle-kit > @esbuild-kit/esm-loader > esbuild`. The
advisory is about esbuild's **development server**, which nothing here runs, in
a **dev dependency** that never reaches a deployed image. Recorded rather than
suppressed.

---

## The three things that decide everything else

**Nothing has settled on a real chain.** Not once. The settlement path is
exercised against a test double, which proves Meter402 drives the flow
correctly and reacts correctly to every answer a facilitator can give — and
proves nothing about a real facilitator or a real chain.

**No external security review.** The self-review in `SECURITY.md §14` is worth
something and is not a substitute. `EXTERNAL_SECURITY_REVIEW_SCOPE.md` is
written and ready to hand to a reviewer.

**Human authentication is a development adapter.** `POST /v1/dev/sessions`
mints tokens and is not registered in staging or production — which means
today there is *no* way for a human to authenticate in production. That is
safe, and it also means the dashboard cannot exist yet, which is why none was
built. A production identity provider is a launch blocker for anything past
Developer Preview.

---

## Deliberately not built

**A dashboard.** It needs production human authentication, which does not
exist. Building a console on top of a development-only auth adapter would
produce something that cannot be deployed and would have to be rebuilt when
real auth arrives.

**Webhooks.** The SSRF release gate is open and untouched. Delivering merchant-
controlled outbound HTTP without DNS-rebinding-resistant resolution,
private-range blocking, and redirect confinement is the specific thing the gate
exists to prevent.

**Out-of-process x402 settlement.** The authorization API supports TEST
completely and refuses x402 with a specific error. Settling across a process
boundary needs durable continuation state, and every safe way to hold it either
puts a spendable signature at rest or needs a locking protocol that cannot be
validated without a real facilitator.

---

## Release gates

| Gate | Status |
| --- | --- |
| x402 conformance | **OPEN** — facilitator and testnet conditions unmet |
| Webhook SSRF | **OPEN and untouched** |
| External security review | **OPEN** |
| Production authentication | **NOT READY** |
| Production secrets | **NOT READY** |
| Base mainnet | **DISABLED** — see `MAINNET_READINESS.md` |

## What to do next, in order

1. An environment with network egress, a funded Base Sepolia wallet, and a
   facilitator account. Run the end-to-end scenario and the real
   `ViemSettlementOracle`. Expect it to find something.
2. Build and deploy staging. Smoke-test it externally.
3. A production identity provider.
4. Commission the external security review.
5. Wire alerting, and test a backup restore.

Only then is Mode 2 a question worth asking.
