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

The test payment simulator may only ever act on TEST requests.

## 8. Reorgs and finality

Base is an L2 with fast blocks; deep reorgs are rare but not impossible.

- Confirmation thresholds are per-chain configuration, not constants.
- `CONFIRMING → PENDING` exists so that a transaction that becomes
  unobservable is retried rather than failed.
- For high-value payments the threshold should scale with value. **Not yet
  implemented** — the confirmation count is currently fixed per chain. Tracked
  in `ROADMAP.md` as Phase 7 hardening.

## 9. Protocol adapters

`PaymentProtocolAdapter` isolates wire format. `@meter402/x402` is the only
implementation today.

**Conformance caveat, stated plainly:** the x402 adapter implements the
request/response shape described in public x402 v1 material. It has **not**
been conformance-tested against the published specification or an independent
x402 client. Meter402 must not advertise x402 compatibility publicly until
that validation is done and any divergence resolved. Tracked in Phase 3.

## 10. What is not yet built

Honest inventory as of Phase 0:

- Payment persistence and the confirmation worker (Phase 2–3)
- Receipts, usage metering, webhooks (Phase 3, 6)
- Test payment simulator (Phase 2)
- Refunds beyond schema support (post-MVP)
- Value-scaled finality thresholds (Phase 7)
- Reconciliation job (Phase 7)
