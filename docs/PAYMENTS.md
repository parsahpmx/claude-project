# Meter402 — Payments

How a payment is priced, challenged, verified, and settled. This is the
security-critical core of the platform; read it before changing anything under
`packages/payments`, `packages/blockchain`, or `packages/x402`.

---

## 1. Money representation

Every monetary amount is an integer count of an asset's smallest indivisible
unit, held as a JavaScript `bigint`.

USDC has 6 decimals, so **$0.03 is exactly `30000n`**.

There is no code path in this repository that converts a monetary amount to a
`number`. This is enforced three ways: the `Money` type exposes no numeric
accessor, ESLint bans `parseFloat` and `Math.round` in money packages, and the
database stores amounts as `NUMERIC(78,0)` and `bigint` columns.

Rules the `Money` type enforces:

- **Parsing refuses to truncate.** `"0.0000001"` against 6-decimal USDC throws
  rather than silently becoming `0`. Quietly dropping a fraction of a cent is
  how ledgers drift.
- **Cross-currency arithmetic throws.** Conversion must be explicit.
- **Fee scaling takes a rational and an explicit rounding mode.** A 0.8% fee is
  `multiplyByRatio(8n, 1000n, Rounding.Down)`. The rounding mode is required,
  not defaulted, because the correct choice differs between fees we charge and
  amounts we owe.
- **Wire format is a string.** A JSON number is a double; a large minor-unit
  amount would lose precision in transit.

The ledger invariant that reconciliation depends on: `gross = fee + net`,
exactly, for every payment.

## 2. Payment state machine

States and their meanings:

| Status | Meaning |
| --- | --- |
| `CREATED` | Request exists, no challenge served |
| `CHALLENGE_ISSUED` | 402 returned; the deadline clock is running |
| `PENDING` | Payment claimed but not yet observable — not a failure |
| `SUBMITTED` | A structurally valid tx hash accepted, queued for verification |
| `CONFIRMING` | On-chain and valid, below the finality threshold |
| `CONFIRMED` | Terminal success; the merchant may serve the request |
| `FAILED` | Terminal; definitively wrong, or retries exhausted |
| `EXPIRED` | Terminal; the window closed with no valid payment |
| `CANCELLED` | Terminal; withdrawn before payment |
| `REFUNDED` | Terminal; a confirmed payment was returned |

Allowed transitions:

```
CREATED           → CHALLENGE_ISSUED, EXPIRED, CANCELLED
CHALLENGE_ISSUED  → PENDING, SUBMITTED, EXPIRED, CANCELLED, FAILED
PENDING           → SUBMITTED, CONFIRMING, FAILED, EXPIRED
SUBMITTED         → CONFIRMING, PENDING, FAILED
CONFIRMING        → CONFIRMED, PENDING, FAILED
CONFIRMED         → REFUNDED
FAILED / EXPIRED / CANCELLED / REFUNDED → (terminal)
```

Three absences are deliberate and load-bearing:

- **`CONFIRMED → PENDING` does not exist.** If a confirmed payment could
  return to pending, a confirmed-and-served request could be re-verified and
  re-charged. `CONFIRMED` reaches only `REFUNDED`.
- **`SUBMITTED`/`CONFIRMING → EXPIRED` do not exist.** Expiry is a deadline for
  *paying*, not for *confirming*. Once an agent has broadcast, expiring the
  request would take the money without serving the request.
- **Self-transitions do not exist.** Re-applying a status is almost always a
  duplicated job. Callers that want to skip must check `canTransition` first,
  so the skip is a deliberate decision at the call site.

The transition table is frozen at runtime, and the test suite asserts **all
100 ordered status pairs** against it — not just the happy path.

## 3. Authorization pipeline

`authorizePayment()` is a pure function over injected dependencies. Every
branch, including ones impractical to provoke against a live chain, is
reachable from a unit test.

Order of checks, and why:

1. **Already settled?** An already-`CONFIRMED` request re-presented is an
   idempotent success. Agents retry; a retry of a paid call must not charge
   again or fail.
2. **Terminal?** Anything else terminal cannot be paid into.
3. **Expired?** Enforced only in `CREATED`, `CHALLENGE_ISSUED`, `PENDING`.
4. **Proof shape.** A malformed hash is rejected before it reaches an RPC
   provider — both to save the call and to keep unvalidated input out of
   upstream requests. This is a DoS control: forged proofs must not be
   convertible into expensive upstream calls.
5. **Nonce binding.** If the protocol echoes a nonce it must be the one we
   issued for *this* request, so a proof captured from one challenge cannot be
   presented against another with the same amount and recipient.
6. **On-chain verification.** Everything compared comes from our own
   `PaymentRequest`. The agent supplies exactly one thing: a transaction hash.
