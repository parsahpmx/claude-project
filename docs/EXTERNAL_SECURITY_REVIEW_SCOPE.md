# External Security Review — Scope

Prepared to brief an independent reviewer. **Nothing in this document is a
finding, and no security review has been performed.** It describes what a
reviewer should look at and what they should be sceptical of.

> This scope was written by the same process that wrote the code it describes.
> That is a conflict of interest, and it is the reason an external review is
> required rather than optional: a self-assessment cannot find the class of
> problem where the author's mental model is itself wrong. Treat every claim
> below as a claim to be checked, not as a result.

## What is being reviewed

Meter402 through Phase 3.5: an x402 v2 payment gate that prices HTTP requests,
challenges unpaid ones, verifies EIP-3009 authorizations, settles through an
external facilitator on Base Sepolia, and reconciles settlements whose outcome
it did not observe.

Commit: the `claude/meter402-startup-master-wkzasr` branch head at review time.

**Not in scope:** Base mainnet (disabled, see `docs/MAINNET_READINESS.md`), the
dashboard (not built), and any custody of funds (there is none — see below).

## The properties we believe hold

A reviewer's most useful output is a counterexample to one of these. They are
stated as falsifiable claims for that reason.

1. **Exactly one economic settlement per authorization.** Not merely one
   `Payment` row. Twenty concurrent submissions of one authorization must
   produce at most one `/settle` call that moves money.
   *Where to look:* `apps/api/src/modules/payments/x402-payment.service.ts`
   (the authorization claim gating settlement),
   `packages/database/src/replay-guard.ts`, and the two unique constraints:
   `(chain_id, asset_address, payer_address, authorization_nonce)` and
   `(chain_id, transaction_hash)`.
   *Known history:* an earlier revision had exactly this bug — a check-then-act
   race let 20 submissions produce 20 settle calls. It was found by a
   concurrency test, not by reading the code. Assume siblings of it exist.

2. **Reconciliation never moves money.** It determines what already happened
   from the chain's own record (`authorizationState` on the token contract) and
   records it. It must never call `/settle`.
   *Where to look:* `apps/api/src/modules/payments/reconciliation.service.ts`,
   `packages/blockchain/src/settlement-oracle.ts`.

3. **No cross-tenant access.** A valid identity for organization A cannot read
   or modify B's resources through guessed IDs, malformed requests, role
   manipulation, or API-key usage.
   *Where to look:* `apps/api/src/lib/tenant.ts` and every repository function
   taking a `TenantScope`. The scoping is by convention enforced through a
   branded type; a reviewer should ask what happens when someone forgets it.

4. **Non-custodial settlement.** Meter402 holds no private keys and cannot move
   funds. The payer signs; the facilitator submits.
   *Where to look:* anywhere a signer could be introduced. This property is
   maintained by absence, which makes it easy to erode by accident.

5. **Uncertainty is never resolved by guessing.** A payment is marked failed
   only on definitive evidence — the authorization unused *and* past its
   deadline, so it can never be used. Otherwise the system retries, and
   eventually escalates to a human, rather than concluding.
   *Where to look:* `determineSettlement` in
   `packages/blockchain/src/settlement-oracle.ts`.

6. **Secrets do not leak into logs, audit events, health endpoints, or error
   responses.** Including: API secrets, facilitator credentials, signed payment
   authorizations, and the payment-signature payload.

## Where we would look first

Ranked by where we think the risk actually is, not by what is easiest to
review:

1. **The settlement race under real concurrency.** The property in claim 1 is
   the one the product cannot survive losing, and it depends on a database
   constraint doing exactly what we think it does under a transaction isolation
   level we chose. Our tests run 20 workers against real PostgreSQL; a reviewer
   with an adversarial mindset should try harder than that.

2. **The reconciliation state machine.** It transitions a payment request to
   SUBMITTED specifically so `authorizePayment` will not enforce the challenge
   deadline against it. That is deliberate and documented — expiry is a
   deadline for paying, not for confirming — but it is exactly the kind of
   reasoning that is either correct or a hole, with little in between.

3. **The EIP-712 domain per network.** Base Sepolia USDC signs as `"USDC"`;
   mainnet USDC signs as `"USD Coin"`. Getting this wrong produces signatures
   that verify against the wrong domain. We believe we have it right for
   Sepolia; we have never executed against mainnet.

4. **Trust in facilitator responses.** The facilitator is external and
   independent. What does Meter402 believe on its word, and what does it verify
   independently? A malicious or compromised facilitator is in the threat model
   (`docs/THREAT_MODEL.md`); a reviewer should test whether the code agrees.

5. **The authorization binding.** `bindAuthorizationToRequest` enforces zero
   tolerance between what was signed and what was requested. Any tolerance
   introduced here is a way to pay for one thing and receive another.

## What has *not* been validated, and matters

Stated explicitly so a reviewer does not assume test coverage implies real
coverage:

- **No transaction has ever settled on Base Sepolia.** No RPC endpoint or
  facilitator is reachable from the build environment; every host tested
  returns a policy denial. The end-to-end flow has been exercised only against
  a fake facilitator and a fake settlement oracle.
- **No real facilitator has ever been contacted.** Conformance to x402 v2 is
  established by encoding and decoding with the official `@x402/core` and
  `@x402/evm` libraries offline, which proves wire compatibility with that
  implementation and nothing about any deployed facilitator's behaviour.
- **The system has never processed real traffic.** Every threshold in
  `docs/ALERTING.md` is a guess.
- **No load, soak, or resource-exhaustion testing has been done.**
- **No dependency audit or supply-chain review has been done.**

## How to reach a conclusion we would trust

We would consider the review meaningful if it includes: an attempt to
double-settle a single authorization under concurrency; an attempt to reach one
organization's data from another's credentials; an attempt to make
reconciliation conclude something false in either direction; and a review of
what is logged during a failed payment.

A review that reads the code and agrees with this document has told us very
little.
