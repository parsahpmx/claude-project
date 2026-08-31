# Meter402 — Architecture

**Status:** Living document. Reflects the codebase as of the close of Phase 0.

Sections marked **[built]** exist and are tested. Sections marked
**[planned]** are design intent with no code yet. That distinction is
maintained honestly; a document that describes aspiration as fact is worse
than no document.

---

## 1. System overview

```
   AI Agent
      │  1. GET /research
      ▼
   Merchant API  ──────────────┐
      │  (Meter402 SDK middleware)
      ▼                        │
   Meter402 Middleware         │  Meter402 is in the AUTHORIZATION path,
      │  2. 402 + challenge    │  never the DATA path. Merchant request and
      ▼                        │  response bodies do not pass through us.
   Agent Wallet                │
      │  3. USDC transfer      │
      ▼                        │
   Base (blockchain)           │
      │                        │
      ▼                        │
   Meter402 Verification       │
      │  4. independent read   │
      ▼                        │
   Authorization ──────────────┘
      │  5. allow
      ▼
   Merchant handler runs, response returned to agent
      │
      ├─► Receipt
      ├─► Usage event
      ├─► Webhook
      └─► Analytics
```

The boxed note is the most important architectural property in the system.
See ADR-0002.

## 2. Repository layout

Target structure. **[built]** marks what exists today.

```
meter402/
├── apps/
│   ├── api/                  Fastify modular monolith (control plane)   [built]
│   ├── dashboard/            Next.js merchant dashboard                 [planned]
│   ├── docs/                 Developer documentation site               [planned]
│   ├── admin/                Internal admin console                     [planned]
│   ├── example-merchant/     Reference paid API                         [planned]
│   ├── example-agent/        Reference paying agent                     [planned]
│   └── example-mcp-server/   Reference paid MCP server                  [planned]
├── packages/
│   ├── shared/               Money, IDs, errors, assets, events         [built]
│   ├── payments/             State machine, authorization, adapter API  [built]
│   ├── blockchain/           Providers, failover, ERC-20 verification   [built]
│   ├── x402/                 x402 protocol adapter                      [built]
│   ├── pricing/              Pricing strategies                         [built]
│   ├── database/             Drizzle schema, migrations, seed           [built]
│   ├── config/               Validated environment loading              [built]
│   ├── receipts/             Receipt generation                         [planned]
│   ├── metering/             Usage events                               [planned]
│   ├── webhooks/             Signing, delivery, retry                   [planned]
│   ├── risk/                 Deterministic risk rules                   [planned]
│   ├── policy/               Merchant policy evaluation                 [planned]
│   ├── analytics/            Aggregation                                [planned]
│   ├── auth/                 Session and identity integration           [planned]
│   ├── sdk/                  @meter402/sdk merchant SDK                 [planned]
│   ├── mcp/                  @meter402/mcp paidTool()                   [planned]
│   ├── cli/                  @meter402/cli                              [planned]
│   └── ui/                   Shared dashboard components                [planned]
├── infrastructure/
│   ├── docker/                                                          [planned]
│   └── terraform/                                                       [planned]
├── docs/                     This directory                             [built]
└── scripts/                                                             [planned]
```

### Dependency direction

```
shared  ◄── pricing
   ▲    ◄── payments ◄── blockchain
   │                 ◄── x402
   └────── config, database
```

`shared` imports nothing from the workspace, so the graph is acyclic by
construction. `payments` defines interfaces (`SettlementVerifier`,
`ReplayGuard`) that `blockchain` and the API implement — dependency inversion,
which is what makes the authorization pipeline testable without I/O.

## 3. Backend: modular monolith

One deployable Fastify service, internally divided into modules with explicit
boundaries: `auth`, `organizations`, `projects`, `apiKeys`, `endpoints`,
`payments`, `blockchain`, `webhooks`, `analytics`, `risk`, `audit`, `billing`.

We are not building microservices. At our scale they would buy distributed
tracing, eventual consistency, and deployment coordination in exchange for
nothing we currently need. The module boundaries are drawn where the service
seams would go, so the first extraction is a build-file change rather than a
rewrite. When scale demands it, the first candidates are, in order: payment
verification workers, webhook delivery, analytics aggregation, risk.

## 4. Architecture decision records

### ADR-0001 — Money is BigInt minor units, never a float
**Status:** accepted · **Enforced by:** `packages/shared/src/money.ts`, ESLint

IEEE-754 doubles cannot represent most decimal fractions; `0.1 + 0.2` is
`0.30000000000000004`. In a ledger that is unreconcilable money, and the error
compounds silently. Every amount is an integer count of an asset's smallest
unit held as `bigint`, carrying its own decimals and currency. Cross-currency
arithmetic throws rather than coercing. Parsing rejects inputs with more
precision than the asset supports rather than truncating them.

**Cost:** amounts must be strings on the wire (a JSON number is a double), and
every consumer must handle that. Accepted.

### ADR-0002 — Meter402 sits in the authorization path, not the data path
**Status:** accepted

The middleware decides whether a request may proceed. The merchant's handler
produces the response, and that response never transits our infrastructure.

This is simultaneously a privacy property (we cannot see customer prompts,
datasets, or model outputs), a security property (a Meter402 compromise does
not expose merchant content), a performance property (no proxy hop on the
response), and a commercial one (merchants integrate a payment check far more
readily than a proxy in front of their product).

