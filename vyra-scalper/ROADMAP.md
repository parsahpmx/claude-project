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
| 4 | Historical data ingestion + normalisation | DONE — synthetic, CSV and Parquet sources, with an ingestion pipeline and dataset manifests |
| 5 | Bar engine (1s → 1d, look-ahead safe) | DONE |
| 6 | Event-driven backtest engine | DONE |
| 7 | Transaction-cost modelling (commission, spread, slippage, latency, fills) | DONE |
| 8 | `BaseStrategy` interface | DONE |
| 9 | `VWAPMeanReversionStrategy` | DONE |
| 10 | Performance metrics, trade ledger, equity curve | DONE |
| 11 | Risk engine (limits, sizing, decisions, kill switch) | DONE |
| 12 | Simulated broker + shared adapter contract suite | DONE |
| 12b | Deterministic market regime engine (brought forward from Phase 3) | DONE |

**Acceptance (= MVP criteria §33):** ingest → normalise → bars → event-driven backtest →
≥1 strategy → spread + commission + slippage modelled → risk-based sizing → max daily
loss → kill switch → equity curve → trade ledger → metrics → byte-identical
reproduction from a config file → `pytest` green.

---

### Phase 1 outcome

The MVP acceptance criteria are met and covered by `tests/backtest/test_mvp_acceptance.py`.
The reference run on the shipped configuration is a **losing** one after costs, and the
platform reports it as such — which is the behaviour being tested. Two findings from
building it are recorded here because they shaped the code:

* The exposure limits were originally calibrated as if for equities. A 100 %-of-equity
  notional cap throttles any futures position long before `max_risk_per_trade_pct` binds,
  silently disabling the real loss control while looking conservative. Recalibrated, with
  the reasoning in `RISK_SPEC.md` §3.2.
* The synthetic generator initially mean-reverted to a *fixed* anchor. A VWAP
  mean-reversion strategy harvested that perfectly: 90 trades, 90 wins, Sharpe 40. The
  anchor now drifts, and `PerformanceReport.implausibility_warnings` flags result shapes
  (no losing trades, implausible win rate or Sharpe, too few trades) that are far more
  often a bug than an edge.

## Phase 2 — Live plumbing

