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
| `POLICY_VIOLATION` | 403 | no |
| `RISK_DENIED` | 403 | no |
| `RESOURCE_NOT_FOUND` | 404 | no |
| `ORGANIZATION_NOT_FOUND` | 404 | no |
| `PROJECT_NOT_FOUND` | 404 | no |
| `MEMBERSHIP_NOT_FOUND` | 404 | no |
| `API_KEY_NOT_FOUND` | 404 | no |
| `LAST_OWNER_REQUIRED` | 409 | no |
| `INVALID_ROLE` | 422 | no |
| `INVALID_SCOPE` | 422 | no |
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

### Endpoints **[planned]**
```
POST   /v1/endpoints
GET    /v1/endpoints
GET    /v1/endpoints/{id}
PATCH  /v1/endpoints/{id}
DELETE /v1/endpoints/{id}
```

### Payment requests **[planned]**
```
POST /v1/payment-requests
GET  /v1/payment-requests/{id}
POST /v1/payment-requests/{id}/verify
```

`POST /v1/payment-requests` — requires `Idempotency-Key`:

```json
{
  "projectId": "prj_...",
  "endpointId": "ep_...",
  "amount": "30000",
  "asset": "USDC",
  "chainId": 84532,
  "metadata": {}
}
```

Response includes the challenge:

```json
{
  "id": "preq_...",
  "status": "CHALLENGE_ISSUED",
  "challenge": {
    "protocol": "x402",
    "scheme": "exact",
    "amountMinorUnits": "30000",
    "asset": { "symbol": "USDC", "address": "0x036c...", "decimals": 6 },
    "chain": { "id": 84532, "slug": "base-sepolia" },
    "recipient": "0x...",
    "nonce": "01J8ZC...",
    "expiresAt": "2026-01-01T00:05:00.000Z"
  }
}
```

`POST /v1/payment-requests/{id}/verify` — body `{ "transactionHash": "0x..." }`.
Returns the payment on success, or a 402/409 with a specific code.

### Payments, receipts, agents **[planned]**
```
GET   /v1/payments
GET   /v1/payments/{id}
GET   /v1/receipts/{id}
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

Served by the SDK middleware on the merchant's own endpoint, not by
`api.meter402.com`:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
```

```json
{
  "x402Version": 1,
  "error": "PAYMENT_REQUIRED",
  "accepts": [{
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "30000",
    "payTo": "0x...",
    "asset": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    "resource": "preq_...",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDC", "decimals": 6, "chainId": 84532, "nonce": "..." }
  }]
}
```

`Cache-Control: no-store` is required, not cosmetic: a cached 402 is a
replayable payment instruction that a shared proxy could hand to another agent.

The agent retries with `X-PAYMENT: <base64 JSON>`, and on success receives
`X-PAYMENT-RESPONSE: <base64 JSON>` alongside the merchant's own response body.

**Conformance caveat:** this shape follows public x402 v1 material but has not
been validated against the published specification or an independent client.
See `PAYMENTS.md §9`.

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
