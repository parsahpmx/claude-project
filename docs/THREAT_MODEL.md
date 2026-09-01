# Meter402 — Threat Model

**Scope:** the Meter402 control plane (API, dashboard, workers, database), the
merchant-side SDK, and the payment verification path.
**Out of scope:** the merchant's own application security, the agent's wallet
custody, and the security of Base or USDC themselves.

Status labels: **[mitigated]** implemented and tested · **[partial]** designed,
partly implemented · **[open]** not yet addressed.

---

## 1. Assets worth attacking

| Asset | Why an attacker wants it |
| --- | --- |
| Merchant settlement addresses | Redirect payments to an attacker wallet |
| API keys | Impersonate a merchant, read revenue, alter pricing |
| Payment records | Forge evidence of payment to obtain paid services free |
| Cross-tenant data | Competitor revenue intelligence |
| Webhook secrets | Forge payment notifications to a merchant's system |
| The verification decision | The whole product: a "yes" without payment is theft |
| Dashboard sessions | Full account takeover |

**Not an asset: customer funds.** Meter402 never holds them (ADR-0003). This
single design decision removes what would otherwise be the highest-severity
category in this document.

## 2. Trust boundaries

```
[Agent] ──untrusted──► [Merchant API + SDK] ──semi-trusted──► [Meter402 API]
                                                                    │
                                              [Meter402 API] ──► [Postgres/Redis]
                                                                    │
                                              [Meter402 API] ──► [RPC providers]
                                                                    │
                                              [Workers] ──► [Merchant webhook URL]
```

Four boundaries matter most:

- **Agent → merchant.** Fully untrusted. Everything an agent sends is hostile
  until proven otherwise, including the payment proof.
- **Meter402 → RPC providers.** Semi-trusted. A compromised or lying provider
  can assert a payment happened that did not.
- **Workers → merchant webhook URLs.** Outbound requests to attacker-chosen
  addresses. This is the SSRF boundary.
- **Merchant → merchant.** Tenant isolation. The highest-severity access
  control we own.

## 3. Threats

### T1 — Forged payment proof **[mitigated]**
*An agent claims to have paid and is served without paying.*

The agent supplies exactly one input: a transaction hash. Amount, recipient,
token, and chain all come from our own `PaymentRequest`. Verification reads
the chain independently. Tested against wrong recipient, wrong amount, wrong
network, wrong asset, and reverted transactions.

### T2 — Payment replay / double spend **[mitigated]**
*One transaction settles many requests.*

`UNIQUE (chain_id, transaction_hash)`; the claim is an `INSERT` against it, so
concurrent claims cannot both win. The claim happens **after** verification, so
a failed verification cannot burn a legitimate hash. Re-presenting the same
transaction for the *same* request is idempotent success, not a replay.

### T3 — Spoofed token / crafted event logs **[mitigated]**
*A hostile token emits a `Transfer` that looks like payment to the merchant.*

We only count logs from the expected token contract. Decoding is strict:
exactly 3 topics, exact `Transfer` signature, exactly one 32-byte data word,
and **address topics must have zero high-order padding** — otherwise a crafted
topic could alias the merchant's address in its low 20 bytes. Non-conforming
logs are ignored, never interpreted. Tested.

### T4 — RPC provider compromise or inconsistency **[partial]**
*A provider lies about a transaction, or is unreachable.*

Unreachable is handled: multiple providers, per-provider circuit breakers, and
failures resolve to `PENDING` rather than `FAILED` so a valid payment is never
wrongly rejected.

A provider that *lies* is only partly addressed. Today the first provider to
answer is believed. **Open:** cross-checking a second independent provider
before confirming high-value payments. Tracked for Phase 7. Until then the
mitigation is provider selection and the low value of individual
micropayments.

### T5 — Cross-tenant data access (IDOR) **[partial]**
*Merchant A reads merchant B's payments.*

Design is settled: every tenant-owned query is organization-scoped,
repositories require the organization as an argument, and a cross-tenant fetch
returns `RESOURCE_NOT_FOUND` rather than `PERMISSION_DENIED` so existence is
not confirmed. **Open:** the enforcement layer and its tests ship with the API
resource routes (Phase 1).

### T6 — API key theft **[partial]**
*A leaked key is used to impersonate a merchant.*

Keys are hashed with a peppered HMAC and compared timing-safely; plaintext is
shown once. Environment is legible from the prefix. Scopes limit blast radius.
Revocation is immediate. **Open:** anomaly detection on key usage, and secret
scanning of public repositories for leaked `meter_live_` keys.

