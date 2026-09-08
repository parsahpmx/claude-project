# VYRA SCALPER ENGINE — Architecture

**Status:** living document. Version 0.1 (Phase 1).
**Scope:** research, backtesting, paper trading, shadow trading and live execution for
short-horizon systematic strategies across CME futures, US equities and broker CFD/FX.

---

## 1. What this system is for

VYRA exists to answer one question objectively:

> Does a strategy retain positive expectancy **after** commissions, spread, slippage,
> latency, market impact, rejected orders and partial fills?

Every architectural decision below is subordinate to that question. The system is *not*
optimised for maximum historical return. It is optimised so that a measured result is
**believable**: reproducible, free of look-ahead, and costed honestly.

A corollary that shapes the code: **the backtester and the live trader run the same
strategy, feature, risk and execution objects.** There is no "backtest version" of a
strategy. Only the `BrokerAdapter` and the event source differ between modes.

---

## 2. Execution modes

| Mode | Data source | Broker adapter | Orders leave the process? |
|---|---|---|---|
| `BACKTEST` | historical files | `SimulatedBrokerAdapter` | no |
| `PAPER` | live feed | `PaperBrokerAdapter` | no |
| `SHADOW` | live feed | `PaperBrokerAdapter` + live-shadow recorder | no (recorded as *would have been*) |
| `LIVE` | live feed | `IBKRAdapter` / `MetaTrader5Adapter` / `OandaAdapter` | yes |

`SHADOW` is deliberately distinct from `PAPER`: it builds the **real production order
objects** — same ids, same routing decisions, same risk verdicts — and stops them at the
adapter boundary, recording the counterfactual. It is the last gate before capital.

---

## 3. The pipeline

The mandated flow is enforced structurally, not by convention:

```
                        ┌───────────────────────────────────────────────┐
   feed / files ──▶ MarketDataGateway ──▶ EventBus ──▶ BarEngine ──▶ FeatureEngine
                        (normalise,        (ordered,      (closed       (incremental,
                         latency stamp,     typed)         bars only)    causal only)
                         staleness gate)                        │
                                                                ▼
                                                        MarketRegimeEngine
                                                                │
                                                                ▼
                                                          BaseStrategy
                                                                │  Signal (no size)
                                                                ▼
                                                          RiskEngine ◀── KillSwitch
                                                                │  APPROVE / REDUCE
                                                                │  REJECT / HALT
                                                                ▼
                                                          OrderManager
                                                        (idempotency, state)
                                                                │
                                                                ▼
                                                         ExecutionEngine
                                                     (order type, retries, TIF)
                                                                │
                                                                ▼
                                                          BrokerAdapter
                                                                │  Fill / Reject / Ack
                                                                ▼
                                                            Portfolio ──▶ Analytics
```

**Invariants enforced in code:**

1. A `Strategy` has no reference to a broker, an order manager or a portfolio mutator.
   It receives events and returns `Signal` objects. `tests/risk/test_no_bypass.py`
   asserts this by inspecting the strategy module namespace.
2. A `Signal` carries **no position size**. Sizing is computed exclusively by
   `core.risk.sizing` inside the `RiskEngine`. The `Signal` dataclass has no `quantity`
   field, so a strategy cannot express one.
3. Nothing reaches a `BrokerAdapter` without a `RiskDecision` attached to the order.
   `OrderManager.submit()` requires a `RiskDecision` argument whose `action` is
   `APPROVE` or `REDUCE`.
4. The `KillSwitch` is consulted by the `RiskEngine` on **every** decision and by the
   `ExecutionEngine` before **every** submission. A tripped switch cannot be cleared by
   any automated path — only `KillSwitch.reset(operator, reason)`.

---

## 4. Repository layout

The layout in the task specification is followed literally. Top-level directories are
importable Python packages (`core`, `brokers`, `data`, `apps`); this is an application
monorepo, not a published library, so generic names are acceptable and are pinned by
`[tool.pytest.ini_options] pythonpath = ["."]` and the `pyproject.toml` package list.

```
vyra-scalper/
  apps/         api/ dashboard/ trader/ worker/     process entry points
  core/         the engine — see §5
  brokers/      concrete venue adapters (ibkr, mt5, oanda, paper)
  data/         collectors/ normalization/ storage/
  infra/        docker/ monitoring/ deployment/
  tests/        unit/ integration/ strategies/ risk/ execution/ backtest/ failure/
  configs/      markets.yaml risk.yaml strategies.yaml brokers.yaml sessions.yaml
                execution.yaml backtest.yaml
  scripts/      operational and research entry points
  docs/         specifications and runbooks
```

