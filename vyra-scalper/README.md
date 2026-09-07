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

## Status

Phase 1 (foundation and MVP backtest). See `ROADMAP.md` for what is DONE, IN PROGRESS and
PLANNED. No live broker connectivity exists yet; capital is not deployed until paper and
shadow modes are operational.
