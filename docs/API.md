# Meter402 — API

Base URL: `https://api.meter402.com`
Version prefix: `/v1`

Endpoints marked **[built]** are implemented. Endpoints marked **[planned]**
are the specified contract with no implementation yet.

---

## Authentication

```
Authorization: Bearer meter_test_<secret>
```

The key prefix encodes the environment: `meter_test_` keys can only ever
produce testnet activity, `meter_live_` keys mainnet.

| Failure | Code |
| --- | --- |
| No credential | `AUTHENTICATION_REQUIRED` (401) |
| Unknown or malformed key | `INVALID_API_KEY` (401) |
| Revoked | `API_KEY_REVOKED` (401) |
| Expired | `API_KEY_EXPIRED` (401) |
| Valid key, insufficient scope | `PERMISSION_DENIED` (403) |

An unverifiable credential always yields `INVALID_API_KEY`, so probing cannot
distinguish "no such key" from "wrong secret". `API_KEY_REVOKED` and
`API_KEY_EXPIRED` are returned only after the presented secret produced a
matching 256-bit HMAC — that is, only to someone who already holds the key.

**A resource in another organization returns 404, never 403.** 403 would
confirm it exists.

## Error envelope

Every error, without exception:

```json
{
  "error": {
    "code": "PAYMENT_REQUIRED",
    "message": "Payment is required to access this resource.",
    "requestId": "req_01J8ZC4M9K7QW2VYB3N6XR5TDH",
    "documentationUrl": "https://docs.meter402.com/errors/payment_required",
    "details": { "expected": "30000", "observed": "29999" }
  }
}
```

`code` is stable and machine-readable. **Branch on `code`, never on
`message`** — messages are wording and may be reworded; codes are contract.
`requestId` appears on every log line for the request; quote it in support
conversations.

### Codes

| Code | HTTP | Retryable |
| --- | --- | --- |
| `AUTHENTICATION_REQUIRED` | 401 | no |
| `INVALID_CREDENTIALS` | 401 | no |
| `INVALID_API_KEY` | 401 | no |
| `API_KEY_REVOKED` | 401 | no |
| `API_KEY_EXPIRED` | 401 | no |
| `PERMISSION_DENIED` | 403 | no |
| `MEMBERSHIP_INACTIVE` | 403 | no |
| `ENVIRONMENT_MISMATCH` | 403 | no |
| `TEST_LIVE_MISMATCH` | 403 | no |
| `SIMULATOR_LIVE_FORBIDDEN` | 403 | no |
| `PAYMENT_ENDPOINT_MISMATCH` | 403 | no |
| `POLICY_VIOLATION` | 403 | no |
| `RISK_DENIED` | 403 | no |
| `RESOURCE_NOT_FOUND` | 404 | no |
| `ORGANIZATION_NOT_FOUND` | 404 | no |
| `PROJECT_NOT_FOUND` | 404 | no |
| `MEMBERSHIP_NOT_FOUND` | 404 | no |
| `API_KEY_NOT_FOUND` | 404 | no |
| `ENDPOINT_NOT_FOUND` | 404 | no |
| `PAYMENT_REQUEST_NOT_FOUND` | 404 | no |
| `RECEIPT_NOT_FOUND` | 404 | no |
| `LAST_OWNER_REQUIRED` | 409 | no |
| `ENDPOINT_DISABLED` | 409 | no |
| `PAYMENT_ALREADY_CONFIRMED` | 409 | no |
| `INVALID_ROLE` | 422 | no |
| `INVALID_SCOPE` | 422 | no |
| `INVALID_PRICE` | 422 | no |
| `VALIDATION_FAILED` | 422 | no |
| `PAYMENT_REQUIRED` | 402 | yes — pay, then retry |
| `PAYMENT_EXPIRED` | 402 | yes — request a new challenge |
| `PAYMENT_INVALID` | 402 | no |
| `PAYMENT_NOT_CONFIRMED` | 402 | **yes — do not re-pay** |
| `WRONG_NETWORK` / `WRONG_ASSET` / `WRONG_AMOUNT` / `WRONG_RECIPIENT` | 402 | no |
| `PAYMENT_ALREADY_USED` | 409 | no |
| `IDEMPOTENCY_KEY_REUSED` | 409 | no |
| `IDEMPOTENCY_REQUEST_IN_FLIGHT` | 409 | yes |
| `CONFLICT` | 409 | no |
| `INVALID_STATE_TRANSITION` | 409 | no |
| `RATE_LIMITED` | 429 | yes |
| `LIVE_SETTLEMENT_UNAVAILABLE` | 503 | no |
| `UPSTREAM_UNAVAILABLE` | 503 | yes |
| `INTERNAL_ERROR` | 500 | yes |