`core/` sub-packages:

| Package | Responsibility |
|---|---|
| `core.util` | time (UTC ns), ids, structured logging, numeric helpers |
| `core.config` | typed config loading, schema validation, content hashing/versioning |
| `core.events` | the event algebra — every message that crosses a boundary |
| `core.instruments` | instrument definitions, contract specs, sessions, calendars, symbol mapping, continuous contracts |
| `core.market_data` | normalisation, staleness gate, latency accounting, bar engine, order book engine |
| `core.features` | incremental feature computation |
| `core.signals` | signal model and the confidence engine |
| `core.strategies` | `BaseStrategy` and concrete strategies |
| `core.risk` | limits, sizing, risk engine, kill switch |
| `core.execution` | order manager, execution engine, cost and fill models |
| `core.portfolio` | positions, cash, PnL accounting, reconciliation |
| `core.brokers` | the `BrokerAdapter` interface and simulated/paper implementations |
| `core.backtest` | event-driven backtest driver, data sources, reproducibility manifest |
| `core.analytics` | trade ledger, equity curve, performance metrics |
| `core.ml` | feature datasets, time-series CV, models (later phase) |
| `core.ai` | LLM trading analyst, strictly out of the execution path (later phase) |

---

## 5. Cross-cutting decisions

### 5.1 Time

* **All internal time is integer nanoseconds since the Unix epoch, UTC.** No naive
  `datetime` ever enters the engine. `core.util.clock` converts at the edges.
* Integers avoid float drift in latency arithmetic and give exact event ordering.
* Exchange-local time exists only for **session and calendar logic**, resolved via
  `zoneinfo` from the instrument's exchange timezone. DST is therefore handled by the
  IANA database, not by fixed offsets.
* Every market event carries three stamps: `ts_exchange`, `ts_receive`, `ts_processed`.
  Their differences are the latency metrics in §5.4.

### 5.2 Numbers

* Prices, sizes and PnL are `float` (IEEE-754 double). This is the standard choice for a
  tick-driven engine; `Decimal` in the hot path costs ~50× and buys nothing at the
  magnitudes involved.
* The risk of float drift is contained explicitly rather than ignored:
  * prices are quantised to the instrument tick with `round_to_tick`, which scales to
    integers before rounding, so a price never lands between ticks;
  * money is rounded with `round_money` at every accounting boundary;
  * quantities are quantised to the instrument's `qty_step`.
* Tests assert tick/lot conformance rather than exact float equality.

### 5.3 Event ordering and determinism

* The backtest event loop is a **single-threaded priority queue** keyed by
  `(ts_processed, sequence_id)`. Given the same inputs, seeds and configuration, the
  event order — and therefore the result — is bit-identical.
* Every event gets a monotonically increasing `sequence_id` from a per-run counter, so
  ties never resolve arbitrarily.
* Live mode uses the same loop with a real-time source; the ordering key is unchanged.

### 5.4 Latency accounting

Four measured intervals, recorded on every event and every order:

| Metric | Definition |
|---|---|
| `exchange_to_receive_latency` | `ts_receive - ts_exchange` — wire + venue |
| `receive_to_process_latency`  | `ts_processed - ts_receive` — our own queueing |
| `end_to_end_latency`          | `ts_processed - ts_exchange` |
| `signal_to_fill_latency`      | `ts_fill - ts_signal` on the order record |

In backtest these are *injected* by a configured `LatencyModel`, not assumed to be zero.
A strategy that only works with zero latency fails visibly.

### 5.5 Failure posture

* No bare `except:`. No silently swallowed exceptions. Every handler either recovers with
  a logged reason code or re-raises.
* Data is never silently repaired. Missing ticks are **not** interpolated; gaps are
  recorded as `DataGap` and surfaced to analytics.
* Stale or out-of-order market data flags the instrument; sustained staleness trips the
  kill switch rather than trading on a stale book.
* "Unknown position appears" and "reconciliation failure" are kill-switch triggers, not
  warnings.

### 5.6 Configuration

* Every threshold lives in `configs/*.yaml`. Strategy source files contain no numeric
  trading constants; `tests/unit/test_no_magic_numbers.py` scans strategy modules for
  bare numeric literals outside of a small allowlist.