### T7 — Settlement address substitution **[partial]**
*An attacker with dashboard access silently redirects payouts.*

This is the highest-value attack against a merchant, and it needs
defence-in-depth beyond ordinary authorization: explicit confirmation on
change, an audit event, a notification to all owners, and ideally a delay or
step-up authentication before the new address takes effect. Address format is
validated. **Open:** the confirmation, notification, and delay controls.

### T8 — SSRF via webhook URLs **[open]**
*A merchant points a webhook at cloud instance metadata or an internal service.*

Our workers make outbound HTTP to merchant-controlled URLs, which is textbook
SSRF. Required before webhooks ship: HTTPS only, DNS resolution with
private/loopback/link-local rejection, re-validation after redirects, no
cross-host redirects, and short timeouts. Documented in `SECURITY.md §4`.
**Must not ship without these.**

### T9 — Webhook forgery and replay **[partial]**
*An attacker convinces a merchant's system that a payment confirmed.*

HMAC-SHA256 over `timestamp.payload` with a per-endpoint secret. Verifiers
must enforce a timestamp tolerance — without it a captured signature is
replayable forever. **Open:** implementation, plus the SDK verification helper
that makes doing this correctly the easy path for merchants.

### T10 — Denial of service on verification **[partial]**
*Forged proofs are turned into expensive upstream RPC calls.*

The verification endpoint is unauthenticated by nature. Proof parsing is
bounded before allocation (8 KiB cap) and structurally validated before any
network call, so a malformed proof costs no RPC. **Open:** rate limiting per
IP and per payment request, and a per-request cap on verification attempts.

### T11 — Prototype pollution **[mitigated]**
JSON from untrusted sources is parsed with a reviver dropping `__proto__`,
`constructor`, and `prototype`. Tested.

### T12 — Request smuggling via duplicated headers **[mitigated]**
Duplicate `X-PAYMENT` headers are rejected rather than resolved by picking
one. Which value a proxy forwards versus which we read is exactly the
ambiguity these attacks exploit. Tested.

### T13 — TEST/LIVE confusion **[mitigated]**
*A test flow moves real money, or a live payment is silently simulated.*

`assertChainAllowedForEnvironment` runs at price quotation and at payment
request creation. TEST is confined to testnet chains, LIVE to mainnet.
Environment is encoded in API key prefixes. The simulator may act only on TEST
requests. Tested both directions.

### T14 — Supply chain compromise **[partial]**
Dependency lifecycle scripts are blocked by default with reviewed exceptions;
lockfile committed; CI installs frozen and audits. **Open:** dependency
pinning by integrity hash for the highest-risk packages, and provenance
verification.

### T15 — Insider threat **[partial]**
Audit logging is append-oriented by design; the admin console is designed to
expose no arbitrary key control. **Open:** the admin console itself, its
strong-authentication requirement, and least-privilege production access
review.

### T16 — MCP prompt injection / malicious tool metadata **[open]**
*A malicious MCP tool description manipulates an agent into overpaying, or a
merchant's tool metadata attacks the agent consuming it.*

Specific to our MCP surface and genuinely novel. Mitigations to design in
Phase 5: treat tool metadata as untrusted display data, never as instructions;
enforce buyer-side spending policy locally in the agent regardless of what a
tool advertises; and make price prominent and machine-checkable before
payment. **No LLM output may authorize a payment on its own** — rule 44.

### T17 — Broken access control / privilege escalation **[partial]**
Roles are defined centrally and evaluated server-side only. **Open:** the RBAC
implementation and its test matrix (Phase 1).

### T18 — Session hijacking **[open]**
Deferred to the chosen authentication provider, with our requirements listed
in `SECURITY.md §2`. Not yet integrated.

## 3a. Phase 3 threats — real settlement

Introduced by moving from a simulator to signed authorizations, an external
facilitator, and a real chain.

### T-30 Malicious payer replays a signed authorization

An EIP-3009 authorization is a bearer instrument. Its signature covers
`(from, to, value, validAfter, validBefore, nonce)` — and **not** the resource
being paid for. An attacker who observes one can point it at a different
payment request by editing `resource.url`, and every binding check still
passes: same payer, same amount, same recipient.

*Mitigation:* an atomic claim on
`UNIQUE (chain_id, asset_address, payer_address, authorization_nonce)` before
the facilitator is contacted. The transaction-hash guard cannot cover this —
at the moment of the replay no transaction exists. Tested directly, by forging
exactly this attack.

### T-31 Concurrent submission causes a double settlement