`PAYMENT_NOT_CONFIRMED` deserves emphasis for agent authors: it means we have
not *yet* observed your payment, not that it failed. Poll; do not pay again.

## Idempotency

Mutating financial endpoints accept `Idempotency-Key`:

```
Idempotency-Key: <client-generated unique string>
```

- Same key + same body → the original response is replayed.
- Same key + **different** body → `IDEMPOTENCY_KEY_REUSED`. This is an error
  rather than a new request because that combination almost always means a
  client bug, and treating it as fresh is how a retry becomes a double charge.
- Key still in flight → `IDEMPOTENCY_REQUEST_IN_FLIGHT`; retry shortly.

Required on `POST /v1/payment-requests`, `POST /v1/refunds`,
`POST /v1/settlements`.

## Pagination

Cursor-based:

```
GET /v1/payments?limit=50&cursor=eyJjcmVhdGVkQXQiOi4uLn0
```

```json
{ "data": [], "nextCursor": "...", "hasMore": true }
```

Offset pagination is not offered on transaction tables: it degrades linearly
and silently skips rows when new ones are inserted during a walk.

## Money on the wire

Amounts are **strings of minor units**, with the asset's decimals alongside:

```json
{ "amount": "30000", "currency": "USDC", "decimals": 6 }
```

Never a JSON number. A JSON number is an IEEE-754 double, and a large
minor-unit amount would lose precision in transit. `30000` with `decimals: 6`
is $0.03.

---

## Endpoints

### Health **[built]**

```
GET /health     liveness — process is up
GET /ready      readiness — database, Redis, and RPC reachable
GET /metrics    internal only, not publicly routed
```

`/health` must not touch dependencies: a liveness probe that fails when the
database is slow causes an orchestrator to restart healthy processes during a
database incident, turning a degradation into an outage.

### Credential introspection **[built]**
```
GET /v1/me
```
Describes the authenticated credential — for a user, their organizations and
roles; for an API key, its project, environment, and scopes. Requires no scope:
a credential is always entitled to describe itself, and gating this would make
it useless for the debugging case it exists for.

### Organizations **[built]**
```
GET   /v1/organizations              only those you actively belong to
POST  /v1/organizations              creator becomes OWNER, same transaction
GET   /v1/organizations/{id}
PATCH /v1/organizations/{id}
```

### Members **[built]**
```
GET    /v1/organizations/{id}/members
POST   /v1/organizations/{id}/members          creates an INVITED membership
PATCH  /v1/organizations/{id}/members/{mid}    role and/or status
DELETE /v1/organizations/{id}/members/{mid}    soft removal (status REMOVED)
```

An invitation grants **no authority** until activated, and no email is sent —
delivery is PLANNED. An organization must always retain at least one ACTIVE
OWNER; a change that would violate that returns `LAST_OWNER_REQUIRED` (409).

### Projects **[built]**
```
POST   /v1/projects                  organizationId in body, validated against membership
GET    /v1/projects?organizationId=  
GET    /v1/projects/{id}
PATCH  /v1/projects/{id}
DELETE /v1/projects/{id}             archives; never deletes
```

