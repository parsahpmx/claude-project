# VYRA SCALPER ENGINE

A multi-market algorithmic trading platform for short-horizon systematic strategies on
CME futures, US equities and broker CFD/FX.

**The platform makes no claim about profitability.** It exists to answer one question
objectively: does a strategy retain positive expectancy *after* commissions, spread,
slippage, latency, market impact, rejected orders and partial fills?

## Documents

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | components, pipeline, cross-cutting decisions |
| [`ROADMAP.md`](ROADMAP.md) | phases, status, and the gaps that are not yet built |
| [`RISK_SPEC.md`](RISK_SPEC.md) | limits, sizing, decisions, kill switch |
| [`DATA_SPEC.md`](DATA_SPEC.md) | event schema, validation, bars, sessions, contracts |
| [`BACKTEST_SPEC.md`](BACKTEST_SPEC.md) | event loop, bias prevention, costs, fills, validation |
| [`EXECUTION_SPEC.md`](EXECUTION_SPEC.md) | order lifecycle, idempotency, reconciliation, quality |

## Quick start

```bash
pip install -e ".[dev,data]"
make test
```

## Layout

```
apps/      api dashboard trader worker      process entry points
core/      the engine (stdlib + PyYAML only)
brokers/   venue adapters
data/      collectors, normalisation, storage
infra/     docker, monitoring, deployment
configs/   every trading parameter — none are hardcoded in strategy source
tests/     unit, integration, strategy, risk, execution, backtest, failure
```

## Principles

* The backtester runs the **same** strategy, risk and execution objects as live trading.
  Only the event source and the broker adapter differ.
* A `Signal` carries no position size. Sizing belongs to the Risk Engine, which has
  absolute authority and cannot be bypassed by a strategy, a model, or an LLM.
* Data is never silently repaired: no interpolated ticks, no phantom bars, no forward
  fills. Gaps are recorded and reported.
* Nothing is claimed as working unless a test covers it. `ROADMAP.md` lists what is not
  built yet, explicitly.

## Running a backtest

```bash
python scripts/run_backtest.py                 # reference run from configs/
python scripts/replay_run.py runs/<id>/manifest.json   # verify it reproduces
```

The reference run uses a seeded synthetic generator so the pipeline is testable without
vendor data. Its report is watermarked `SYNTHETIC` and supports no claim about expectancy.

## Status

Phase 1 (foundation and MVP backtest) is complete and covered by
`tests/backtest/test_mvp_acceptance.py`.

Not built yet, explicitly: live broker adapters, the order book engine, six of the seven
strategies, the SQL/Redis/Parquet storage layers, the API and dashboard, the ML and AI
components, and the validation pipeline. Because the validation pipeline does not exist,
**no strategy can be promoted**, and no capital is deployed until paper and shadow modes
are operational. `ROADMAP.md` tracks each item with its acceptance criteria.
