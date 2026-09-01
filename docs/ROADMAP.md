# Meter402 — Roadmap

Phase durations are planning estimates for a three-person team, not
commitments. Each phase lists its exit criteria; a phase is not done because
its time box elapsed.

**Current position: Phase 3 complete on everything this environment can
verify. Two conformance conditions remain blocked by network egress; the x402
release gate stays OPEN. Phase 4 not started.**

---

## Phase 0 — Foundation ✅ complete

Monorepo, toolchain, and the payment-critical domain core.

**Delivered**
- pnpm + Turborepo workspace with a version catalog; strict TypeScript;
  ESLint encoding the no-float-money and no-`any` rules as lint failures
- `@meter402/shared` — BigInt money, ULID identifiers, error taxonomy,
  chain/asset registry, TEST/LIVE separation
- `@meter402/payments` — state machine with a frozen transition table,
  authorization pipeline, `PaymentProtocolAdapter`
- `@meter402/blockchain` — strict ERC-20 decoding, pure verifier,
  primary/secondary failover with circuit breakers
- `@meter402/x402` — protocol adapter with bounded, hostile-input-hardened
  parsing
- `@meter402/pricing` — strategy pattern with `FixedPriceStrategy`
- `@meter402/config`, `@meter402/database` — validated config, schema,
  migrations
- Docker Compose (Postgres, Redis), GitHub Actions CI
- The eight foundation documents

**Exit criteria met:** all packages typecheck, lint, build, and test green in
CI; all 100 payment state transitions asserted; money arithmetic proven exact.

## Phase 1 — Identity, organizations, RBAC, projects, API keys ✅ complete

The multi-tenant security boundary every later phase depends on.

**Delivered**
- `@meter402/auth` — six roles over a closed 24-permission vocabulary in one
  frozen table; `UserPrincipal | ApiKeyPrincipal` discriminated union; API-key
  scopes evaluated separately from human RBAC; owner invariants
- Users, organizations, memberships, projects, API keys with lifecycle status
  enums and database-level constraints
- Branded `TenantScope`: tenant-owned repositories have no unscoped
  `findById`, so a missing ownership check is not an available mistake
- API-key issue / list / rotate / revoke, with the secret returned exactly once
- Full `/v1` route surface for organizations, members, projects, and keys,
  plus `/v1/me` credential introspection
- Audit events for every Phase 1 mutation, transactional with the change

**Exit criteria — all met and verified**
- ✅ RBAC enforced server-side, full role × permission matrix (unit **and** HTTP)
- ✅ **Cross-tenant access denied and explicitly tested** (threat T5) — 33 tests
- ✅ API keys peppered-HMAC hashed, timing-safe, revocable immediately
- ✅ Owner invariants proven under real concurrency
- ✅ 530 tests passing; lint, typecheck, format, build green

**Deliberately not done, and marked PLANNED not built**
- Production identity provider. Human auth is a documented development
  adapter; the route that mints tokens does not exist in staging or production.
- Invitation email delivery. The membership half exists; nothing is sent.
- Dashboard UI (Phase 4+).

## Phase 2 — Billing objects ✅ complete

Endpoint registry, pricing wired end to end, payment request persistence,
state machine wired to the database, test payment simulator, and the HTTP
payment gate.

**Delivered**
- Paid endpoints with `(project, environment, method, path)` uniqueness and an
  immutable price snapshot taken once, at request creation
- `POST /v1/paid/*` — the agent-facing surface: 402 with a machine-readable
  requirement, then authorization on retry
- `TestPaymentProtocolAdapter` driving the **real** `authorizePayment`
  pipeline, not a parallel fake — real expiry, nonce binding, replay claim,
  and state machine
- Payments and receipts created exactly once, guaranteed by
  `UNIQUE (payment_request_id)` and `UNIQUE (payment_id)` rather than by a
  check-then-insert
- Usage events keyed on the payment, so one payment authorizes one request

**Exit criteria — met**
- ✅ A merchant configures a priced endpoint and receives a real 402 challenge
- ✅ A simulated payment moves a request through to `CONFIRMED`
- ✅ The simulator provably cannot act on a LIVE request (four independent
  guards, each tested)

**Verified by** `payment-flow.integration.test.ts` (the 23-step release gate),
`payments-security.integration.test.ts` (26 tests), and
`payments-concurrency.integration.test.ts` (20 simultaneous completions
producing exactly one payment and one receipt).

**Explicitly not delivered in Phase 2**
- LIVE settlement. A LIVE endpoint can be configured and priced, but the paid
  surface refuses it with `LIVE_SETTLEMENT_UNAVAILABLE` rather than issuing a
  402 no agent could satisfy.
- Forwarding an authorized request to merchant infrastructure. That is
  outbound HTTP to a merchant-chosen address, and the SSRF controls it
  requires are an open release gate. The authorized request is served by a
  built-in handler instead.