`DELETE` sets status `ARCHIVED`. A project owns payments, receipts, and audit
history, so deleting the row would orphan or cascade away financial records.

### Endpoints **[built]**
```
POST   /v1/endpoints                        create a paid endpoint and its price
GET    /v1/endpoints?projectId=&environment=
GET    /v1/endpoints/{id}
PATCH  /v1/endpoints/{id}                   rename, disable, archive, or reprice
```

**User sessions only.** Configuring an endpoint is an act of running a
business; an API key that could reprice the endpoints it pays for would be a
serious design mistake, so these routes reject machine credentials outright.

`POST /v1/endpoints`:

```json
{
  "projectId": "prj_...",
  "name": "Research",
  "path": "/research",
  "method": "POST",
  "environment": "TEST",
  "price": { "amount": "0.03", "asset": "USDC" }
}
```

`price.amount` is a **decimal string**, never a JSON number, and it is refused
rather than truncated if it carries more precision than the asset holds:
`"0.0000001"` against 6-decimal USDC is a `422 INVALID_PRICE`, not a silent
zero. A zero or negative price is also refused — a free endpoint should not be
registered as a paid one.

Uniqueness is over `(project, environment, normalized path, method)`. Paths are
normalised lexically (lowercased, duplicate slashes collapsed, trailing slash
dropped) and are **rejected, never resolved**, if they contain `..` — a
normaliser that resolves segments can disagree with the router in front of it,
and that disagreement is what traversal attacks exploit.

`PATCH` with a `price` creates a **new** pricing rule and repoints the endpoint
at it rather than editing the old rule in place, so the `pricingRuleId` recorded
on a historical payment request still resolves to the rule that produced it.
Outstanding payment requests are unaffected either way — see *Endpoint payment
flow* below.

`DELETE` is deliberately absent: an endpoint owns payment history. `PATCH` with
`{"status": "ARCHIVED"}` is the way to retire one.

### Endpoint payment flow **[built]**
```
POST|GET|PUT|PATCH|DELETE /v1/paid/{merchant path}    the agent-facing surface
```

**API keys only**, and the key must hold `payments:write`. The project and the
environment come from the credential, never from the URL — so a TEST key
resolves the TEST definition of a route or nothing at all, and can never reach
the LIVE row for the same path.

Without a payment header the response is a 402 carrying the requirement (see
*The 402 challenge* below). With a valid proof the request is authorized, the
payment is spent, and the response carries `Meter402-Receipt-Id` and
`Meter402-Payment-Id`.

Two properties this surface guarantees:

- **A payment authorizes the endpoint it was issued for, and no other.**
  Presenting a cheap endpoint's settled payment at an expensive one is a
  `403 PAYMENT_ENDPOINT_MISMATCH`.
- **A payment authorizes exactly one request.** Consumption is a usage event
  keyed on the payment, written in the same transaction that authorizes.
  Replaying a spent proof is a `409 PAYMENT_ALREADY_USED`.

A LIVE endpoint returns `503 LIVE_SETTLEMENT_UNAVAILABLE`. LIVE settlement is
not implemented, and issuing a 402 no agent could satisfy would be worse than
refusing plainly.

*Not implemented:* forwarding the authorized request to merchant
infrastructure. That is outbound HTTP to a merchant-chosen address, and the
SSRF controls it requires are an open release gate (`SECURITY.md`). The
authorized request is served by a built-in handler.

### Payment requests, payments, receipts **[built]**
```
GET  /v1/payment-requests/{id}
GET  /v1/payments/{id}
GET  /v1/receipts/{id}
POST /v1/test/payment-requests/{id}/complete    TEST only
```

Readable by either principal type, authorized differently: a user needs the
`payments:read` permission in the owning organization, a key needs the
`payments:read` scope. Neither substitutes for the other.

