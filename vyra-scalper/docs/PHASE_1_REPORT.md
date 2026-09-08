# Phase 1 implementation report

**Scope:** repository through MVP backtest — items 1–12 of the mandated development order,
plus the deterministic regime engine brought forward from Phase 3 because the first
strategy is regime-gated and could not otherwise trade.

**Result:** every MVP acceptance criterion in §33 is met and covered by
`tests/backtest/test_mvp_acceptance.py`.

---

## What the reference run reports

Running `python scripts/run_backtest.py` on the shipped configuration produces a **losing**
result after costs on the synthetic dataset, and the report says so plainly. That is the
platform working as specified: it is built to measure, not to flatter.

The report leads with its warnings — synthetic data, reproducibility status, and any
implausible result shape — before any performance number, so a reader who stops after the
first screen still knows whether the figures below can be trusted.

---

## Findings from building it

Four defects were found and fixed during implementation. Each is recorded because each
would have produced a *plausible* wrong answer rather than an obvious failure.

### 1. Exposure limits calibrated as if for equities

The shipped `max_instrument_exposure_pct` was 1.0 (100 % of equity in notional). Futures
are leveraged instruments: one MES contract at 5100 is $25 500 of notional, so a position
sized correctly by `max_risk_per_trade_pct` is already 2.5× equity in notional terms. The
cap bound at 3 contracts where the risk budget allowed 10 — meaning the cap, not the risk
limit, was setting size. A limit that looks conservative while silently disabling the real
loss control is worse than no limit. Recalibrated to 300 %, with the reasoning in
`RISK_SPEC.md` §3.2.

### 2. The synthetic generator handed the strategy a free win

The generator mean-reverted to a *fixed* anchor. A VWAP mean-reversion strategy harvests
that perfectly: the first full run produced **90 trades, 90 wins, zero losses, Sharpe 40**.
The anchor now drifts, and — more importantly — `PerformanceReport.implausibility_warnings`
flags result shapes that are far more often a bug than an edge: no losing trades, a win
rate above 90 %, a Sharpe above 10, or fewer than 100 trades. After the fix the same
strategy loses money on the same pipeline, which is a far more useful test bed.

### 3. Two seeds that could disagree

`run.random_seed` was recorded in the manifest, but the data generator read its own
`synthetic.seed`. Changing the recorded seed changed nothing, so the manifest claimed a
value that did not determine the run — and a reproducibility test built on it passed
vacuously. There is now one master seed, with decorrelated per-component seeds derived from
it (`core.util.ids.derive_seed`), and the duplicate config key is gone.

### 4. The reproduction hash covered the run's identity

`result_payload` hashed `order_id` and `client_order_id`, both of which embed the run id.
Two runs of the same configuration could therefore never agree, and the earlier test passed
only because its window produced no trades. The hash now covers the economic result —
instrument, side, size, price, cost, time, equity path, halt state — and the tests assert
that trades actually occurred, so they cannot pass vacuously again.

---

## Deliberate design decisions

| Decision | Reason |
|---|---|
| Engine core depends only on the stdlib and PyYAML | keeps the tick path free of large import graphs; numerical and service stacks live at the edges |
| UTC integer nanoseconds everywhere | exact ordering and latency arithmetic; float seconds lose ns resolution above 2^53 |
| Streaming indicators, never array functions | an accumulator that has only seen the past *cannot* look ahead; an array can be sliced into the future |
| `Signal` has no `quantity` field | a strategy that cannot express a size cannot override the risk budget |
| Money rounded at boundaries, not in accumulators | six Decimal quantisations per mark cost a third of the event loop and bought nothing |
| Holidays keyed by *trading date* | a holiday on 25 December must cancel the window that opened at 17:00 on the 24th |
| `UNKNOWN` regime blocks trading | trading a mean-reversion strategy through an unclassified market is what the gate exists to prevent |
| Kill switch has no `force` parameter | every automated recovery path is one that eventually resumes into the condition that stopped it |

---

## Performance

The event loop runs at roughly 15 000 events/second single-threaded, after four
profiling-driven fixes: rounding money at output boundaries rather than in accumulators,
sampling the equity curve (1 001 points → 10 over a 10-second window, with peak and
drawdown still exact), caching the resolved session window, and skipping context
construction for event handlers a strategy does not override. That is a 5.4× improvement
over the first working version.

---

## What is not built

Listed in full in `ROADMAP.md`. The load-bearing omissions:

* **No live broker connectivity.** IBKR, MT5 and OANDA are configured with symbol maps and
  capabilities; the adapter classes do not exist.
* **No validation pipeline.** Walk-forward, Monte Carlo, sensitivity and stress analysis
  are specified in `BACKTEST_SPEC.md` §8 and unimplemented, so **no strategy can be
  promoted** on this platform yet.
* **One strategy of seven.** The rest are configured and disabled.
* **No order book engine, API, dashboard, ML, or AI analyst.**

No capital is deployed until paper and shadow modes are operational.
