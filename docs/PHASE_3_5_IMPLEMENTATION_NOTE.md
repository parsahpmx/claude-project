# Phase 3.5 — Real-Network Validation & Reconciliation

## Summary

Phase 3.5 set out to do two things: run Meter402's x402 v2 settlement against a
real Base Sepolia network through a real independent facilitator, and build the
reconciliation worker that resolves settlements whose outcome was never
observed.

**The second was done. The first could not be attempted.** This environment has
no outbound route to any Base RPC endpoint or any hosted facilitator; every host
tested is refused at CONNECT by network policy. The measurement is in §1 below.

That distinction runs through the rest of this note, and through
`docs/MAINNET_READINESS.md`, which remains **NOT READY**. Nothing here should be
read as evidence that Meter402 settles correctly on a real chain, because
nothing here tested that.

---

## 1. The network measurement

Every RPC endpoint and facilitator host tested returns HTTP `000` at the client
and a `403` to `CONNECT` at the agent proxy — a policy denial, not a
timeout, a DNS failure, or an upstream outage:

| Host | Purpose | Result |
| --- | --- | --- |
| `sepolia.base.org` | Base Sepolia RPC (official) | CONNECT refused |
| `base-sepolia.publicnode.com` | Base Sepolia RPC | CONNECT refused |
| `base-sepolia-rpc.publicnode.com` | Base Sepolia RPC | CONNECT refused |
| `rpc.ankr.com` | Base Sepolia RPC | CONNECT refused |
| `endpoints.omniatech.io` | Base Sepolia RPC | CONNECT refused |
| `x402.org` | Reference facilitator | CONNECT refused |
| `api.cdp.coinbase.com` | Coinbase CDP facilitator | CONNECT refused |
| `facilitator.x402.rs` | Independent facilitator | CONNECT refused |

`registry.npmjs.org` is reachable, which is how the official `@x402/core` and
`@x402/evm` packages were installed. The restriction is on arbitrary egress,
not on the network as such.

**Consequently the following Phase 3.5 requirements were not executed and are
reported as not executed:**

- The 20-step Base Sepolia end-to-end scenario (item 5).
- Interoperability with an independent facilitator implementation (item 6's
  real-network half).
- Real negative network tests — RPC outage mid-settlement, facilitator
  returning a genuine on-chain failure, an authorization expiring on-chain.
- Any transaction hash from a successful testnet settlement. There are none to
  record, so the completion report records none.

No substitute was accepted for these. Running them against `FakeFacilitator`
would produce green output that means nothing, and the Phase 3.5 brief is
explicit that the release gate may not use it.

---

## 2. What was built

### 2.1 The reconciliation worker

The gap Phase 3 left: when `/settle` times out, Meter402 correctly refuses to
guess — the payment stays unresolved, the payer is told not to pay again, and
an audit event records the uncertainty. Nothing then resolved it.

Now something does.

**How it decides.** The worker asks the token contract, not the facilitator:
`authorizationState(authorizer, nonce)` on the USDC contract is the chain's own
record of whether an EIP-3009 authorization was consumed. Three answers, three
behaviours:

| Chain says | Meaning | Action |
| --- | --- | --- |
| Authorization used | The transfer happened | Record the Payment and Receipt through the normal pipeline |
| Unused, deadline passed | It can never be used now | Definitive failure — and only here |
| Unused, deadline in the future | Genuinely unknown | Retry with backoff; conclude nothing |
| RPC unreachable | Not evidence of anything | Retry with backoff; conclude nothing |

The fourth row is the one that matters most. An unreachable RPC is a fact about
our connectivity, and treating it as evidence about a payment is how a payer
gets told their payment failed when it succeeded.

**What it must never do.** It never calls `/settle`. A reconciler that could
re-settle would be a machine for producing exactly the double-charge it exists
to repair. It determines what already happened; it does not act.

**How exactly-once survives it.** It reuses the live path's constraints rather
than inventing parallel ones: `UNIQUE (payment_request_id)` on payments,
`UNIQUE (payment_id)` on receipts, the usage-event key, and the
`UNIQUE (chain_id, transaction_hash)` replay claim. Running one job twenty
times converges instead of accumulating, and so does running twenty workers
against one job.

**How workers share the queue.** `FOR UPDATE SKIP LOCKED` in the claim
statement, with the status flip to `IN_PROGRESS` in the same statement. N
workers partition the backlog rather than serialising on its head. A worker
that crashes mid-job leaves a row in `IN_PROGRESS`; `requeueStalledReconciliations`
returns anything stuck there past a timeout, so a crash costs a delay rather
than a permanently stuck payment.

**When it gives up.** Twelve attempts with exponential backoff (30s doubling,
capped at an hour), then `EXHAUSTED` — deliberately not `FAILED`. We still do
not know what happened, and saying "failed" would be a guess that could deny a
payer a service they paid for. `EXHAUSTED` exists to be alerted on; see
`docs/ALERTING.md`.

### 2.2 One thing the state machine had to allow