| # | Item | Status | Acceptance |
|---|---|---|---|
| 13 | Live market-data gateway | DONE | reconnect, resequence, gap detection and monotonicity under chaos tests |
| 14 | Broker adapters: IBKR, MT5, OANDA | PLANNED | must pass `tests/execution/test_adapter_contract.py`, which simulated, paper and shadow already do |
| 15 | Execution engine hardening: retries, timeouts, cancel/replace | DONE | duplicate-submit, timeout and capability-negotiation tests |
| 16 | Position reconciliation | DONE | every divergence class trips the kill switch; the backtest reconciles clean throughout |
| 17 | Paper and shadow adapters | DONE | both pass the shared contract suite; shadow records the counterfactual and never fills |
| 17b | Paper trading session end to end | PLANNED | needs a live transport (item 13's `FeedTransport`) — 1 session, no manual intervention |

## Phase 3 — Strategy breadth and validation

| # | Item | Status |
|---|---|---|
| 18 | Momentum breakout, liquidity sweep, trend pullback, order-flow imbalance, opening-range breakout, microstructure scalper | DONE — implemented and tested; **none validated, so none promoted** |
| 18b | Order book engine (imbalance, delta, absorption, liquidity walls, CFD namespace boundary) | DONE |
| 19 | Walk-forward, Monte Carlo, parameter-sensitivity, cost stress, promotion gate | DONE |

Promotion gate: implemented in `core.validation.promotion` and run by
`scripts/validate_strategy.py`, which exits non-zero when a strategy is not approved so the
gate is usable from CI. A strategy is promoted only on a **parameter plateau** that
survives out-of-sample, walk-forward and a cost stress. Highest-PnL single parameter set is
explicitly not a promotion criterion, and **missing evidence counts as a failure** — an
unmeasured risk is not an absent one.

No strategy has been submitted to the gate on real data, so **none is promoted**.

## Phase 4 — Interfaces

| # | Item | Status |
|---|---|---|
| 20 | FastAPI service (health, markets, strategies, signals, positions, orders, performance, risk, backtests, kill switch) with auth + RBAC | DONE — 22 endpoints, JWT + four-role hierarchy; `/health` is the only unauthenticated one |
| 20b | Next.js/TypeScript dashboard | DONE — 13 pages, kill switch on every screen; driven end to end in a browser against a live API |
| 26 | Prometheus, Grafana, OpenTelemetry | PLANNED — the structured log schema is designed so exporters need no engine change |
| 27 | Docker Compose environments, GitHub Actions, secret management | IN PROGRESS | image, compose stack and CI exist; per-environment overlays and secret manager do not |

The API is **read-mostly by design**. It serves what the engine decided and exposes exactly
two commands: trip the kill switch, and clear it. There is no endpoint that starts a
backtest, places an order or changes a risk limit — an API that could mutate risk state
would be a second path into the risk engine, and the platform's central guarantee is that
there is only one.

Three properties are enforced by tests rather than by review:

* **No endpoint can return a broker credential.** The test injects sentinel credentials
  through the same environment variables `configs/brokers.yaml` interpolates, then walks
  every GET endpoint the OpenAPI document declares and asserts none of them appears. A new
  endpoint is covered the day it is added.
* **`/health` is the only unauthenticated endpoint**, and it exposes no position, PnL or
  credential — a load balancer cannot hold a token, and that is the whole reason it is open.
* **Clearing the kill switch records the operator from the token, never from the request
  body.** A caller cannot attribute a resume to somebody else.

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

* Broker adapters are the interface plus simulated, paper and shadow implementations.
  IBKR, MT5 and OANDA are declared in `configs/brokers.yaml` with their symbol maps and
  capabilities, but the adapter classes are **not written**. No live venue connectivity
  exists.
* The market-data gateway is transport-agnostic and fully tested against a fake feed. No
  concrete `FeedTransport` exists, so nothing connects to a real venue yet — that
  implementation is the only part the gateway's tests do not cover, by design.
* All seven strategies are implemented and tested, and **all seven are disabled**. Each
  is a hypothesis with a test suite, not a validated edge: without the validation pipeline
  (item 19) none can be promoted, so none runs. Two of them
  (`order_flow_imbalance`, `microstructure_scalper`) additionally need a depth feed that
  no live transport yet provides.
* The order book engine is implemented, with the CFD boundary enforced by namespacing:
  exchange features are `exch.*`, broker CFD features are `cfd.*`, and requesting the
  wrong namespace for an instrument raises. No live depth feed exists to drive it.
* The Parquet normalised layer is built: `scripts/ingest_data.py` reads a CSV or synthetic
  source, validates it, records rejections and gaps, writes partitioned Parquet and stamps
  a manifest whose content hash the run manifest references. All three source kinds
  (`SYNTHETIC`, `CSV`, `PARQUET`) are wired into the runner.
* The dashboard shows no price and no position, because the engine has neither: there is no
  live feed and no live trader. The Positions, ML Models and AI Analysis pages say so
  explicitly rather than rendering placeholder figures — a screen of plausible numbers for
  an unbuilt subsystem eventually gets read as real.
* API accounts come from `VYRA_API_USERS` in the environment, compared in constant time but
  stored as given. That is an operator list supplied by a secret manager, not a user store:
  hashed credentials, rotation and lockout belong with the persistence layer and are not
  built. It is adequate for a small operator group and is not adequate for more.
* Run artefacts are still JSONL. PostgreSQL/TimescaleDB and Redis are specified in
  `DATA_SPEC.md` §8 but not built — they matter for live operation, not for research.
* The validation pipeline exists and runs, but no strategy has passed it. On the shipped
  synthetic dataset the reference strategy is rejected on five criteria — which is the gate
  working, not a defect. Promotion requires real market data, which this environment has
  no licence for.
* Latency stress is not implemented as a separate stage: cost stress is analytic over the
  realised ledger, whereas a latency stress needs a full re-run per multiple. The
  `LatencyModel` supports it; the pipeline stage does not exist yet.
* Market impact is modelled as a square-root function of participation; it is a model,
  not a measurement, and is flagged as such in every report.
* No production data feed licence is assumed. Phase 1 ships a deterministic synthetic
  generator plus CSV loaders so the pipeline is testable without vendor data.
