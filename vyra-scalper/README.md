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
| [`docs/PHASE_1_REPORT.md`](docs/PHASE_1_REPORT.md) | what building the engine turned up |
| [`docs/PHASE_4_REPORT.md`](docs/PHASE_4_REPORT.md) | what building the data layer, API and console turned up |
| [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) | what is exported, and what should page |
| [`docs/PROMOTION.md`](docs/PROMOTION.md) | the bar a strategy clears before it trades real money |

## Quick start

```bash
pip install -e ".[dev,data,api]"
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

## Running the API and the console

```bash
export VYRA_API_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
export VYRA_API_USERS="you:$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))'):OPERATOR"
python3 -m uvicorn apps.api.main:app --port 8000        # http://localhost:8000/docs

cd apps/dashboard && npm install && npm run dev          # http://localhost:3000
```

There is no default account and no default signing secret; the API refuses to start without
both. See [`apps/dashboard/README.md`](apps/dashboard/README.md) for what the console does
and does not show.

## Status

Built and tested: the engine and MVP backtest (covered by
`tests/backtest/test_mvp_acceptance.py`), reconciliation and the paper and shadow adapters,
the order book engine and all seven strategies, the validation pipeline and promotion gate,
the Parquet normalised data layer, the API and the operator console.

Not built yet, explicitly: live broker adapters (IBKR, MT5, OANDA) and the feed transport
they need, the SQL and Redis storage layers, metrics export, and the ML and AI components.

**No strategy is promoted.** All seven are implemented, tested and disabled: each is a
hypothesis with a test suite, not a validated edge. The validation pipeline exists and runs,
and on the shipped synthetic dataset it rejects the reference strategy on five criteria —
that is the gate working. Promotion needs real market data, which this environment has no
licence for. No capital is deployed until paper and shadow modes are operational.
`ROADMAP.md` tracks each item with its acceptance criteria.
