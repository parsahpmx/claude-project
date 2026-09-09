# Repository guide

Two independent projects live here. They share no code and no build.

| Path | Project | Language | Detailed status |
|---|---|---|---|
| `/` (root) | **Meter402** — machine-native payments for APIs and MCP servers | TypeScript, pnpm + turbo | `docs/ROADMAP.md`, `docs/LAUNCH_READINESS.md` |
| `vyra-scalper/` | **VYRA Scalper Engine** — multi-market algorithmic trading platform | Python 3.11 | `vyra-scalper/ROADMAP.md` |

**This file is the status board.** It records what is built and what is next.
Per-item detail belongs in each project's own ROADMAP — do not duplicate it here,
or the two will drift and the wrong one will be believed.

---

## Shared engineering rules

Both projects were built to the same standard, and it is the reason their status
sections read the way they do:

- **Nothing is claimed as working unless a test covers it.** Where something is
  unverified, the docs say so in the same sentence that describes it.
- **Missing evidence is a failure, not a neutral.** An unmeasured risk is not an
  absent one.
- **Distinguish "verified" from "assumed" in every report.** "Tests pass" is not
  a result; the numbers are.
- A green gate (tests, lint, types) is the entry ticket, not the finish line.
  Verify against a running system — a live process, a real browser, a real
  database — before calling anything done.

---

## Status board

### VYRA Scalper Engine — `vyra-scalper/`

**Gate, verified 2026-09-08:** 988 passed, 4 skipped; `ruff` and `mypy --strict`
clean over 125 source files; console typechecks and builds.

**Built and verified:** engine core and MVP backtest · reconciliation · paper and
shadow adapters · order book engine and all 7 strategies · validation pipeline and
promotion gate · Parquet data layer with content-hashed manifests · FastAPI service
(22 endpoints, JWT + 4 roles) and Next.js operator console (13 pages) ·
kill-switch guard at the venue boundary · WebSocket feed transport · shared halt
state in PostgreSQL propagated through Redis · Prometheus metrics · ML research
pipeline · strategy promotion mechanism.

**Facts that must not be softened when summarising this project:**
- **No strategy is promoted.** All seven are implemented, tested and disabled.
- **No live trading, ever, in this repository.** No live feed and no live trader.
- The **OANDA adapter has never spoken to OANDA** — verified only against the
  documented v20 wire format on a local server. Disabled by default.
- The ML model reports **AT_CHANCE** on the shipped synthetic dataset (OOS AUC
  0.544 against a 0.55 bar). That is the expected result and is not to be tuned away.
- Losing Redis **halts trading** by design. See `ROADMAP.md` for the reasoning;
  `require_cache=False` is the documented opt-out.

**Next, roughly in order:** IBKR and MT5 adapters (blocked: no vendor SDK or
credentials here) · a real venue feed transport · a paper-trading session end to
end · Grafana dashboards, OTel traces and paging · tree-based ML models, only
after a linear model has been shown to be the limitation.

### Meter402 — repository root

**Status as recorded in its own docs (not re-verified in recent sessions):**
Phases 0–4 complete — payment domain core, identity and tenancy, billing objects,
x402 v2 with EIP-3009 signed authorizations, settlement reconciliation, and the
developer platform (SDK, CLI, agent client, MCP tools, examples). 921 tests.

**Facts that must not be softened when summarising this project:**
- **No payment has ever settled on a real chain.** Settlement runs against a test
  double; the environment has no testnet RPC or facilitator access.
- Meter402 **does not claim x402 compatibility**. The accurate claim is
  "wire-conformant against the official reference library, pending facilitator and
  testnet verification".
- **Base mainnet is disabled** behind two independent configuration gates and is
  NOT READY (`docs/MAINNET_READINESS.md`).
- No dashboard (needs production human auth), no webhooks (the SSRF gate is open,
  and it is a hard release gate — threat T8).

**Next, in the order its own docs give:** an environment with network egress and a
funded Base Sepolia wallet, then the real end-to-end scenario · staging deploy ·
a production identity provider · external security review · alerting and a tested
backup restore. Phases 5–8 (MCP, operational platform, hardening, design partners)
follow.

---

## Commands

### VYRA — from `vyra-scalper/`

```bash
make install      # pip install -e ".[dev,data,api,storage,ml]"
make test         # pytest
make lint         # ruff check core brokers data apps tests scripts
make typecheck    # mypy --strict
make backtest     # the reference MVP run
make api          # uvicorn, needs VYRA_API_SECRET and VYRA_API_USERS
make dashboard    # cd apps/dashboard && npm run dev
```

The storage suite (`tests/storage`) **skips itself** without a real PostgreSQL and
Redis. That silence is the failure mode to watch for — set `VYRA_TEST_PG_DSN` and
`VYRA_TEST_REDIS_URL`, and check the run reports passes rather than skips. CI does
exactly that check.

### Meter402 — from the root

```bash
pnpm install      # node_modules is not checked in
pnpm test         # turbo run test
pnpm typecheck
pnpm lint
```

CI: `.github/workflows/ci.yml` (Meter402) and `.github/workflows/vyra-ci.yml` (VYRA).

---

## Keeping this file current

Update this file **in the same commit as the work it describes**, not afterwards.
A status board updated later is a status board that was wrong in between.

When finishing a piece of work:

1. Move the item from "Next" to "Built" in the relevant status section — but only
   if it is verified against a running system, not merely written and green.
2. Update the gate line with the **actual numbers** from the run you did.
3. Add a line to the log below.
4. Update the project's own `ROADMAP.md` with the detail. This file stays a summary.
5. If you found a defect, record it in the project's implementation report
   (`vyra-scalper/docs/PHASE_*.md`, `docs/PHASE_*_NOTE.md`) — those files exist
   because a defect that only produced a plausible wrong answer is worth writing down.

If a "fact that must not be softened" ever stops being true — a strategy is
promoted, a payment settles on-chain — that is a significant event. Change the
line, say so explicitly in the reply, and do not let it disappear quietly into a
list of completed work.

---

## Change log

Newest first. Keep it to the last ~10 entries; `git log` holds the rest.

| Date | Project | What changed |
|---|---|---|
| 2026-09-08 | VYRA | Items 3–7: venue-boundary kill-switch guard, WebSocket feed transport, OANDA adapter (venue-unverified), PostgreSQL/Redis shared halt state, Prometheus metrics, ML pipeline, promotion mechanism. `4fd734f`…`4d066df` |
| 2026-09-08 | VYRA | Parquet data layer, FastAPI service and Next.js operator console. `a1fb342`, `469dfed` |
| earlier | VYRA | Phases 1–3: engine, MVP backtest, reconciliation, paper/shadow adapters, order book, 7 strategies, validation pipeline. `fc12ed5`…`521049d` |
| earlier | Meter402 | Phases 0–4 complete per `docs/ROADMAP.md`. Not re-verified since. |