Payment requests are created **by the paid surface**, not by a client. There is
deliberately no `POST /v1/payment-requests`: an amount supplied by a caller is
an amount a caller can choose, and the price must come from the merchant's
pricing rule. The price is evaluated exactly once, at creation, and written onto
the request as values — amount, asset, decimals, chain, recipient. Nothing
re-derives it afterwards, which is what makes the snapshot immutable in practice
rather than by promise: repricing the endpoint tomorrow cannot change what an
outstanding request owes.

```json
{
  "id": "preq_...",
  "status": "CHALLENGE_ISSUED",
  "amountMinorUnits": "30000",
  "asset": { "symbol": "USDC", "address": "0x036c...", "decimals": 6 },
  "chainId": 84532,
  "recipient": "0x...",
  "nonce": "01J8ZC...",
  "expiresAt": "2026-01-01T00:05:00.000Z"
}
```

#### The TEST simulator

`POST /v1/test/payment-requests/{id}/complete` settles a TEST payment without a
wallet, testnet USDC, or block times. It returns the payment, the receipt, and
the **reference** the agent must present on its retry — the only place that
value is available to the payer, since it is derived from a server-side secret
and never appears in the 402.

Note what the handler does **not** accept: no environment, no amount, no
`simulate` flag, no override of any kind. Its entire input is a payment request
ID. Every decision is read from the stored request, so there is no parameter a
caller could supply to make it touch LIVE. A LIVE payment request is a
`403 SIMULATOR_LIVE_FORBIDDEN`; a LIVE API key is a `403 ENVIRONMENT_MISMATCH`.

Completing twice is idempotent, not an error: the second call returns the same
payment and receipt with `"created": false`. Twenty simultaneous completions
produce exactly one payment and one receipt, guaranteed by
`UNIQUE (payment_request_id)` and `UNIQUE (payment_id)` rather than by a
check-then-insert.

**A TEST payment is not a parallel fake.** It runs the same
`authorizePayment` pipeline as a real one — the same expiry rules, nonce
binding, replay claim against the same `UNIQUE (chain_id, transaction_hash)`
index, and the same state machine. Only the settlement evidence is synthesised.

### Agents **[planned]**
```
GET   /v1/agents
GET   /v1/agents/{id}
PATCH /v1/agents/{id}
```

### API keys **[built]**
```
POST   /v1/projects/{projectId}/api-keys
GET    /v1/projects/{projectId}/api-keys
POST   /v1/projects/{projectId}/api-keys/{id}/rotate
DELETE /v1/projects/{projectId}/api-keys/{id}
```

Keys are nested under their project because a key belongs to exactly one.

The plaintext secret appears in the create and rotate responses **once** and is
never retrievable again — it is not stored, logged, or written to audit
metadata. Listing returns `maskedKey` (`meter_test_...a4f9`) and never the hash.

**Rotation** mints a replacement inheriting the original's project,
environment, and scopes, and revokes the original in the same transaction. The
old key stops working immediately: a rotation is usually a response to
suspected exposure, so an overlap window would leave the suspect credential
live exactly when it must not be. For zero-downtime, create a second key,
deploy it, then revoke the first.

**Revocation** takes effect on the very next request; key state is read every
time with no cache.

### Development sessions **[local/development only]**
```
POST /v1/dev/sessions
```
Mints a bearer token for an email without proving control of it. **This route
does not exist when `DEPLOY_ENV` is `staging` or `production`.** It is a test
seam pending a real identity provider, not an authentication system.

### Webhooks **[planned]**
```
POST   /v1/webhooks
GET    /v1/webhooks
GET    /v1/webhooks/{id}
PATCH  /v1/webhooks/{id}
DELETE /v1/webhooks/{id}
POST   /v1/webhooks/{id}/test
```

### Analytics **[planned]**
```
GET /v1/analytics/overview
GET /v1/analytics/revenue
GET /v1/analytics/transactions
GET /v1/analytics/endpoints
```

## The 402 challenge

