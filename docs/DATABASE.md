# Meter402 — Database

PostgreSQL 16, accessed through Drizzle ORM. Schema lives in
`packages/database/src/schema/`; migrations are generated with `drizzle-kit`
and committed.

---

## 1. Conventions

### Primary keys are prefixed ULIDs stored as `text`

`pay_01J8ZC4M9K7QW2VYB3N6XR5TDH`, not `12345`.

Sequential integers leak business volume — a competitor reads your growth rate
off two invoice numbers — and make enumeration trivial. ULIDs are
lexicographically sortable by creation time, which keeps B-tree inserts
append-mostly on the payments tables (our highest-write tables) instead of
scattering them across the index the way UUIDv4 would.

The type prefix makes IDs self-describing in logs and lets the API reject an
endpoint ID passed where a payment ID was expected before it becomes an empty
result set.

### Money is `NUMERIC(78, 0)`

Amounts are integer counts of minor units. `NUMERIC(78,0)` holds a full
uint256, so no on-chain amount can overflow the column. It is never `FLOAT`,
`REAL`, or `DOUBLE PRECISION`, and never `MONEY` (which carries a
locale-dependent fractional precision).

Drizzle returns `numeric` as a string; the repository layer converts to
`bigint`. It never passes through `Number`.

Every amount column is accompanied by `asset_symbol`, `asset_decimals`,
`asset_address`, and `chain_id`. Storing the decimals alongside the amount
means a historical payment still renders correctly if an asset's registry
entry ever changes.

### Tenancy

Every tenant-owned table carries `organization_id` with a foreign key. There
is no query in the application that fetches a tenant-owned row by ID alone;
access goes through organization-bound repositories.

### Timestamps

`timestamptz` everywhere, UTC. `created_at` and `updated_at` on essentially
everything. `deleted_at` for soft deletion where an audit trail or foreign-key
integrity requires the row to survive — projects, endpoints, webhook
endpoints. Payments and audit events are **never** soft-deleted; they are
financial and security records.

### Enums

Postgres native enums, not `text`. Rule 134 of the brief: constraints belong
in the database, not only in application checks. An invalid payment status
should be impossible to write, not merely unlikely.

## 2. Core tables

### Identity and tenancy

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | People | `email` citext-unique, `email_verified_at` |
| `organizations` | Tenant root | `slug` unique, `plan` |
| `organization_members` | Membership + role | Unique `(organization_id, user_id)` |
| `projects` | Container for endpoints/keys | Soft-deletable |

Roles: `OWNER`, `ADMIN`, `DEVELOPER`, `ANALYST`, `BILLING`, `VIEWER`.
Permissions are defined centrally in application code and evaluated
server-side only.

### `api_keys`

Columns: `id`, `organization_id`, `project_id`, `name`, `prefix`, `key_hash`,
`last_four`, `environment`, `scopes[]`, `created_at`, `expires_at`,
`last_used_at`, `revoked_at`.

**Plaintext keys are never stored.** The secret is shown once at creation.

**Hashing choice:** HMAC-SHA256 with a server-side pepper, not bcrypt or
Argon2. This is deliberate and the reasoning matters, because the usual advice
points the other way. Bcrypt and Argon2 exist to make brute force expensive
against *low-entropy human-chosen passwords*. An API key here is 256 bits from
a CSPRNG — brute force is already infeasible, so a slow KDF buys nothing. It
would cost a lot: keys are verified on every single API request, and a
deliberately slow hash on the hot path is a self-inflicted denial of service.
The pepper (held in the secret store, not the database) means a database dump
alone does not permit offline verification of guessed keys.

Lookup is by `prefix`, then a **timing-safe** comparison of the HMAC.

### `endpoints` and `pricing_rules`

An endpoint has a path, method, environment, and a pricing rule. Pricing rules
carry `kind` (`FIXED` today), `amount` as a decimal string, `asset_symbol`, and
`chain_id`.

### `payment_requests`

The merchant's statement of what must be paid. Amount, asset, chain,
recipient, `nonce`, `reference`, `status`, `expires_at`.

Indexed on `(organization_id, created_at DESC)`, `(project_id, status)`, and
`status` filtered to non-terminal rows for the expiry sweeper.

