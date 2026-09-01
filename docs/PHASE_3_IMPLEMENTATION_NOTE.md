# Phase 3 — Implementation Note

Real x402 v2 payments over EIP-3009 on Base Sepolia, behind the existing
payment domain.

---

## 1. The finding that shaped the phase

The brief targeted "x402 v2". Verifying that against published packages turned
up two different lineages:

| Package | Latest | Protocol versions | Network format |
| --- | --- | --- | --- |
| `x402` (unscoped, legacy) | 1.2.0 | `[1]` only | slugs (`"base-sepolia"`) |
| `@x402/core` (scoped) | 2.24.0 | `1` and `2` | CAIP-2 (`"eip155:84532"`) |

Phase 0's adapter was written against the first. Building "v2" on it would
have been impossible; building it while *believing* we had would have produced
a server that advertised v2 and spoke v1.

Everything in Phase 3 targets `@x402/core@2.x`. Every wire shape in this
codebase was obtained by **running the official implementation and printing
what it produced**, not by reading prose. See
[`X402_V2_CONFORMANCE_PLAN.md`](X402_V2_CONFORMANCE_PLAN.md).

## 2. The domain did not change

The architectural rule was: x402 is one adapter, not the payment model. It
held.

```
Merchant resource
      ↓
Payment domain            ← unchanged
      ↓
PaymentProtocolAdapter    ← unchanged interface
      ↓
├── TestPaymentProtocolAdapter    ← unchanged, still passing
└── X402V2PaymentProtocolAdapter  ← new
      ↓
FacilitatorClient         ← new
      ↓
Base / USDC
```

Both adapters converge on the **same** `authorizePayment` pipeline. The x402
flow has a step the TEST flow does not — a signed authorization that must be
bound and settled — and that step is genuinely protocol-specific, so it lives
in the adapter and the x402 service. But once settlement produces a transaction
hash, both protocols hand a `PaymentProof` to the same function and get the
same expiry rules, amount and recipient comparisons, transaction-replay claim,
state machine, and exactly-once Payment/Receipt creation.

The domain was not forked. What differs is what an adapter is for.

## 3. Flow ordering was read, not chosen

The reference implementation defines flow phases per payment flow:

```js
authorization: { verifyBeforeHandler: true,  settleBeforeHandler: false, settleAfterHandler: true  }
upfront:       { verifyBeforeHandler: false, settleBeforeHandler: true,  settleAfterHandler: false }
escrow:        { verifyBeforeHandler: false, settleBeforeHandler: true,  settleAfterHandler: true  }
```

EVM `exact` uses `authorization`, so the ordering is **verify → handler →
settle**. Two behaviours fall out of that rather than being special cases we
invented:

- If the merchant handler fails, settlement never runs and the payer is not
  charged.
- The merchant is never asked to serve a request that was not going to pay.

That ordering is why `PaymentGateDecision` has an
`AUTHORIZED_PENDING_SETTLEMENT` variant carrying a `settle()` continuation: the
gate cannot finish an x402 payment alone, because the handler has to run in the
middle. Modelling the pause explicitly means there is no path to a settled
payment that skips the point where the handler could have failed.

## 4. Three concepts, two axes

Phase 2 had one overloaded notion of "test". Phase 3 needs three:

| Configuration | Meaning |
| --- | --- |
| `environment: TEST`, `settlementProtocol: test` | Simulated. No blockchain. |
| `environment: TEST`, `settlementProtocol: x402` | Real signed payment, Base Sepolia. |
| `environment: LIVE`, `settlementProtocol: x402` | Real money, Base mainnet. |

Expressed as two existing orthogonal axes rather than one ambiguous flag:
`environment` decides *which chain and which credentials*, `settlementProtocol`
decides *how settlement happens*. `settlementProtocol` defaults to `test`, so a
merchant opts in to real money and never receives it by omission.

## 5. Two replay guards, because one window is invisible to the other