7. **Defence-in-depth re-checks** of chain, asset, recipient, and amount.
8. **Replay claim, last**, because it has a durable side effect. Claiming
   before verification would let an attacker burn a legitimate transaction
   hash by submitting it against a request it does not satisfy.

## 4. On-chain verification

What we verify, independently, for every payment:

- transaction exists and is mined
- transaction did not revert
- it is on the expected chain
- the log is a canonical ERC-20 `Transfer` from the expected token contract
- the recipient is the merchant's settlement address
- the amount is greater than or equal to the requested amount
- the confirmation count meets the finality threshold
- the transaction has not settled another payment request

### ERC-20 decoding is strict on purpose

The decoder rejects rather than interprets:

- exactly 3 topics, or it is not a `Transfer`
- `topics[0]` must equal `keccak256("Transfer(address,address,uint256)")`
- **address topics must have zero high-order padding.** A 32-byte topic whose
  high 12 bytes are non-zero is not an address. Reading only the low 20 bytes
  would let a crafted log alias the merchant's address and be counted as a
  payment to them.
- `data` must be exactly one 32-byte word. A longer payload is not a standard
  `Transfer`, and reading only its first word would let a hostile token hide a
  different value behind the one we check.

Any log failing these is ignored, not interpreted. A hostile token can emit
anything; only canonical transfers count.

### Multiple transfers

Matching transfers in a transaction are **summed**. Routers and smart accounts
legitimately split a payment. The merchant's question is "did I receive at
least the asking price in this transaction", not "was there one log for it".

### Overpayment

Accepted. Agents may round up against a stale quote; refusing would strand the
money.

### Confirmations

Inclusive: a transaction in the head block has one confirmation. If the head
is behind the receipt's block — which load-balanced RPC pools really do serve —
the count is clamped to zero rather than going negative.

## 5. Failure taxonomy

| Reason | Public code | Retryable | Meaning |
| --- | --- | --- | --- |
| `MALFORMED_PROOF` | `PAYMENT_INVALID` | no | Proof is not parseable or not bound to this challenge |
| `TRANSACTION_NOT_FOUND` | `PAYMENT_NOT_CONFIRMED` | **yes** | Not visible yet |
| `TRANSACTION_REVERTED` | `PAYMENT_INVALID` | no | Moved no funds |
| `WRONG_NETWORK` | `WRONG_NETWORK` | no | Settled on another chain |
| `WRONG_ASSET` | `WRONG_ASSET` | no | Different token |
| `WRONG_RECIPIENT` | `WRONG_RECIPIENT` | no | Different address |
| `WRONG_AMOUNT` | `WRONG_AMOUNT` | no | Underpayment |
| `INSUFFICIENT_CONFIRMATIONS` | `PAYMENT_NOT_CONFIRMED` | **yes** | Below finality |
| `TRANSACTION_ALREADY_USED` | `PAYMENT_ALREADY_USED` | no | Replay |
| `REQUEST_EXPIRED` | `PAYMENT_EXPIRED` | no | Window closed |
| `PROVIDER_UNAVAILABLE` | `PAYMENT_NOT_CONFIRMED` | **yes** | Our problem, not the payer's |

`TRANSACTION_NOT_FOUND` and `PROVIDER_UNAVAILABLE` map to
`PAYMENT_NOT_CONFIRMED`, never to `PAYMENT_INVALID`. Neither means the agent
did anything wrong. Telling an agent its valid payment was invalid because our
RPC blinked would make it pay twice.

## 6. Replay protection

A blockchain transaction may settle at most one payment request.

Enforcement is a `UNIQUE (chain_id, transaction_hash)` constraint. The
application-level `ReplayGuard.claim()` is an `INSERT` against it. An
application-side check-then-insert would race, and that race is exactly what a
double-spend attempt targets.

A transaction already bound to *the same* request is an idempotent retry and
proceeds. Bound to a different request, it returns `PAYMENT_ALREADY_USED`.

## 7. TEST and LIVE separation

A TEST project may transact only on testnet chains; a LIVE project only on
mainnet. Enforced by `assertChainAllowedForEnvironment`, called at price
quotation and again at payment-request creation — the two points where
merchant configuration becomes an instruction to pay a specific chain.

API keys carry the environment in their prefix (`meter_test_` / `meter_live_`),
so the environment of a credential is legible without a database lookup.

The test payment simulator may only ever act on TEST requests. Four independent
guards enforce that, each tested — see `SECURITY.md §12`.

Endpoint lookup makes the separation structural rather than remembered:
uniqueness is `(project, environment, method, normalized path)` and environment
is part of the **lookup key**, not a filter applied afterwards. There is no code
path in which a TEST credential resolves the LIVE definition of a route through
a forgotten condition, because the condition is not optional.

