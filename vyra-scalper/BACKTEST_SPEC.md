# VYRA — Backtest Specification

---

## 1. Rule zero

**The backtester runs the production objects.** `BacktestEngine` instantiates the same
`BaseStrategy`, `FeatureEngine`, `RiskEngine`, `OrderManager` and `ExecutionEngine`
classes that the live trader uses. Only two things are substituted:

* the event source (files instead of a feed), and
* the `BrokerAdapter` (`SimulatedBrokerAdapter` instead of a venue).

If a behaviour differs between backtest and live, that is a bug in the substitution
boundary, not a "backtest mode".

---

## 2. Event loop

Single-threaded, deterministic:

```
while queue:
    ev = queue.pop_min(key=(ts_processed, sequence_id))
    integrity_gate(ev)          # staleness, validation flags
    bar_engine(ev)              # may emit closed BarEvents -> pushed back at same ts
    feature_engine(ev)          # incremental, causal
    regime_engine(ev)
    strategy.on_*(ev)           # may return Signals
    for sig in signals:
        decision = risk.evaluate(sig, portfolio, market_state)
        if decision.action in (APPROVE, REDUCE):
            order = order_manager.create(sig, decision)
            execution.submit(order)          # schedules broker arrival at ts + latency
    simulated_broker.advance(ev)             # matches resting orders against this event
    portfolio.mark(ev)                       # unrealised PnL, equity, drawdown
    risk.on_equity_update(portfolio)         # can trip the kill switch between orders
```

Key ordering property: an order created while processing event *n* cannot be filled by
event *n*. It arrives at the matching engine at `ts + order_latency`, and only events at
or after that timestamp can fill it. This is what makes latency modelling meaningful.

---

## 3. Bias prevention

| Bias | Mitigation | Test |
|---|---|---|
| Look-ahead | strategies receive only closed bars; partial bars raise if used as history | `test_no_lookahead.py` — a strategy peeking at the next bar fails |
| Future-bar leakage | the bar engine emits on the *first event past* the boundary | `test_bar_boundary.py` |
| Timestamp leakage | features stamp `computed_at`; a feature whose `computed_at > event.ts` raises | `test_feature_causality.py` |
| Fill-time leakage | fills are matched only against events at `t ≥ arrival_ts` | `test_latency_gate.py` |
| Survivorship | equity universes are point-in-time with `listed_from/listed_to`; delisted names stay in the universe | `test_universe_pit.py` |
| Data snooping | out-of-sample and walk-forward are mandatory before promotion; the OOS window is chosen before the IS run and recorded in the manifest | validation pipeline |
| Optimisation on noise | promotion requires a parameter *plateau*, not a peak | `sensitivity.py` |

A deliberate cheat test exists: `tests/backtest/test_no_lookahead.py` implements a
strategy that tries to read a future bar and asserts the engine raises. A backtester that
cannot detect cheating cannot certify honesty.

---

## 4. Cost model

Total cost of a fill:

```
cost = commission + exchange_fees + spread_cost + slippage_cost + impact_cost
```

* **Commission** — per contract / per share / per notional bps / flat, plus min/max.
* **Exchange & regulatory fees** — separate line, futures and equities differ.
* **Spread cost** — crossing pays half the spread against mid. Reported explicitly so a
  strategy trading a 2-tick spread cannot hide it inside "slippage".
* **Slippage** — configurable model:
  * `FIXED_TICKS(n)`
  * `SPREAD_FRACTION(f)` — `f × spread`
  * `VOLATILITY_SCALED(k)` — `k × ATR × sqrt(participation)`
* **Market impact** — square-root law: `impact = c × σ × sqrt(qty / ADV)`, applied to
  orders exceeding `impact_threshold_participation`. Labelled a model, not a
  measurement, in every report.

Costs are attributed per trade, per strategy, per instrument and per session, and the
report shows PnL **before and after** costs side by side (see `PERFORMANCE` §17).

---

## 5. Fill models

Configurable; `realistic` is the default and the only one permitted for promotion
decisions.

| | `optimistic` | `realistic` | `conservative` |
|---|---|---|---|
| Market order | fills at touch, no extra slip | touch + slippage model | touch + slippage × 1.5, partials |
| Limit order | fills if price *touches* the limit | requires trade-through, or touch with volume ≥ `queue_ratio × qty` | requires trade-through by ≥ 1 tick **and** volume ≥ `2 × qty` |
| Queue position | ignored | modelled as a fraction of displayed size | assumed back of queue |
| Partial fills | none | when available size < order size | aggressive partialling |
| Rejections | none | at `reject_rate`, and always when spread > `max_spread` | higher `reject_rate` |
| Stop orders | fill at stop price | fill at stop ± slippage, gap-through honoured | worst price in the gap |