N simultaneous submissions of one valid authorization each find no payment
committed yet, each call `settle`, each potentially broadcasting a transaction.

*Mitigation:* only the caller that won the authorization claim may settle;
losers receive a retryable in-flight response. **This was a real defect found
by the 20-way concurrency test during Phase 3**, not a theoretical one — the
first implementation checked for an existing payment and let all twenty
through.

### T-32 Compromised or buggy facilitator

The facilitator is outside the trust boundary. It could report `isValid` for an
unsigned authorization, report a settlement that never happened, report one on
a different network, or name a different payer.

*Mitigation:* the signature is verified locally before the facilitator is
asked, so its verdict cannot manufacture a valid payment. Its settle report is
re-checked against the PaymentRequest for network, amount and payer. A
malformed body is a protocol error, never a payment. `success: true` without a
well-formed transaction hash is rejected.

*Residual:* a facilitator that reports a plausible but fabricated transaction
hash would be believed unless `OnChainConfirmingVerifier` is composed in.
That composition exists and is unused by default — a deployment using a
third-party facilitator should enable it.

### T-33 Facilitator outage or lost settlement response

A settle call that times out may already have broadcast a transaction.

*Mitigation:* never retried automatically, never marked FAILED. The request
moves to PENDING with an audit event, and the payer is told not to pay again.
*Residual:* **no reconciliation job exists yet** — see `MAINNET_READINESS.md`.

### T-34 Asset substitution / lookalike token

An attacker offers a token with the symbol `USDC` at an address they control.

*Mitigation:* the expected contract comes from the server-side registry keyed
on `(symbol, chainId)`, never from the request row and never from the client.
Tested with both a fabricated contract and the genuine mainnet USDC address
presented against a Sepolia request.

### T-35 Network downgrade / testnet–mainnet confusion

An authorization for Base Sepolia presented against a mainnet request, or the
reverse.

*Mitigation:* the expected network is derived from the request's chain and
compared exactly; no substitution. Separately, the EIP-712 domain differs per
network (Base Sepolia USDC signs as `"USDC"`, mainnet as `"USD Coin"`), so a
signature made for one network does not verify against the other — tested.
Mainnet additionally requires two configuration flags that the config layer
refuses to let drift apart.

### T-36 Recipient replacement / merchant wallet takeover

An attacker who gains a credential repoints settlement to their own address.

*Mitigation:* settlement mutation is human-only — there is no API-key scope for
it at all — and requires `settlement:write`, which a DEVELOPER does not hold.
Every change is audited in the same transaction. Already-issued PaymentRequests
keep their recipient snapshot, so a compromise cannot retroactively capture
payments already quoted. All tested.

### T-37 Payment parser abuse and header amplification

An unauthenticated request carrying a huge `PAYMENT-SIGNATURE` header forces
allocation and parsing; or a flood of authorizations turns Meter402 into an
amplifier pointed at the facilitator.

*Mitigation:* the encoded length is bounded before the base64 decode and the
decoded length before the JSON parse. All local checks — shape, binding,
signature — run before any outbound call, so a forged payload costs zero
outbound requests. The paid surface has a per-credential rate limit well below
the global one.

### T-38 Chain reorganisation

A settlement confirmed at low depth is reorganised out.

*Mitigation:* unchanged from Phase 0 — confirmations are configurable and the
uncertainty states exist. *Residual:* value-scaled finality thresholds are
still not implemented, and on a testnet this has not been exercised at all.

### T-39 Mainnet misconfiguration

A deployment intended for testnet settles on mainnet.

*Mitigation:* mainnet requires `ENABLE_BASE_MAINNET` **and**
`LIVE_SETTLEMENT_ENABLED`; enabling only the former refuses to boot. Settlement
destinations are keyed by chain, so a testnet destination cannot receive
mainnet revenue by default. Config also refuses a production deploy pointed at
a testnet chain.


## 4. Explicitly accepted risks

| Risk | Why accepted |
| --- | --- |
| Deep chain reorg reverses a confirmed micropayment | Confirmation thresholds make this rare, and single-payment value is cents. **Must be revisited** before high-value payments; value-scaled finality is Phase 7. |
| A single RPC provider is believed | See T4. Acceptable at micropayment values, not at scale. |
| We cannot verify merchant legal identity | We do not claim to. KYB integration points are designed, not built. |

## 5. Review cadence

This document is reviewed at the close of every phase, on any change to the
verification path, and after any security incident. Each **[open]** item must
either be closed or explicitly re-accepted with a reason before the feature it
guards ships.