| Guard | Constraint | Protects |
| --- | --- | --- |
| Authorization (new) | `UNIQUE (chain_id, asset_address, payer_address, authorization_nonce)` | Before settlement |
| Transaction (Phase 0) | `UNIQUE (chain_id, transaction_hash)` | After settlement |

The new one is not redundant, and the reason is specific: **an EIP-3009
signature does not cover the resource being paid for.** It signs
`(from, to, value, validAfter, validBefore, nonce)`. An attacker who observes a
valid authorization can point it at a different payment request by editing
`resource.url`, and every binding check still passes — same payer, same amount,
same recipient. The transaction guard cannot help, because at that moment no
transaction exists.

There is a test that performs exactly this forgery.

## 6. The bug the concurrency test found

The 20-way concurrency test failed on first run: **twenty simultaneous
submissions of one authorization produced twenty `settle` calls.**

The cause was a check-then-act race of the kind this codebase warns about
elsewhere. `settleX402Payment` looked for an existing payment before settling;
under concurrency all twenty found none, because none had committed yet.

The fix uses the atomic claim that already existed: **only the caller that won
the authorization claim may settle.** A loser receives a retryable in-flight
response and never contacts the facilitator. The test now asserts exactly one
settle call, and fails without the fix.

This is the phase's most valuable finding, and it is the reason the concurrency
test asserts on `settleCalls` — the facilitator call, not just the row counts.
Row counts alone would have stayed green: the `UNIQUE` constraint would still
have produced one Payment. The money would have moved twenty times anyway.

## 7. The EIP-712 domain trap

Circle's USDC deployments do not share an EIP-712 domain name:

| Network | Contract | Domain `name` |
| --- | --- | --- |
| Base Sepolia | `0x036CbD…F7e` | `"USDC"` |
| Base mainnet | `0x833589…913` | `"USD Coin"` |

Deriving the domain from the token symbol, or from the registry's display name,
would produce signatures that verify on exactly one of the two networks. Tests
written on the working one would all pass.

`TokenAsset` therefore carries an explicit `eip712: { name, version }`, and a
test asserts the two networks differ and that a signature made under one domain
fails against the other.

## 8. The facilitator is outside the trust boundary

`FacilitatorClient` treats it as untrusted infrastructure:

- HTTP 200 is not a payment. `isValid` and `success` are read from a validated
  body; a non-boolean is refused rather than coerced (a truthiness check reads
  the string `"false"` as valid).
- `success: true` without a well-formed transaction hash is malformed, not
  believed.
- The settle report is re-checked against the PaymentRequest for network,
  amount and payer.
- The signature is verified **locally, before** the facilitator is asked, so its
  verdict cannot manufacture a valid payment.

`settle` is never retried. It may already have broadcast a transaction, and a
blind retry is how a payer is charged twice. An uncertain settlement becomes
PENDING with an audit event — never FAILED, which would be a lie in the
direction that loses someone's money.

## 9. What Phase 3 did not do

- **Nothing has settled on a real chain.** Outbound HTTPS to `sepolia.base.org`
  and to hosted facilitators is blocked by network policy in this environment
  (measured, not assumed). The Base Sepolia E2E was not executed.
- **No reconciliation worker.** An uncertain settlement correctly becomes
  PENDING and stays there.
- **No merchant forwarding.** Still blocked on the SSRF gate, which remains
  open and untouched.
- **No mainnet.** Disabled behind two gates; see `MAINNET_READINESS.md`.

## 10. Release gates

| Gate | Status |
| --- | --- |
| x402 conformance | **OPEN.** Wire format and independent-client interop verified. Independent facilitator interop and Base Sepolia E2E not executed — two required conditions unmet. |
| Webhook SSRF | **OPEN and untouched.** |

The accurate public claim after Phase 3 is *"x402 v2 wire-conformant against
the official reference library, pending facilitator and testnet verification"*.
Not "x402 v2 compatible", and not "x402 certified".
