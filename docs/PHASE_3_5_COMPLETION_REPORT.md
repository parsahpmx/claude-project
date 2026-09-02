# Phase 3.5 — Completion Report

Commit `82d502b` on `claude/meter402-startup-master-wkzasr`.

---

## 1. Mainnet readiness

**NOT READY.**

Two blockers are unchanged from Phase 3, and one of them is the item Phase 3.5
existed to close:

1. **No payment has ever settled on a real chain.** Base Sepolia was
   unreachable from this environment (§4).
2. **No external security review has taken place.** A scope document is
   prepared for one; that is not the same as having one.

`READY FOR CONTROLLED MAINNET TEST` is not available while the system has never
completed a single testnet settlement.

## 2. Beta readiness

**NOT READY FOR LIMITED BETA**, for the same reason stated in the Phase 3.5
brief: external security review is outstanding.

---

## 3. What was delivered

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Preserve all Phase 0–3 properties | **Done** — 729 tests pass, including every prior suite |
| 2 | Real facilitator configuration | **Done** — URL/credentials/timeout from env, never committed; `/supported` preflight at boot |
| 3 | Base Sepolia only, mainnet provably disabled | **Done** — 11-test lockout suite across five routes; one real gap found and closed |
| 4 | Test wallet documentation | **Done** — `docs/TESTNET_WALLETS.md`; no wallet provisioned (§4), no keys recorded |
| 5 | Independent 20-step E2E | **NOT EXECUTED** — no network route (§4) |
| 6 | Real negative network tests | **NOT EXECUTED** — no network route (§4) |
| 7 | Reconciliation worker | **Done** |
| 8 | Reconciliation persistence | **Done** — `settlement_reconciliations`, migration `0005` |
| 9 | Reconciliation idempotency | **Done** — 20 repeated passes produce one Payment, one Receipt, one usage event, no second settle |
| 10 | Deliberate uncertainty recovery test | **Done** — release-critical scenario, uncertainty produced genuinely |
| 11 | Opposite case: definitive failure only | **Done** — 4 tests, including "does not conclude failure while the authorization could still be used" |
| 12 | Reconciliation concurrency | **Done** — 20 concurrent workers against real PostgreSQL |
| 13 | Bounded retry with backoff | **Done** — 12 attempts, 30s doubling capped at 1h, then EXHAUSTED |
| 14 | Extended `/health/payments` | **Done** |
| 15 | Metrics | **Done** — reconciliation counters emitted |
| 16 | Alerting specification | **Done** — `docs/ALERTING.md`; **nothing is wired to a pager** |
| 17 | External security review scope | **Done** — `docs/EXTERNAL_SECURITY_REVIEW_SCOPE.md`; no review performed |
| 18 | Mainnet stays disabled, readiness updated honestly | **Done** |
| 19 | Full verification | **Done** (§5) |
| 20 | This report | **Done** |

Two of twenty were not executed, both for the same environmental reason.

---

## 4. What was not executed, and why

The primary goal of Phase 3.5 — a real client through Meter402 through an
independent facilitator to Base Sepolia and back — **was not achieved.**

This environment has no outbound route to any Base RPC endpoint or hosted
facilitator. Every host tested is refused at `CONNECT` by network policy, which
is a denial rather than a timeout or an upstream failure:

| Host | Result |
| --- | --- |
| `sepolia.base.org` | CONNECT refused |
| `base-sepolia.publicnode.com` | CONNECT refused |
| `base-sepolia-rpc.publicnode.com` | CONNECT refused |
| `rpc.ankr.com` | CONNECT refused |
| `endpoints.omniatech.io` | CONNECT refused |
| `x402.org` | CONNECT refused |
| `api.cdp.coinbase.com` | CONNECT refused |
| `facilitator.x402.rs` | CONNECT refused |

`registry.npmjs.org` is reachable, which is how the official `@x402/core` and
`@x402/evm` packages were installed. The block is on arbitrary egress.

**Consequences, stated so nothing here is mistaken for more than it is:**

- **No transaction hashes are recorded in this report, because there are none.**
  No settlement has occurred on any chain.
- No real facilitator has been contacted. x402 v2 conformance rests on encoding
  and decoding with the official libraries offline — real wire compatibility
  with that implementation, and nothing about a deployed facilitator's
  behaviour.
- `ViemSettlementOracle`, the component that actually reads
  `authorizationState` from a token contract, **has never been executed.** The
  reconciliation logic above it is thoroughly tested against a fake oracle. A
  wrong ABI, a refused log range, or an unexpected response shape would be
  invisible to every test reported here.
