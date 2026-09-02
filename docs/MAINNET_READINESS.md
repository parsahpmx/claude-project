# Base Mainnet Readiness

**Current status: NOT READY.**

Base mainnet is disabled by configuration and must stay disabled. This document
is the checklist that would have to be completed before that changes, and an
honest account of which items are done.

---

## How mainnet is currently prevented

Three independent gates, all defaulting to off:

1. `LIVE_SETTLEMENT_ENABLED=false` — no real settlement on any network.
2. `ENABLE_BASE_MAINNET=false` — mainnet is not a selectable network even when
   settlement is on. Config **refuses to boot** if mainnet is enabled without
   settlement, so the two cannot drift apart.
3. `settlement.enabledChainIds` is derived from those flags, and the payment
   gate refuses any endpoint whose chain is not in it.

A fresh checkout therefore settles on no chain at all. That is asserted by
tests, not just documented: `packages/config/src/config.test.ts` checks the
default is an empty chain list, that the string `"false"` is not read as true,
and that an unrecognised flag value is refused rather than guessed.

---

## Checklist

| # | Requirement | Status |
| --- | --- | --- |
| 1 | All unit tests green | **Done** — see the Phase 3 report for counts |
| 2 | All PostgreSQL integration tests green | **Done** |
| 3 | All concurrency tests green | **Done** — 20-way settlement race, exactly one settle call |
| 4 | All conformance tests green | **Partly** — wire and client conformance done; facilitator not |
| 5 | Base Sepolia E2E green | **NOT DONE — never executed** |
| 6 | Security review complete | **Not done** — no external review has taken place; scope prepared in `EXTERNAL_SECURITY_REVIEW_SCOPE.md` |
| 7 | Settlement mutation controls verified | **Done** — human-only, RBAC-gated, audited, tested |
| 8 | Monitoring configured | **Partly** — metrics, settlement backlog and `/health/payments` exist; thresholds are specified in `ALERTING.md`; **nothing is wired to a pager** |
| 9 | Uncertainty recovery verified | **Partly** — a reconciliation worker now exists and recovers a genuinely interrupted settlement in tests; **never verified against a real chain** |
| 10 | Rate limits configured | **Done** — per-key limits on the paid surface and simulator |
| 11 | Mainnet asset/network config independently verified | **Done** — cross-checked against the x402 reference asset table |
| 12 | Kill switch available | **Done** — `LIVE_SETTLEMENT_ENABLED`, not reachable from any merchant credential |
| 13 | Production secrets configured safely | **Not done** — deployment concern, outside this repository |

Five items are incomplete. Items 5 and 6 are the blocking ones.

Item 9 moved from "no reconciliation job exists" to "exists and is tested
against a fake chain" in Phase 3.5. That is real progress and it is not
completion: the worker has never asked a real token contract anything.

---

## The gaps, stated plainly

Two of these three block mainnet outright. The middle one no longer does, and
is kept here because what replaced it is unverified rather than done.

### 1. Nothing has ever settled on a real chain (blocking)

No payment has been settled on Base Sepolia or anywhere else. The settlement
path is exercised only against a test double (`FakeFacilitator`), which proves
Meter402 drives the flow correctly and reacts correctly to every answer a
facilitator can give — and proves nothing about a real facilitator or a real
chain.

This environment cannot close that gap: outbound HTTPS to `sepolia.base.org`
and to hosted facilitators is blocked by network policy (measured; see
`X402_V2_CONFORMANCE_PLAN.md` §0.2). Closing it requires an environment with
egress, a funded Base Sepolia wallet, and a facilitator account.

**Going to mainnet before a testnet payment has ever succeeded would mean the
first real settlement in the system's history is one carrying real money.**

### 2. Reconciliation has never met a real chain

Phase 3.5 built the missing worker. When a settle call goes uncertain, the
payment is enqueued for reconciliation in the same transaction that records the
uncertainty; a worker later asks the token contract whether the authorization
was consumed (`authorizationState`), and records what already happened. It
never calls `/settle`, so it cannot itself cause a double charge. It concludes
failure only when the authorization is both unused and past its deadline, so it
cannot deny a payer a service they paid for. Twenty concurrent workers converge
on one Payment, one Receipt and one usage event.

All of that is proven against a `FakeSettlementOracle`. The oracle's real
implementation — `ViemSettlementOracle`, which does the `readContract` call and
the `getLogs` search — **has never been run against a chain.** A wrong ABI, a
log range the RPC provider refuses, or a subtly different `authorizationState`
answer would all be invisible to the current tests.

So the failure mode has changed shape rather than closed: a PENDING payment no
longer waits for a human, but what unblocks it has never been observed working.

### 3. No external security review (blocking)

Item 6 has not happened. The Phase 3 review in `SECURITY.md §14` is a
self-review, which is worth something and is not a substitute.

---

## What is genuinely ready

Not everything is outstanding, and the parts that are done are the parts that
are hardest to retrofit:

- **Binding is exact and total.** Amount, asset contract, recipient, network,
  scheme, protocol version and both validity bounds are all compared against
  the stored `PaymentRequest` with no tolerance. Tampering with any of them —
  including the client's echoed `accepted` block — is rejected before a
  facilitator is contacted.
- **Two independent replay guards**, both database constraints:
  `UNIQUE (chain_id, asset_address, payer_address, authorization_nonce)` for
  signed authorizations, and the pre-existing
  `UNIQUE (chain_id, transaction_hash)` for settlements.
- **Exactly-once holds under concurrency.** Twenty simultaneous submissions of
  one authorization produce one Payment, one Receipt, one usage event and
  **one** facilitator settle call.
- **Settlement destinations are human-only.** No API-key scope grants it; the
  capability does not exist for machines.
- **Uncertainty never becomes failure**, which is the property that decides
  whether a bad day costs money or only costs time.

---

## Recommended path

1. Obtain an environment with network egress, a funded Base Sepolia wallet and
   a facilitator account.
2. Run the Base Sepolia end-to-end scenario. Fix whatever it finds — and expect
   it to find something; no amount of local testing substitutes for the first
   real settlement.
3. Point the reconciliation worker at a real Base Sepolia RPC and prove
   `ViemSettlementOracle` recovers a deliberately interrupted settlement
   against the real USDC contract. The worker and its logic exist; what is
   unverified is the chain access underneath them.
4. Commission the external security review.
5. Wire alerting to `/health/payments` following `ALERTING.md` — particularly
   `backlog.exhausted`, `backlog.oldestUnresolvedAgeSeconds`, and
   `authorization_replay_attempts`. The thresholds there are guesses until
   real traffic calibrates them.
6. Only then consider a **controlled mainnet test** with a hard spend cap and a
   named operator watching, not a general release.

Until at least steps 1–4 are complete, the honest status remains **NOT READY**.

---

## Phase 3.5 changed these lines and no others

Recorded so that a reader can see what moved without diffing:

- Item 9, from "no reconciliation job exists" to "exists, tested against a fake
  chain, never run against a real one".
- Item 8, from "no alerting is wired" to "thresholds specified, nothing wired".
- Item 6 gained a prepared scope document. It is not closer to done.

Items 5 and 6 — the two blockers — are **unchanged**. Phase 3.5 set out to
close item 5 with a real testnet run and could not: this environment has no
route to any Base RPC endpoint or facilitator. Every host tested returns a
policy denial at CONNECT. That is a fact about the environment, not a
conclusion about the code, and it means the single most important question
about this system remains unanswered.