### ADR-0003 — Never take custody of funds
**Status:** accepted

Payments move directly from the agent's wallet to the merchant's settlement
address. We verify that it happened; we never hold, forward, or sweep funds,
and hold no private keys that can move merchant money.

This removes the highest-severity branch of the threat model outright — there
is no hot wallet to drain — and avoids the money-transmission posture that
custody would trigger. The cost is that we cannot offer automatic
currency conversion or split settlement without revisiting it. Accepted for
MVP and beyond unless a customer need justifies the change, which would
require legal review first.

### ADR-0004 — Payment protocols live behind an adapter
**Status:** accepted · **Enforced by:** `PaymentProtocolAdapter`

x402 has traction today; MPP and AP2 are plausible tomorrow. All wire-format
knowledge is confined to `@meter402/x402`. Application code depends on the
interface.

**How to tell if this boundary is eroding:** grep the API app for `x402`. It
should appear only where an adapter is selected, never where a payment is
processed.

### ADR-0005 — Replay protection is a database constraint, not application logic
**Status:** accepted

A `SELECT`-then-`INSERT` check races, and the race window is precisely what a
double-spend attempt targets. A `UNIQUE (chain_id, transaction_hash)`
constraint makes the second concurrent claim fail at the database. The
`ReplayGuard` interface models that atomic claim so the authorization pipeline
can be tested against it without a database.

### ADR-0006 — Infrastructure failures resolve to PENDING, never FAILED
**Status:** accepted

If our RPC providers are unreachable, we do not know whether a payment
happened. Recording FAILED asserts something we did not observe, and tells an
agent that already paid that it did not — inviting a double payment. Unknown
resolves to PENDING and retries. Only a definitive observation (reverted, wrong
recipient, wrong amount) produces FAILED.

### ADR-0007 — TypeScript pinned to 5.9.x, not 7.x
**Status:** accepted · **Revisit:** when typescript-eslint supports 7.x

TypeScript 7.x (the native port) is the current `latest`. `typescript-eslint@8`
declares a peer range of `>=4.8.4 <6.1.0`, so adopting 7.x would silently
disable type-aware linting across the repo — losing a real correctness control
in exchange for compile speed we do not need at this size.

### ADR-0008 — Strict TypeScript including `noUncheckedIndexedAccess`
**Status:** accepted

Array and record access returns `T | undefined`. It is friction on every
lookup, and it is worth it: in payment code an unchecked index is exactly the
class of bug that produces a wrong amount rather than a crash. Rule 158 of the
product brief forbids weakening these settings to silence errors.

`exactOptionalPropertyTypes` was evaluated and deferred — it interacts badly
with third-party types for limited additional safety. Tracked as hardening
work.

## 5. Payment flow (built)

1. A request arrives at a merchant endpoint wrapped by the SDK.
2. The pricing engine quotes a price. `assertChainAllowedForEnvironment` runs
   here, so a TEST project can never be quoted a mainnet price.
3. A `PaymentRequest` is created: amount, asset, chain, recipient, nonce,
   deadline. Status `CREATED`.
4. The protocol adapter renders a challenge. Status `CHALLENGE_ISSUED`. The
   402 is served `no-store` — a cached challenge is a replayable payment
   instruction.
5. The agent transfers USDC on Base and retries with a proof.
6. The adapter parses the proof. Parsing is bounded before allocation and
   strips prototype-polluting keys.
7. `authorizePayment` runs the pipeline: local checks → on-chain verification →
   replay claim. Ordering is deliberate and documented in the source.
8. On success, status `CONFIRMED`; the merchant handler runs. On a
   below-finality result, `CONFIRMING`. On an RPC outage, `PENDING`.

## 6. Data layer

PostgreSQL via Drizzle ORM. Redis for rate limiting, caching, and BullMQ job
queues. See `docs/DATABASE.md` for the schema and the reasoning behind column
type choices.

Every tenant-owned table carries `organization_id`, and access goes through
organization-bound repositories. Rule R7 of the PRD.

## 7. Events and the outbox

Domain events are written to a transactional outbox in the same transaction as
the state change that produced them, and delivered by a separate worker. A
committed payment can therefore never lose its webhook, which a
publish-after-commit design cannot guarantee. Every event carries an explicit
`schemaVersion`; consumers are merchant code we cannot redeploy.

## 8. Observability

Every request carries a request ID and trace ID, present on every log line and
returned in every error envelope so a support conversation starts from one
identifier. Logs are structured JSON with a redaction list — API keys,
authorization headers, and payment proofs never reach a log sink.

Targets: API p95 under 300 ms excluding blockchain finality. Payment
verification minimises RPC calls; authorization results are never cached
(caching an authorization decision is caching an entitlement).

## 9. Deployment [planned]

AWS: Route 53, ALB, ECS Fargate, RDS PostgreSQL (private subnets, PITR
enabled), ElastiCache Redis, Secrets Manager, S3, CloudWatch. No Kubernetes
until scale justifies its operational cost.

Environments: staging and production, both deployed from the same artifact.
Pipeline: PR → CI → review → merge → staging → smoke tests → production →
health validation, with rollback.