Served by `/v1/paid/*` when a request arrives without a valid payment:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
```

```json
{
  "error": "PAYMENT_REQUIRED",
  "message": "This resource requires payment. Complete the payment and retry.",
  "payment": {
    "paymentRequestId": "preq_...",
    "protocol": "test",
    "scheme": "simulated",
    "amount": "30000",
    "asset": { "symbol": "USDC", "address": "0x036c...", "decimals": 6 },
    "chain": { "id": 84532, "slug": "base-sepolia" },
    "recipient": "0x...",
    "expiresAt": "2026-01-01T00:05:00.000Z",
    "simulated": true
  },
  "instructions": {
    "complete": "POST /v1/test/payment-requests/preq_.../complete",
    "retryWith": "meter402-payment: <base64 of {\"paymentRequestId\",\"reference\"}>"
  }
}
```

`Cache-Control: no-store` is required, not cosmetic: a cached 402 is a
replayable payment instruction that a shared proxy could hand to another agent.

`amount` is a **string** of minor units. A JSON number is an IEEE-754 double,
and an amount that survives a round-trip through one is a coincidence rather
than a guarantee.

The agent retries with `Meter402-Payment: <base64 JSON>` carrying
`{ "paymentRequestId", "reference" }`, and on success receives the merchant
response plus `Meter402-Receipt-Id` and `Meter402-Payment-Id`.

### Two protocols on one surface

Which body a 402 carries depends on the endpoint's `settlementProtocol`:

| `settlementProtocol` | 402 body | Settlement |
| --- | --- | --- |
| `test` (default) | Meter402's protocol-neutral shape, shown above | Simulated; no blockchain |
| `x402` | **x402 v2 `PaymentRequired`** | Real EIP-3009 payment via a facilitator |

The `x402` body follows the current specification exactly and is described
below. The `test` body is deliberately not x402-shaped: a simulated payment is
not an x402 payment, and dressing it as one would make the two
indistinguishable to a client.

## The x402 v2 flow **[built]**

For endpoints with `settlementProtocol: "x402"`.

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
PAYMENT-REQUIRED: <base64 JSON>
```

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.meter402.com/v1/paid/research?preq=preq_01J..."
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "amount": "30000",
      "payTo": "0x...",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
    }
  ]
}
```

Notes that matter to an integrator:

- `network` is **CAIP-2**, not a slug. Base Sepolia is `eip155:84532`.
- `amount` is atomic units as a **string**. 0.03 USDC is `"30000"`.
- `extra.name` and `extra.version` are the **EIP-712 domain of the token
  contract**, which the payer needs to build the digest. They differ per
  deployment: Base Sepolia USDC signs as `"USDC"`, Base mainnet as
  `"USD Coin"`. Do not derive them from the symbol.
- `resource.url` carries the payment request ID. Echo the `resource` object
  back unchanged; it is how the server knows which quote you are paying.

The client retries with `PAYMENT-SIGNATURE: <base64 JSON PaymentPayload>` and,
on success, receives `PAYMENT-RESPONSE: <base64 JSON SettleResponse>` alongside
the merchant response.

### Flow ordering

```
verify  ->  merchant handler  ->  settle
```

This is the `authorization` flow's phase definition
(`verifyBeforeHandler: true`, `settleAfterHandler: true`), not a choice
Meter402 made. The consequence worth relying on: **if the merchant handler
fails, settlement never runs and you are not charged.**

### What is checked, and against what

Every expectation comes from the server's stored `PaymentRequest`. The
`accepted` block you echo back is compared against it and is never read as the
source of any value — an `accepted.payTo` naming a different address fails,
precisely because it is not where we look for the recipient.

| Field | Compared against | Tolerance |
| --- | --- | --- |
| `x402Version` | 2 | exact |
| `scheme` | `exact` | exact |
| `network` | the request's chain | exact; never substituted |
| `asset` | the server's asset registry | exact contract address |
| `amount` and signed `value` | the request's amount | exact; no rounding |
| `payTo` and signed `to` | the request's recipient | exact |
| `validAfter` / `validBefore` | now | must be currently valid |
| request expiry | `expiresAt` | enforced independently of the facilitator |

### Errors specific to this flow

| Code | HTTP | Meaning |
| --- | --- | --- |
| `PAYMENT_INVALID` | 402 | Binding, signature, or replay check failed |
| `PAYMENT_NOT_CONFIRMED` | 402 | Settlement submitted, outcome unknown. **Do not pay again.** |
| `UPSTREAM_UNAVAILABLE` | 503 | Facilitator unreachable. Nothing settled; retry. |
| `IDEMPOTENCY_REQUEST_IN_FLIGHT` | 409 | Another request is settling this authorization. Retry shortly. |
| `LIVE_SETTLEMENT_UNAVAILABLE` | 503 | Real settlement is disabled on this server |
| `SETTLEMENT_NOT_CONFIGURED` | 409 | The merchant has no destination for this network and asset |

### Conformance status

Verified against the official reference implementation (`@x402/core@2.24.0`,
`@x402/evm@2.24.0`): our `PAYMENT-REQUIRED` decodes with the official decoder,
the official client signs against it and is served, and our `PAYMENT-RESPONSE`
decodes with the official decoder.

**Not yet verified:** interoperability with a real facilitator, and settlement
on Base Sepolia. Meter402 therefore does **not** claim "x402 compatible". See
`PAYMENTS.md §9` and `X402_V2_CONFORMANCE_PLAN.md`.

## Settlement destinations **[built]**

```
GET   /v1/organizations/{id}/settlement
PUT   /v1/organizations/{id}/settlement
PATCH /v1/organizations/{id}/settlement/{settlementConfigId}
```

**User sessions only, and there is no API-key scope that grants access.** A
machine credential able to repoint settlement would turn a leaked key into a
standing theft of all future revenue, so the capability does not exist for
machines at all. Writing requires `settlement:write` (OWNER and ADMIN);
reading requires `settlement:read`, which a DEVELOPER also holds.

`PUT` body:

```json
{
  "projectId": "prj_...",
  "chainId": 84532,
  "asset": "USDC",
  "recipientAddress": "0x..."
}
```

Keyed by `(project, chain, asset)`; a null `projectId` sets the
organization-wide default for that chain and asset. Repointing a destination
does **not** affect already-issued payment requests, which carry their
recipient as a snapshot.

## Health **[built]**

```
GET /health           liveness  — touches nothing
GET /ready            rotation  — database; can this task serve at all?
GET /health/payments  capability — can real settlement happen right now?
```

The split is deliberate. A facilitator outage must not fail `/ready`, because
pulling every task from rotation would also take down the dashboard and the
simulated TEST flow — converting a partial degradation into a total outage.
`/health/payments` reports `disabled`, `available`, or `degraded` with a 200 in
all three cases: it answers "what is true", not "should I restart".

## Webhooks

```
Meter402-Signature: <hex HMAC-SHA256 of "{timestamp}.{body}">
Meter402-Timestamp: <unix seconds>
```

Verify with `verifyWebhookSignature()` from the SDK. **Reject timestamps
outside a tolerance window** — without that check a captured signature is
replayable forever.

Event types: `payment.created`, `payment.challenge_issued`,
`payment.submitted`, `payment.confirming`, `payment.confirmed`,
`payment.failed`, `payment.expired`, `payment.refunded`, `receipt.created`,
`endpoint.created`, `endpoint.updated`, `endpoint.deleted`,
`api_key.created`, `api_key.revoked`, `settlement.created`,
`settlement.completed`.

Retry schedule: immediate, 30s, 2m, 10m, 1h, 6h, 24h. Deliveries are recorded
and replayable from the dashboard.

## Versioning

`/v1` is stable. Additive changes (new fields, new event types, new error
codes) ship without a version bump, so **clients must ignore unknown fields**.
Breaking changes ship as `/v2` with an announced deprecation window.

## OpenAPI

`GET /openapi.json` — generated from the same Zod schemas the API validates
with, so the spec cannot drift from the implementation. **[planned]**