### `payments`

Created when a request confirms. Carries the ledger view:
`gross_amount_minor_units`, `platform_fee_minor_units`,
`network_fee_minor_units`, `net_amount_minor_units`, plus settlement status.

Fee columns exist from the start even though MVP fees are zero — adding money
columns to a populated payments table later is a migration nobody enjoys, and
rule 102 requires fee calculations to be visible rather than derived at
display time.

### `blockchain_transactions` — replay protection

```sql
UNIQUE (chain_id, transaction_hash)
```

**This constraint is the replay protection** (ADR-0005). It is not a
performance index and must never be dropped or made non-unique. The
`ReplayGuard.claim()` operation is an `INSERT` against it; a concurrent second
claim of the same transaction fails at the database rather than in a racing
application check.

### `payment_attempts`

Every verification attempt, successful or not, with its failure reason. Feeds
the risk engine (repeated failed proofs are a signal) and support.

### `payment_receipts`

One per confirmed payment. Immutable once written.

### `usage_events`

`unit` is `REQUEST` for MVP; `TOKEN`, `BYTE`, `SECOND`, `COMPUTE_UNIT`,
`GPU_SECOND`, `CUSTOM` reserved.

### `agents` and `customers`

An agent is a counterparty we have seen, identified by external ID and/or
wallet reference. Status `ACTIVE`, `BLOCKED`, `REVIEW`.

We do **not** claim to verify legal identity, and no column should imply
otherwise.

### Webhooks

`webhook_endpoints` (URL, secret, subscribed event types, active) and
`webhook_deliveries` (event type, payload, status, attempt count, response
code, response body **snippet**, `next_attempt_at`).

Only a bounded snippet of the response body is stored: a merchant endpoint can
return anything, including its own secrets, and we should not become a
long-term store of it.

### `outbox_events`

The transactional outbox. Written in the same transaction as the state change
it describes; drained by a delivery worker. This is what makes "committed
payment, lost webhook" structurally impossible.

### `idempotency_keys`

`key`, `organization_id`, `request_hash`, `response_body`, `status`,
`created_at`, `expires_at`. Unique on `(organization_id, key)`.

Same key + same payload replays the stored response. Same key + **different**
payload is an error, not a new request — that combination almost always means
a client bug, and silently treating it as a fresh request is how a retry
becomes a double charge.

### `audit_events`

Append-only: actor, organization, action, resource type and ID, timestamp, IP,
user agent, metadata. No `UPDATE` or `DELETE` grant for the application role.

### Supporting tables

`risk_evaluations`, `policy_rules`, `settlements`, `wallet_references`,
`subscriptions`, `invoices`, `feature_flags`.

## 3. Indexing

Composite indexes follow real query shapes rather than being added per column:

- `payment_requests (organization_id, created_at DESC)` — dashboard listing
- `payment_requests (project_id, status)` — per-project filters
- `payments (organization_id, created_at DESC)` — transactions table
- `payments (endpoint_id, created_at DESC)` — per-endpoint analytics
- `blockchain_transactions (chain_id, transaction_hash)` — unique, replay
- `usage_events (project_id, occurred_at DESC)` — metering rollups
- `webhook_deliveries (status, next_attempt_at)` — retry sweeper
- `api_keys (prefix)` — auth hot path
- `audit_events (organization_id, created_at DESC)`

Cursor pagination on `(created_at, id)` throughout. Offset pagination is not
used on transaction tables — it degrades linearly and skips rows under
concurrent insert.

## 4. Migrations

Generated with `drizzle-kit generate`, reviewed, and committed. Every schema
change ships as a migration file; there are no manual production schema edits.

Migrations must be **backwards compatible with the currently deployed code**,
because deploys are rolling and old and new run concurrently. Column removal
is a two-step: stop writing, deploy, then drop in a later release.

## 5. Production posture

Managed PostgreSQL with automated backups, encryption at rest and in transit,
point-in-time recovery, and monitoring. Private subnets only; never publicly
reachable. Restore procedures are tested, not assumed — see
`DISASTER_RECOVERY.md` (planned).
