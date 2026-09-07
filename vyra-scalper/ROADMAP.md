# VYRA SCALPER ENGINE — Roadmap

Phases follow the mandated development order. A phase is **DONE** only when its
acceptance criteria are covered by passing automated tests. Anything not tested is
`PLANNED`, regardless of how much code exists.

Legend: `DONE` · `IN PROGRESS` · `PLANNED`

---

## Phase 1 — Foundation and MVP backtest

| # | Item | Status |
|---|---|---|
| 1 | Repository, packaging, dev environment, CI | DONE |
| 2 | Event models (`core.events`) | DONE |
| 3 | Instrument model, sessions, calendars, symbol mapper, continuous contracts | DONE |
| 4 | Historical data ingestion (synthetic generator, CSV, Parquet) + normalisation | DONE |
| 5 | Bar engine (1s → 1d, look-ahead safe) | DONE |
| 6 | Event-driven backtest engine | DONE |
| 7 | Transaction-cost modelling (commission, spread, slippage, latency, fills) | DONE |
| 8 | `BaseStrategy` interface | DONE |
| 9 | `VWAPMeanReversionStrategy` | DONE |
| 10 | Performance metrics, trade ledger, equity curve | DONE |
| 11 | Risk engine (limits, sizing, decisions, kill switch) | DONE |
| 12 | Paper broker + simulated broker | DONE |

**Acceptance (= MVP criteria §33):** ingest → normalise → bars → event-driven backtest →
≥1 strategy → spread + commission + slippage modelled → risk-based sizing → max daily
loss → kill switch → equity curve → trade ledger → metrics → byte-identical
reproduction from a config file → `pytest` green.

---

## Phase 2 — Live plumbing

| # | Item | Status | Acceptance |
|---|---|---|---|
| 13 | Live market-data adapter | PLANNED | reconnect, resequence, gap detection under a chaos test |
| 14 | Broker adapters: IBKR, MT5, OANDA | PLANNED | contract tests every adapter must pass |
| 15 | Execution engine hardening: retries, timeouts, cancel/replace | IN PROGRESS | duplicate-submit and timeout tests |
| 16 | Position reconciliation | PLANNED | injected divergence trips the kill switch |
| 17 | Paper trading end to end | PLANNED | 1 session, no manual intervention, ledger matches sim |

## Phase 3 — Strategy breadth and validation

| # | Item | Status |
|---|---|---|
| 18 | Momentum breakout, liquidity sweep, trend pullback, order-flow imbalance, opening-range breakout, microstructure scalper | PLANNED |
| 18b | Order book engine (imbalance, delta, absorption, liquidity walls) | PLANNED |
| 18c | Market regime engine (deterministic) | PLANNED |
| 19 | Walk-forward, Monte Carlo, parameter-sensitivity, cost/latency stress | PLANNED |

Promotion gate: a strategy is promoted only on a **parameter plateau** that survives
out-of-sample, walk-forward and a 2× transaction-cost stress. Highest-PnL single
parameter set is explicitly not a promotion criterion.

## Phase 4 — Interfaces

| # | Item | Status |
|---|---|---|
| 20 | FastAPI service (health, markets, strategies, signals, positions, orders, performance, risk, backtests, kill switch) with auth + RBAC | PLANNED |
| 20b | Next.js/TypeScript dashboard | PLANNED |
| 26 | Prometheus, Grafana, OpenTelemetry | PLANNED |
| 27 | Docker Compose environments, GitHub Actions, secret management | IN PROGRESS |

## Phase 5 — Intelligence

| # | Item | Status |
|---|---|---|
| 21 | ML regime classifier (LR → RF → LightGBM/XGBoost/CatBoost) with time-series CV and leakage tests | PLANNED |
| 22 | Strategy selector with conservative smoothing | PLANNED |
| 23 | LLM trading analyst (reports only, no production writes) | PLANNED |

## Phase 6 — Deployment

| # | Item | Status |
|---|---|---|
| 24 | Shadow trading | PLANNED |
| 25 | Controlled production deployment | PLANNED |

Capital is not deployed until Phases 2, 3, 4 and 24 are all DONE.

---

## Known gaps (explicit, not hidden)

* Broker adapters are interface + simulated only. No live venue connectivity yet.
* Order book engine is specified but unimplemented; CFD depth is *not* to be conflated
  with exchange depth when it lands (see `DATA_SPEC.md` §6).
* Market impact is modelled as a square-root function of participation; it is a model,
  not a measurement, and is flagged as such in every report.
* No production data feed licence is assumed. Phase 1 ships a deterministic synthetic
  generator plus CSV/Parquet loaders so the pipeline is testable without vendor data.