**A limit order is never assumed to fill just because the price printed at its level.**
Under `realistic`, a touch without trade-through fills only in proportion to observed
volume ahead of the order.

Gaps: if the market gaps through a stop, the fill is at the gap price, not the stop
price. Optimistic mode is exempted only for illustration and is blocked from promotion.

---

## 6. Latency model

| Parameter | Meaning |
|---|---|
| `market_data_latency_us` | feed → strategy |
| `order_latency_us` | submit → venue |
| `cancel_latency_us` | cancel → venue |
| `ack_latency_us` | venue → our ack |
| `jitter_us` | seeded random spread around each |

All are configurable per broker/venue and **default to non-zero**. A zero-latency run is
available for diagnosis and is marked `IDEALISED` on the report so it cannot be mistaken
for a tradeable result.

---

## 7. Reproducibility manifest

Written for every run to `runs/<run_id>/manifest.json`:

```json
{
  "run_id": "...", "engine_version": "...", "git_commit": "...", "git_dirty": false,
  "config_hash": "sha256:...", "configs": {"risk.yaml": "sha256:...", "...": "..."},
  "strategy_id": "vwap_mean_reversion", "strategy_version": "1.0.0",
  "dataset_id": "...", "dataset_sha256": "...", "instruments": ["CME:MES"],
  "start_ts": 0, "end_ts": 0,
  "fill_model": "realistic", "slippage_model": {...}, "latency_model": {...},
  "commission_model": {...}, "random_seed": 42,
  "model_version": null, "environment": {"python": "3.11.x", "platform": "..."},
  "result_hash": "sha256:...", "created_at": "..."
}
```

`result_hash` covers the trade ledger and equity curve. Re-running from the manifest must
reproduce it exactly; `tests/backtest/test_reproducibility.py` asserts this, and
`scripts/replay_run.py <manifest>` performs it operationally. `git_dirty: true` marks a
run as non-reproducible on the report — an uncommitted working tree cannot be replayed.

---

## 8. Validation pipeline

A strategy is promoted only after all of the following, in order:

1. **In-sample research** — parameter exploration on the IS window only.
2. **Validation window** — a held-out block used to select among survivors.
3. **Out-of-sample test** — a window untouched until this step. One shot.
4. **Walk-forward analysis** — rolling anchored windows; report per-window PnL, not the
   aggregate alone. Consistency matters more than the total.
5. **Monte Carlo resampling** — bootstrap trade sequences; report the 5th-percentile
   drawdown and the probability of ruin at the configured risk level.
6. **Parameter sensitivity** — the neighbourhood of the chosen parameters must also be
   profitable. A peak surrounded by losses is rejected as noise.
7. **Regime analysis** — PnL broken down by regime; a strategy that is profitable only in
   one regime is either regime-gated or rejected.
8. **Stress tests** — 2× transaction costs, 2× latency, 2× slippage. Report the cost
   multiple at which expectancy reaches zero (the "cost headroom").

Automatic rejection criteria:

* expectancy after costs ≤ 0 on OOS;
* OOS Sharpe < `min_oos_sharpe` (default 0.5);
* fewer than `min_trades` (default 100) in OOS — an unmeasurable result is not a good one;
* cost headroom < 1.5× — no margin for real-world cost drift;
* parameter plateau width < `min_plateau_fraction` of the swept range, or a best value
  that is an isolated point rather than a region;
* probability of ruin above `max_probability_of_ruin` at the configured drawdown;
* a 95th-percentile resampled drawdown more than `max_drawdown_understatement` times the
  realised one — the backtest's drawdown then owes more to ordering luck than to the
  strategy;
* **any criterion that could not be evaluated.** Missing evidence is a failure, not a
  pass. A strategy that has not been walk-forward tested has not been shown to work out of
  sample more than once.

Implemented in `core.validation`; run with `scripts/validate_strategy.py <strategy>`, which
exits non-zero when the strategy is not approved.

Two limitations are stated rather than hidden. Cost headroom is computed analytically from
the realised ledger, so it does not account for the different trades a higher-cost run
would have taken — it is an **upper bound**. And sweeps run on the in-sample window only,
because sweeping on out-of-sample data would consume the one unbiased measurement the
pipeline has.

---

## 9. Outputs

Each run writes: `manifest.json`, `trades.parquet` (ledger), `equity.parquet` (curve with
drawdown), `metrics.json` (§17 of the specification, before *and* after costs),
`risk_events.jsonl`, `orders.jsonl`, `fills.jsonl`, `report.md`.

Losing runs are written with the same fidelity as winning ones and are never deleted.