- x402 wire conformance. The Phase 2 challenge body is deliberately
  protocol-neutral and does not use x402's `accepts` shape.

## Phase 3 — Real payments ⚠️ complete except where the environment blocks it

x402 v2 over EIP-3009 on Base Sepolia, an external facilitator behind an
abstraction, authorization replay protection, and settlement configuration.

**Delivered**
- `X402V2PaymentProtocolAdapter` speaking x402 **v2** — CAIP-2 networks,
  `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, `exact` scheme
- The `authorization` flow (verify -> handler -> settle), read from the
  reference implementation rather than guessed
- `FacilitatorClient` treating the facilitator as untrusted infrastructure
- Local EIP-712 signature verification via viem
- A second replay guard for signed authorizations, distinct from the
  transaction-hash guard and protecting a window the latter cannot
- `SettlementConfiguration` keyed by (project, chain, asset), human-only and
  audited
- Kill switch, per-credential rate limiting, payment metrics, and
  `/health/payments` reported separately from readiness
- Base mainnet disabled behind two independent gates

**Exit criteria**
- ❌ A real Base Sepolia USDC payment is verified end to end — **not executed.**
  No network egress to a testnet RPC or a hosted facilitator in this
  environment. Nothing has settled on a real chain.
- ✅ Replay protection demonstrated against live database constraints, under a
  20-way concurrency test — not only unit tests
- ⚠️ x402 conformance validated against the current specification and an
  independent **client**: done. Against an independent **facilitator**: not
  done. The gate stays OPEN.
- ❌ Confirmation worker / reconciliation — **not built.** An uncertain
  settlement correctly becomes PENDING and nothing resolves it.

**Release gates**
- x402: **OPEN** — two of the required conditions are unmet.
- Webhook SSRF: **OPEN and untouched.**
- Base mainnet: **NOT READY** — see `MAINNET_READINESS.md`.

**Carried into Phase 4 or a Phase 3b**
- Base Sepolia end-to-end settlement in an environment with egress
- The reconciliation worker
- External security review

## Phase 4 — Developer platform (~2 weeks)

`@meter402/sdk` with Express, Fastify, Next.js, and raw HTTP adapters; example
merchant; documentation site; quick start.

**Exit criteria**
- Time to first test payment under 5 minutes, measured on someone who has not
  seen the product
- The four-line integration in the README actually works as written

## Phase 5 — MCP (~2 weeks)

`@meter402/mcp` with `paidTool()`, example MCP server, example agent with
local spending policy.

**Exit criteria**
- A paid MCP tool call completes end to end
- The example agent enforces per-request and daily budget caps locally
- **Threat T16 (MCP prompt injection / malicious tool metadata) has designed
  mitigations**, not just an entry in the threat model

## Phase 6 — Operational platform (~2 weeks)

Webhooks with signing and retry, audit logs, deterministic risk rules, policy
engine, analytics.

**Exit criteria**
- **SSRF controls implemented and tested before any webhook is delivered**
  (threat T8 — this is a hard gate)
- Webhook signature verification helper shipped in the SDK, with timestamp
  tolerance enforced
- Transactional outbox proven to survive a mid-transaction crash
- Risk engine is deterministic; no LLM authorizes a payment

## Phase 7 — Production hardening (~2 weeks)

E2E suite, security testing, observability, Terraform, deployment, runbooks.

**Exit criteria**
- The full §160 acceptance scenario passes end to end in staging
- Value-scaled finality thresholds implemented (currently fixed per chain)
- Second-provider cross-check for high-value payments (threat T4)
- Backup restore tested, not assumed
- Incident runbooks exercised in a game day

## Phase 8 — Design partners and beta

Not an engineering phase. Ten to twenty design partners, customer interviews,
and the honest question of whether merchants want this.

**Exit criteria**
- 5 real merchant integrations
- 3 paying customers
- Repeat agent traffic that we did not prompt
- A documented answer to: is machine-native payment the bottleneck, or is it
  agent billing, budgets, authentication, or procurement?

If the answer is "none of the above", `PRODUCT_REQUIREMENTS.md §11` describes
the adjacent problems worth pivoting toward. Continuing on the original thesis
purely because it was the original thesis is the failure mode this phase
exists to prevent.

---

## Gates that block release regardless of schedule

1. SSRF controls before webhooks ship (T8) — **still open**
2. Cross-tenant isolation tests before multi-merchant beta (T5) — **met in
   Phase 1**, and must be re-verified whenever a new tenant-owned resource is
   added
3. x402 conformance validation before advertising x402 compatibility
4. External security review before meaningful production volume
5. Legal review before production financial operation in any jurisdiction
6. Smart contract audit if a contract ever holds funds — not planned, but the
   gate exists so the decision is never made casually
