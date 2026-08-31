# Phase 2 — Implementation Note

Written before code, after inspecting the Phases 0–1 repository. It records how
Phase 2 extends the existing architecture and — more importantly — what it
deliberately does **not** rebuild.

---

## 1. The central design decision

**TEST payments exercise the real payment domain. There is no parallel fake.**

The tempting shortcut is a simulator that writes `status = CONFIRMED` directly
and skips verification. That would make the TEST path prove nothing: every
invariant Phase 3 depends on — expiry, amount matching, replay protection,
state-machine legality, exactly-once payment creation — would be untested until
real money was already moving.

Instead, `TestPaymentProtocolAdapter` implements the existing
`PaymentProtocolAdapter` and drives the existing `authorizePayment` pipeline
with a `SimulatedSettlementVerifier`. That means a TEST payment goes through:

- the real expiry check
- the real amount / recipient / asset / chain comparisons
- the real `ReplayGuard`, backed by the real `UNIQUE (chain_id,
  transaction_hash)` database constraint
- the real payment state machine and its transition table

The only substitution is *where the settlement evidence comes from*: a
deterministic synthetic reference instead of an RPC read. Phase 3 swaps that
one collaborator for `Erc20SettlementVerifier` and the rest is already proven.

## 2. What Phase 0/1 already provides, reused as-is

| Capability | Where | Reuse |
| --- | --- | --- |
| `UNIQUE (payment_request_id)` on `payments` | Phase 0 schema | **This is the exactly-once payment rule.** Already present; Phase 2 relies on it rather than adding a check. |
| `UNIQUE (payment_id)` on `payment_receipts` | Phase 0 schema | **This is the exactly-once receipt rule.** Same. |
| `UNIQUE (chain_id, transaction_hash)` | Phase 0 schema | Replay protection, now also covering simulated settlements. |
| Payment state machine + frozen transition table | `@meter402/payments` | Phase 2 transitions go through `assertTransition`; none are bypassed. |
| `authorizePayment` pipeline | `@meter402/payments` | Reused verbatim. |
| `PaymentProtocolAdapter`, `PaymentChallenge`, `PaymentProof` | `@meter402/payments` | The internal, protocol-neutral model already exists. Phase 2 adds an implementation, not a new interface. |
| `Money` (BigInt minor units) | `@meter402/shared` | All Phase 2 amounts. |
| `PricingStrategy` / `FixedPriceStrategy` / `PriceQuote` | `@meter402/pricing` | Already exactly what Phase 2 needs. |
| `assertChainAllowedForEnvironment` | `@meter402/shared` | TEST/LIVE separation, unchanged. |
| `TenantScope` (branded) | `apps/api/src/lib/tenant.ts` | Every new repository takes one. |
| API-key scopes + `requireScope` | `@meter402/auth` | Phase 2 is where these finally guard real business endpoints. |
| Audit events, transactional | `apps/api/src/modules/audit` | Extended with Phase 2 actions. |
| `isUniqueViolation` (walks the cause chain) | Phase 1 | Reused for the exactly-once races. |

**No new permission strings.** The Phase 1 vocabulary was deliberately closed;
`endpoints:read` / `endpoints:write` cover endpoints *and their pricing*
(pricing is endpoint configuration, not a separate resource), and
`payments:read` covers payment requests, payments, and receipts. Adding
`pricing:*` would have been vocabulary sprawl for no security gain.

**No new API-key scopes.** `payments:write`, `payments:read`,
`endpoints:read`, `endpoints:write` already exist and are exactly what Phase 2
needs to enforce.

## 3. Schema deltas

Additive only; nothing existing is repurposed.

- `endpoints`: `status` enum (ACTIVE/DISABLED/ARCHIVED) replacing the boolean
  `active`; `method` as a closed enum; `normalized_path` carrying the value the
  uniqueness invariant is computed over.
- `pricing_rules`: `environment` and `asset_decimals`, so a rule is fully
  self-describing and a TEST rule cannot be read as a LIVE one.
- `payment_requests`: `pricing_rule_id` for snapshot lineage — *provenance
  only*. The amount is already denormalised onto the request and is never
  recomputed from the rule.
- `payments`: `protocol`, `payer_reference`, `simulated`,
  `external_transaction_reference`.
- `payment_receipts`: denormalised snapshot fields, so a receipt renders
  correctly forever without joining tables that may later change.
- `blockchain_transactions`: `simulated` flag, so one replay mechanism serves
  both TEST and LIVE while staying honest about what a row is.

## 4. Immutable price snapshot

