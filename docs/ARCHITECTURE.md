# Meter402 — Architecture

**Status:** Living document. Reflects the codebase as of the close of Phase 1.

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
│   ├── auth/                 Roles, permissions, principals              [built]
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

## 10. Identity, tenancy, and access control (Phase 1)

### 10.1 The entity model **[built]**

```
User  ──< OrganizationMembership >──  Organization ──< Project ──< ApiKey
          (role + status)              (tenant root)
```

- A **User** exists independently of any organization and may belong to many.
  It is the only Phase 1 entity that is not tenant-owned.
- An **Organization** is the tenant boundary. Every merchant-owned row in the
  database carries its `organization_id`.
- A **Membership** is the sole source of organization access. It is never
  derived from an email domain, a header, or anything else a user controls.
  Only `ACTIVE` grants authority; `INVITED`, `SUSPENDED`, and `REMOVED` grant
  nothing.
- A **Project** belongs to exactly one organization. An **ApiKey** belongs to
  exactly one project, and carries its organization for direct scoping.

### 10.2 Two principal types **[built]**

`Principal = UserPrincipal | ApiKeyPrincipal`, a discriminated union.

A human acting through the dashboard and an agent acting through an API key
are different actors with different authority. Collapsing them into one
"current user" object is how a machine credential silently acquires a human's
organization-management rights.

- `UserPrincipal` authority comes from a membership role, evaluated through
  **RBAC**.
- `ApiKeyPrincipal` authority comes from the key's **scopes**, and is confined
  to one project and one environment.

`requireUserPrincipal` / `requireApiKeyPrincipal` narrow at every route, so an
API key cannot reach a human-only endpoint and a session cannot satisfy a
scope check.

### 10.3 RBAC **[built]**

Six roles — OWNER, ADMIN, DEVELOPER, ANALYST, BILLING, VIEWER — map to a closed
set of 24 permissions in one frozen table in `@meter402/auth`. There are no
role string comparisons in route handlers.

Notable boundaries: only OWNER may delete an organization; only OWNER and
BILLING may manage billing; no non-administrative role has authority over
people.

Every authorization decision happens server-side. The permission map is a pure
function, so the future dashboard and admin console evaluate the same table
rather than a second copy that drifts.

### 10.4 Tenant scoping is structural **[built]**

The failure mode Phase 1 exists to prevent is a handler forgetting an ownership
check. Convention does not survive a growing codebase, so the boundary is
enforced by types:

- Tenant-owned repositories expose **no** `findById(id)`. The narrowest lookup
  is `findInOrganization(scope, id)`.
- `TenantScope` is a branded type. It cannot be written as an object literal;
  it comes only from `scopeFromContext` (a verified membership) or
  `scopeFromApiKey`.
- The organization ID therefore never travels from a request body into a query.
  A caller may *name* any organization; what they get scoped to is one they are
  a member of.

There is exactly one deliberate exception, `findProjectOrganizationId`, which
returns an opaque organization ID and no project data so that routes can be
`/v1/projects/:id`. Its narrowness is the security property, and it is
commented as such.

### 10.5 Existence disclosure: 404, not 403 **[built]**

For a resource in another organization the API returns `RESOURCE_NOT_FOUND` /
`ORGANIZATION_NOT_FOUND` / `PROJECT_NOT_FOUND` (404) — never
`PERMISSION_DENIED`.

403 confirms the resource exists, which is exactly what a cross-tenant probe
wants. 403 is reserved for callers who demonstrably have access to the tenant
and merely lack the permission; that discloses nothing they did not know.

A member whose membership is suspended does get 403 (`MEMBERSHIP_INACTIVE`) —
they already know the organization exists.

### 10.6 API key authentication **[built]**

- 256 bits from the CSPRNG, prefixed `meter_test_` / `meter_live_`.
- Stored as HMAC-SHA256 under a server-side pepper. The plaintext is returned
  once at creation and never persisted, logged, or placed in audit metadata.
- Lookup is a direct equality probe on the unique `key_hash` index — O(1) —
  followed by a constant-time comparison as defence in depth.
- Revocation is immediate: key state is read on every request, with no cache.
- Expiry is computed from `expires_at` on every request rather than trusting
  the materialised `EXPIRED` status, so the sweeper's lag is not exploitable.

**Correction to Phase 0.** The Phase 0 docs said lookup was "by `prefix`, then
compare hashes". That does not work — `prefix` is shared by every key of an
environment, so it selects the whole table. The hashing strategy is unchanged
and remains correct; the lookup is now by hash.

### 10.7 Human authentication is a development adapter **[PLANNED as production]**

Phase 1 does **not** integrate a production identity provider, and does not
claim to. There is no password, no MFA, no account recovery, no device
management, and no session revocation list.

What exists is `SessionIssuer`, a provider-neutral interface, with one
implementation — `DevelopmentSessionIssuer` — minting HMAC-SHA256 bearer tokens
from `AUTH_SECRET`. It exists so Phase 1's authorization and tenant isolation
can be exercised end to end over real HTTP.

Two guards keep it out of production, and both are tested:
1. `POST /v1/dev/sessions` is only registered when `DEPLOY_ENV` is `local` or
   `development`. In staging and production the route does not exist.
2. A runtime check refuses even if that call site is changed in a refactor.

Integrating a real provider (Better Auth / Auth0 / Clerk) is Phase 4+ work and
touches only this seam — not routes, repositories, or RBAC.

### 10.8 Invitations **[partial]**

`POST /v1/organizations/:id/members` creates an `INVITED` membership that
grants no authority until activated. **No email is sent** — there is no mail
infrastructure yet. Activation currently happens by an administrator setting
the membership `ACTIVE`. Email delivery and a recipient-driven acceptance flow
are PLANNED.

## 9. Deployment [planned]

AWS: Route 53, ALB, ECS Fargate, RDS PostgreSQL (private subnets, PITR
enabled), ElastiCache Redis, Secrets Manager, S3, CloudWatch. No Kubernetes
until scale justifies its operational cost.

Environments: staging and production, both deployed from the same artifact.
Pipeline: PR → CI → review → merge → staging → smoke tests → production →
health validation, with rollback.