## 8. Reorgs and finality

Base is an L2 with fast blocks; deep reorgs are rare but not impossible.

- Confirmation thresholds are per-chain configuration, not constants.
- `CONFIRMING → PENDING` exists so that a transaction that becomes
  unobservable is retried rather than failed.
- For high-value payments the threshold should scale with value. **Not yet
  implemented** — the confirmation count is currently fixed per chain. Tracked
  in `ROADMAP.md` as Phase 7 hardening.

## 9. Protocol adapters

`PaymentProtocolAdapter` isolates wire format. Two implementations exist:
`X402V2PaymentProtocolAdapter` in `@meter402/x402` and
`TestPaymentProtocolAdapter` in `@meter402/payments`.

Both render the same internal `PaymentChallenge` and consume the same
`PaymentProof`, and both delegate to the same `authorizePayment` pipeline — so
every protocol inherits identical replay protection, expiry handling, and
outage semantics rather than each growing its own subtly different version.

Which adapter serves an endpoint is chosen by its `settlement_protocol`
column: `test` for a simulated payment with no blockchain, `x402` for a real
signed payment. That column is deliberately separate from `environment`,
because the two answer different questions — see §7.

**Conformance status after Phase 3.** The x402 v2 wire format has been verified
against the official reference implementation (`@x402/core@2.24.0`,
`@x402/evm@2.24.0`): the official decoder accepts our `PAYMENT-REQUIRED`, the
official client signs against it, our parser accepts what that client produced,
and the official decoder accepts our `PAYMENT-RESPONSE`. Fixtures come from the
official encoder, never from ours.

What remains unverified is **independent facilitator interoperability** and a
**real Base Sepolia settlement**, both blocked by network egress in the
development environment. The x402 release gate therefore **remains OPEN**, and
the accurate claim is *"wire-conformant against the official reference library,
pending facilitator and testnet verification"* — not "x402 compatible". See
`X402_V2_CONFORMANCE_PLAN.md` §9.

**Conformance caveat, stated plainly:** the x402 adapter implements the
request/response shape described in public x402 v1 material. It has **not**
been conformance-tested against the published specification or an independent
x402 client. Meter402 must not advertise x402 compatibility publicly until
that validation is done and any divergence resolved. Tracked in Phase 3.

## 10. What is not yet built

Honest inventory as of Phase 2:

**Built in Phase 3**

- x402 v2 `exact` scheme over EIP-3009 signed authorizations on Base Sepolia
- The `authorization` flow: verify -> merchant handler -> settle, taken from
  the reference implementation's flow phases rather than chosen
- `FacilitatorClient` abstraction, with the facilitator treated as untrusted
- Local EIP-712 signature verification, so a facilitator's verdict can never
  manufacture a valid payment
- Authorization replay protection as a second database constraint
- Settlement destinations keyed by (project, chain, asset), human-only
- Kill switch, per-credential rate limits on the paid surface, payment metrics,
  and a `/health/payments` endpoint separate from readiness

**Built in Phase 2**

- Payment request persistence with an immutable price snapshot
- The TEST payment simulator, driving the real authorization pipeline
- Payments and receipts, created exactly once via database constraints
- Usage metering: one event per authorized request, keyed on the payment
- The HTTP payment gate: 402, pay, retry, serve

**Still not built**

- **A settlement that has actually happened.** Every settlement in this
  codebase has been against a test double. No payment has been settled on Base
  Sepolia or any other chain, because this environment cannot reach one.
- **A reconciliation worker.** An uncertain settlement correctly becomes
  PENDING and stays there; nothing resolves it automatically.
- The confirmation worker for below-finality payments
- Base mainnet, which is disabled by two independent configuration gates
- Forwarding authorized requests to merchant infrastructure — blocked on the
  SSRF gate (see `SECURITY.md`)
- Webhooks (Phase 6)
- Refunds beyond schema support (post-MVP)
- Value-scaled finality thresholds (Phase 7)
- Reconciliation job (Phase 7)

### The limit of what TEST mode proves

A TEST payment exercises the real state machine, expiry rules, nonce binding,
replay claim, and exactly-once creation. It does **not** exercise the
amount/recipient/asset/chain comparisons in any meaningful sense, because the
settlement evidence is synthesised from the `PaymentRequest` and therefore
satisfies them trivially.

Those comparisons are covered separately and exhaustively, by unit tests
against hand-built receipts: wrong recipient, wrong amount, wrong asset, wrong
network, reverted transactions, and spoofed ERC-20 logs with non-zero address
padding. Neither body of tests substitutes for the other, and a green Phase 2
suite is not evidence that real settlement verification works end to end.
