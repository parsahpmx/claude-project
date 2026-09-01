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
| 6 | Security review complete | **Not done** — no external review has taken place |
| 7 | Settlement mutation controls verified | **Done** — human-only, RBAC-gated, audited, tested |
| 8 | Monitoring configured | **Partly** — metrics and `/health/payments` exist; no alerting is wired |
| 9 | Uncertainty recovery verified | **Partly** — uncertain settlement resolves to PENDING and is tested; **no reconciliation job exists** |
| 10 | Rate limits configured | **Done** — per-key limits on the paid surface and simulator |
| 11 | Mainnet asset/network config independently verified | **Done** — cross-checked against the x402 reference asset table |
| 12 | Kill switch available | **Done** — `LIVE_SETTLEMENT_ENABLED`, not reachable from any merchant credential |
| 13 | Production secrets configured safely | **Not done** — deployment concern, outside this repository |

Five items are incomplete. Items 5, 6 and 9 are the blocking ones.

---

## The three blockers, stated plainly

### 1. Nothing has ever settled on a real chain

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

### 2. There is no reconciliation job

When a settle call times out, Meter402 correctly refuses to guess: the payment
request moves to `PENDING`, an audit event records the uncertainty, and the
payer is told not to pay again. That is the right behaviour, and it is tested.

But nothing then resolves it. A PENDING payment stays PENDING until a human
looks. On a testnet that is an annoyance; on mainnet it is a customer whose
money may have moved and whose request was never served, with no automated path
to a resolution. A reconciliation worker that re-reads the chain and closes out
uncertain settlements is a prerequisite, not a nicety.

### 3. No external security review

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
3. Build the reconciliation worker and prove it recovers a deliberately
   interrupted settlement.
4. Commission the external security review.
5. Wire alerting to the counters in `/health/payments` — particularly
   `settle_uncertain`, `authorization_replay_attempts`, and
   `wrong_recipient_attempts`.
6. Only then consider a **controlled mainnet test** with a hard spend cap and a
   named operator watching, not a general release.

Until at least steps 1–4 are complete, the honest status remains **NOT READY**.