`authorizePayment` enforces the challenge deadline in `CREATED`,
`CHALLENGE_ISSUED` and `PENDING`, and stops enforcing it from `SUBMITTED`
onward — because, as Phase 0 puts it, expiry is a deadline for *paying*, not
for *confirming*.

Reconciliation necessarily runs after a settle call went uncertain, so it
routinely arrives past a five-minute TTL. Authorizing while still `PENDING`
would therefore reject a payment the chain has already confirmed succeeded —
taking the payer's money without serving their request, the exact failure the
expiry rule exists to prevent. So `confirmReconciledPayment` transitions the
request to `SUBMITTED` first, which is also the honest status: the token
contract says the authorization was consumed, so the transfer was submitted.

This is flagged for the external reviewer (see
`docs/EXTERNAL_SECURITY_REVIEW_SCOPE.md` §2) because it is the kind of
reasoning that is either correct or a hole, with little in between.

### 2.3 Facilitator startup validation

A facilitator settles a specific scheme on specific networks. Pointing Meter402
at one that does not handle `exact` on our chain produces a deployment that
issues challenges, takes signed authorizations from agents, and then fails at
`/settle` — after the agent believes it has paid.

`preflightFacilitator` now checks `/supported` at boot, and treats the two
failure modes differently:

- **Incompatible** — it answered, and does not support what we need (or did not
  answer with an x402 document at all, which usually means the URL points at
  something that is not a facilitator). This will not fix itself and every
  payment would fail. **Refuse to start.**
- **Unreachable** — it did not answer. That says nothing about whether the
  configuration is right, and blocking the deploy on it means a facilitator
  blip stops us shipping the fix for the outage. **Start, log at error level,
  and let `/health/payments` carry it.**

### 2.4 `/health/payments` gained the backlog

The endpoint used to answer "is the facilitator up". That turned out to be the
less important question. It now also carries:

```jsonc
"backlog": {
  "pendingSettlements": 0,
  "reconciliationBacklog": 0,
  "exhausted": 0,
  "uncertainSettlements": 0,
  "oldestUnresolvedAgeSeconds": null
}
```

Counts and an age, deployment-wide. No addresses, no payment IDs, no
organization IDs — asserted by a test, because this endpoint gets scraped,
dashboarded and pasted into incident channels, and an identifier leaking
through it ends up somewhere nobody chose to put it.

The backlog read is allowed to fail on its own (`{ "unavailable": true }`)
without taking the rest of the response with it. A health endpoint that returns
nothing when one dependency breaks is least useful exactly when it is needed.

### 2.5 Mainnet lockout, now tested end to end

Base mainnet was already disabled by two flags. Phase 3.5 added the proof that
it is unreachable through *every* route into the system, in
`apps/api/src/routes/v1/mainnet-lockout.integration.test.ts`: the environment
flags, the derived chain list, the settlement-configuration write path, the
running system's reported networks, and a scan of every tracked deployment file
for a committed `ENABLE_BASE_MAINNET=true`.

One real gap was found and closed while writing it. The settlement
configuration route accepted a mainnet destination even while mainnet was
disabled. Nothing would have settled — payment-time checks refuse a disabled
chain — but a stored mainnet destination is a loaded gun: the day someone
enables mainnet for a legitimate reason, every configuration written while it
was unreachable becomes live at once, with nobody re-reviewing it. The write is
now refused.

---

## 3. Defects found and fixed

**A shared transaction hash across reconciliation fixtures.** Not a product
defect but worth recording, because diagnosing it took the longest. The
transaction-replay guard is deliberately global — one transaction settles at
most one payment request anywhere in the system — so tests using a fixed fake
hash passed on a clean database and failed on every subsequent run against the
same one. The fixtures now derive a distinct hash per run and per
authorization, which also matches the chain: one EIP-3009 authorization is
consumed by exactly one transfer.

**A `Date` interpolated into a raw SQL template.** `claimReconciliationJobs`
failed with an opaque "Failed query" because a value interpolated into a
Drizzle `sql` template has no column behind it and so never reaches the type
mapper that would serialise a `Date`; the driver received the object and threw.
Fixed by passing an ISO string with an explicit `::timestamptz` cast.

**A discarded rejection reason.** When reconciliation found an on-chain
settlement but `authorizePayment` refused it, the queue row recorded only
"authorization was not accepted". An operator reading that row — about real
money — learns nothing about whether to wait, re-run, or intervene. The reason
is now carried through.

---

## 4. Verification

See `docs/PHASE_3_5_COMPLETION_REPORT.md` for the full run and its counts.

The claim this note wants to be precise about: **every test in this repository
runs offline against test doubles or a local PostgreSQL.** The reconciliation
worker is proven correct against a `FakeSettlementOracle`. Its real
implementation, `ViemSettlementOracle` — the `readContract` call and the
`getLogs` search that actually talk to a chain — has never been executed. A
wrong ABI, a log range a provider refuses, or a subtly different
`authorizationState` response would be invisible to everything reported here.