* A loaded config is hashed (SHA-256 over canonical JSON) and the hash is written into
  every backtest manifest and every live session record. A result can always be traced
  back to the exact parameters that produced it.

---

## 6. Data integrity gates

Trading is blocked, per instrument, when any of the following holds:

| Gate | Default |
|---|---|
| quote age exceeds `max_quote_age_ms` | 2 000 ms |
| sequence gap detected on a sequenced feed | block until resync |
| crossed book (`bid >= ask`) persisting beyond `max_crossed_ms` | 250 ms |
| spread exceeds `max_spread_ticks` | per-instrument |
| bar engine reports an unexplained session gap | block until session event |

These gates live in `core.market_data.integrity` and are evaluated **before** the feature
engine, so a degraded feed cannot pollute feature state.

---

## 7. Storage

| Store | Use |
|---|---|
| PostgreSQL + TimescaleDB | quotes, trades, bars, orderbook snapshots, features, signals, orders, fills, positions, risk events, runs |
| Redis | live shared state: latest quote per instrument, kill-switch state, risk counters, session locks |
| Parquet | immutable research datasets, partitioned `instrument/date` |
| ClickHouse (optional) | very large tick archives |

Execution audit rows (`orders`, `fills`, `risk_events`, `system_events`) are
**append-only**: no `UPDATE`, no `DELETE`. Corrections are new rows with a
`supersedes_id`. Phase 1 writes Parquet/JSONL; the SQL schema lands with the API phase.

---

## 8. Observability

Structured JSON logs (`core.util.logging`) with a stable field set:
`ts, level, component, event, instrument, strategy_id, run_id, correlation_id, reason_codes, …`.
Prometheus metrics and OpenTelemetry spans are added in the observability phase; the log
schema is designed so those exporters need no code changes in the engine.

---

## 8b. The service boundary

`apps/api` and `apps/dashboard` sit outside the engine and depend on it in one direction
only: applications import `core`, and `core` never imports an application. A strategy that
imported the API would make the engine unable to run without a web server.

The API is **read-mostly**. It renders what the engine decided and exposes exactly two
commands — trip the kill switch and clear it. There is deliberately no endpoint that starts
a backtest, submits an order or changes a risk limit: an API that could mutate risk state
would be a second path into the risk engine, and §9's rule that a model may never raise a
limit means nothing if an HTTP request can.

The same reasoning shapes what the dashboard renders. It computes no trading figure and
holds no trading state; every number on a screen came from an engine artefact. Where the
engine has nothing — no live feed, no open positions, no trained model — the page says so
instead of substituting a plausible value.

Three properties hold at the HTTP boundary regardless of the caller:

| Property | How it is enforced |
|---|---|
| No response can carry a broker credential | Whole connection blocks and credential-shaped fields are removed before a config response is built; a test walks every GET endpoint in the OpenAPI document with sentinel credentials injected through the config's own `${VAR}` interpolation |
| Only `/health` is reachable without a token | Every other route depends on a role check; the same endpoint walk asserts a 401 without one |
| A kill-switch reset is attributable | The operator recorded in the audit trail comes from the authenticated token, never from the request body |

The API owns no *second* kill switch. Today it constructs one and persists it outside the
runs directory, so a halt survives a restart of the service and the runs directory can be
mounted read-only. When the live trader exists it will pass in the same object the risk
engine holds — two switches would mean one of them is advisory.

---

## 9. What is deliberately *not* in the hot path

* The LLM analyst (`core.ai`). It reads completed sessions and writes reports. It has no
  write access to configuration or risk state. Its recommendations enter production only
  through: proposal → backtest → validation → human approval → deployment.
* Any ML model output is an *input to* the risk engine, never a bypass of it. A model may
  reduce or veto a trade; it can never raise a limit.

---

## 10. Phase 1 boundary

Implemented in Phase 1 (this milestone): `core.util`, `core.config`, `core.events`,
`core.instruments`, `core.market_data` (normalisation, staleness, bar engine),
`core.features` (subset used by the first strategy), `core.signals`, `core.strategies`
(base + VWAP mean reversion), `core.risk` (limits, sizing, engine, kill switch),
`core.execution` (costs, fill models, order manager, execution engine),
`core.portfolio`, `core.brokers` (interface + simulated + paper), `core.backtest`,
`core.analytics`, and the synthetic/CSV data collectors.

Everything else is tracked in `ROADMAP.md` with explicit acceptance criteria. Nothing is
claimed as working that is not covered by a passing test.