A `PaymentRequest` stores `amount_minor_units`, `asset_symbol`,
`asset_decimals`, `chain_id`, and `recipient_address` **as values**, captured
at issue time. Verification and authorization read only those columns.

`pricing_rule_id` is recorded for provenance and is never dereferenced during
authorization. Changing an endpoint's price therefore cannot alter an
outstanding request — not by convention, but because the code path that would
need to re-read the rule does not exist.

## 5. Expiry

Computed from `expires_at` against the current time on every authorization,
exactly as Phase 1 does for API keys. A request whose stored status still says
`CHALLENGE_ISSUED` but whose deadline has passed is expired. No sweeper is
trusted to have run.

## 6. Simulator confinement

Four independent guards, each tested:

1. `assertSimulatableRequest` rejects any `PaymentRequest` whose stored
   environment is not `TEST`. It lives in `@meter402/payments` beside the
   adapter, so there is one implementation of the rule rather than a copy per
   handler that can drift.
2. `assertChainAllowedForEnvironment` means a TEST endpoint can only ever carry
   a testnet chain, so a LIVE request cannot be constructed through this path.
3. The simulator takes no caller-supplied environment, mode, or override flag.
   Its entire input is a payment request ID — there is no parameter that could
   relax a check.
4. `SimulatedSettlementVerifier` refuses any reference other than the one the
   simulator would have issued for that specific request: a keyed HMAC over
   `(paymentRequestId, nonce)`, compared in constant time. This is the
   non-trivial guard — it is what makes "the agent must actually have completed
   the payment" enforceable rather than assumed.

A fifth check sits in front for machine callers: `requireEnvironment` refuses a
LIVE API key at the simulator regardless of the request it names.

## 7. HTTP transport stays separate from the domain

The demo paid resource speaks a Phase-2 neutral header
(`Meter402-Payment`) carrying a reference to a server-side `PaymentRequest`.
No x402 v1 header names are baked in anywhere outside `@meter402/x402`.

Phase 3 maps the x402 wire format onto the same internal `PaymentChallenge` /
`PaymentProof` model. **x402 wire conformance remains unverified and
unadvertised** — that release gate is untouched by this phase, as is the SSRF
gate for webhooks.


## 8. Quick start

Two roles, four steps. Assumes a running API and database.

### As a merchant

```bash
# 1. Publish a paid endpoint. 0.03 USDC per call, TEST mode.
curl -X POST localhost:4000/v1/endpoints \
  -H "authorization: Bearer $SESSION" \
  -H 'content-type: application/json' \
  -d '{
        "projectId": "prj_...",
        "name": "Research",
        "path": "/research",
        "method": "POST",
        "environment": "TEST",
        "price": { "amount": "0.03", "asset": "USDC" }
      }'
```

The price is a decimal **string**. `"0.0000001"` against 6-decimal USDC is a
`422`, not a silent zero.

### As an agent

```bash
# 2. Call it without paying. Expect 402 with a machine-readable requirement.
curl -i -X POST localhost:4000/v1/paid/research \
  -H "authorization: Bearer meter_test_..."
```

```json
{
  "error": "PAYMENT_REQUIRED",
  "payment": {
    "paymentRequestId": "preq_01J...",
    "amount": "30000",
    "asset": { "symbol": "USDC", "decimals": 6 },
    "chain": { "id": 84532, "slug": "base-sepolia" },
    "expiresAt": "..."
  },
  "instructions": { "complete": "POST /v1/test/payment-requests/preq_01J.../complete" }
}
```

```bash
# 3. Settle it. No wallet, no testnet USDC, no block times.
curl -X POST localhost:4000/v1/test/payment-requests/preq_01J.../complete \
  -H "authorization: Bearer meter_test_..."
# -> { "data": { "reference": "0x...", "payment": {...}, "receipt": {...} } }

# 4. Retry with the reference. Served.
curl -X POST localhost:4000/v1/paid/research \
  -H "authorization: Bearer meter_test_..." \
  -H "meter402-payment: $(echo -n '{"paymentRequestId":"preq_01J...","reference":"0x..."}' | base64 -w0)"
```

The response carries `Meter402-Receipt-Id`. Replaying the same proof returns
`409 PAYMENT_ALREADY_USED`: one payment buys one request.

### Configuration

`TEST_SIMULATOR_SECRET` is required at boot and must differ from
`AUTH_SECRET`, `API_KEY_HASH_PEPPER`, and `WEBHOOK_SIGNING_SECRET`. Generate
one with `openssl rand -hex 32`.

The API key needs `payments:write` to call a paid endpoint or the simulator,
and `payments:read` to read receipts. Endpoint configuration is a user session
only — a key cannot create or reprice the endpoints it pays for.