- No wallet was funded, because no faucet was reachable.

No substitute was accepted. Running the release gate against `FakeFacilitator`
would produce green output meaning nothing, and the brief forbids it.

---

## 5. Verification

All commands run at commit `82d502b`, against PostgreSQL 16 with the schema
migrated from an **empty database** (`meter402_p35`, created for this run).

| Check | Result |
| --- | --- |
| `drizzle-kit` migrations from empty | **Applied clean** |
| `turbo run typecheck` | **17/17 successful** |
| `turbo run lint` | **9/9 successful**, no warnings |
| `turbo run build` | **Successful** |
| `prettier --check` | **Clean** |
| `vitest run` | **38 files, 729 tests, 729 passed, 0 failed, 0 skipped** |

Suites most relevant to this phase:

| Suite | Tests |
| --- | --- |
| `reconciliation.integration.test.ts` | 10 |
| `mainnet-lockout.integration.test.ts` | 11 |
| `payments-health.integration.test.ts` | 6 |
| `settlement-oracle.test.ts` | 8 |
| `preflight.test.ts` | 7 |
| `x402-security.integration.test.ts` (incl. 20-way settle race) | 11 |

Every one of these runs offline against test doubles or local PostgreSQL. None
touches a chain.

---

## 6. Release-critical scenario

The Phase 3.5 brief names one test as release-critical: facilitator settles →
transaction exists → Meter402 never receives the response → uncertainty
recorded → worker runs → discovers the settlement → Payment CONFIRMED → exactly
one Receipt.

**It passes**, and the uncertainty is produced genuinely rather than staged: a
real x402 client signs a real authorization, the real payment gate runs, and
the facilitator reports the settle call as unreachable *after* recording that
it settled. That exercises the real enqueue path inside the real transaction. A
hand-written PENDING row would have tested the assertions and nothing else.

Verified in the same test: exactly one Payment, exactly one Receipt, exactly
one usage event, the reconciliation row resolved once, and **zero additional
facilitator settle calls**.

---

## 7. Defects found and fixed

**Settlement configuration accepted a disabled chain.** A merchant could store
a Base mainnet settlement destination while mainnet was disabled. Nothing would
have settled — payment-time checks refuse a disabled chain — but the stored
destination would go live the moment someone enabled mainnet for an unrelated
reason, with nobody re-reviewing it. Now refused at the write.

**A discarded rejection reason.** When reconciliation found an on-chain
settlement that `authorizePayment` then refused, the queue row said only
"authorization was not accepted". An operator reading that row about real money
learns nothing about whether to wait, re-run, or intervene. The reason is now
carried through.

**A `Date` interpolated into a raw SQL template.** `claimReconciliationJobs`
failed with an opaque "Failed query": a value interpolated into a Drizzle `sql`
template has no column behind it, so it never reaches the type mapper that
would serialise a `Date`. Fixed with an ISO string and an explicit
`::timestamptz` cast.

**Test fixtures sharing one transaction hash.** Not a product defect, but it
masked real behaviour for some time. The transaction-replay guard is
deliberately global, so fixed fake hashes passed on a clean database and failed
on every rerun against the same one. Fixtures now derive a distinct hash per
run and per authorization — which also matches the chain, where one
authorization is consumed by exactly one transfer.

---

## 8. Security properties preserved

No Phase 0–3 property was weakened. Specifically re-verified after this phase's
changes:

- **Exactly one economic settlement per authorization.** Not merely one Payment
  row. The 20-way concurrency test asserts one settle call, and reconciliation
  cannot add one because it never calls `/settle`.
- **Cross-tenant isolation.** 33 tenant-isolation and 58 RBAC tests pass
  unchanged.
- **Non-custodial settlement.** Meter402 holds no signing material. The
  reconciliation worker reads the chain; it cannot move funds.
- **No secrets in logs, audit events, or health responses.** The new health
  backlog is asserted to contain no address, hash, or resource identifier.
- **Uncertainty never becomes failure without evidence.**

---

## 9. Recommended next step

**Not Phase 4.** The single most important question about this system — does it
settle correctly on a real chain — is still unanswered, and every phase built
on top of an unanswered version of it inherits the risk.

The next action is an environment with network egress, a funded Base Sepolia
wallet, and a facilitator account, followed by the 20-step end-to-end scenario
and a real run of `ViemSettlementOracle` against the real USDC contract. Expect
it to find something; it always does.
