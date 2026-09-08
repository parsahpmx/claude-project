# VYRA — Risk Specification

The Risk Engine has **absolute authority**. A strategy proposes; the Risk Engine
disposes. There is no path from a `Signal` to a `BrokerAdapter` that does not carry a
`RiskDecision`.

---

## 1. Decision model

```python
RiskAction = APPROVE | REDUCE | REJECT | HALT
```

| Action | Meaning |
|---|---|
| `APPROVE` | proceed at the computed size |
| `REDUCE`  | proceed at a strictly smaller size, with the binding limit named |
| `REJECT`  | this order does not go out; trading continues |
| `HALT`    | kill switch trips; no new entries system-wide until operator reset |

Every decision produces a `RiskDecision` recording: `decision_id`, `signal_id`,
`action`, `requested_qty`, `approved_qty`, `reason_codes[]`, `binding_limit`,
`equity`, `risk_amount`, `ts`. Decisions are persisted append-only for **all four**
actions, including approvals — an audit that only records rejections cannot prove that a
limit was evaluated.

Evaluation is **fail-closed**: an exception inside any check is caught, logged with the
check name, and converted to `REJECT` with reason `RISK_CHECK_ERROR`. A risk engine that
cannot evaluate does not approve.

---

## 2. Reason codes

Stable, machine-readable, never reworded (they are queried in analytics):

```
KILL_SWITCH_ACTIVE          MAX_RISK_PER_TRADE          MAX_INSTRUMENT_EXPOSURE
MAX_PORTFOLIO_EXPOSURE      MAX_CORRELATED_EXPOSURE     MAX_DAILY_LOSS
MAX_WEEKLY_LOSS             MAX_DRAWDOWN                MAX_TRADES_PER_SESSION
MAX_CONSECUTIVE_LOSSES      MAX_POSITION_SIZE           MAX_LEVERAGE
MIN_LIQUIDITY               MAX_SPREAD                  MAX_EXPECTED_SLIPPAGE
VOLATILITY_LIMIT            NEWS_BLACKOUT               SESSION_RESTRICTED
COOLDOWN_ACTIVE             INVALID_STOP_DISTANCE       STALE_MARKET_DATA
SIZE_ROUNDS_TO_ZERO         DUPLICATE_SIGNAL            RISK_CHECK_ERROR
REGIME_NOT_ALLOWED          INSUFFICIENT_EQUITY
```

---

## 3. Limits

All values live in `configs/risk.yaml`. Defaults below are the shipped conservative
baseline, not a recommendation.

### 3.1 Per-trade

| Limit | Key | Default |
|---|---|---|
| Max monetary risk per trade | `max_risk_per_trade_pct` | 0.25 % of equity |
| Max position size | `max_position_size` | per instrument |
| Min stop distance | `min_stop_distance_ticks` | 2 ticks |
| Max stop distance | `max_stop_distance_atr` | 4 × ATR |

`min_stop_distance_ticks` exists because sizing divides by stop distance: a
one-tick stop implies an enormous position. Distances below the floor are rejected with
`INVALID_STOP_DISTANCE`, never clamped silently.

### 3.2 Exposure

| Limit | Key | Default |
|---|---|---|
| Instrument notional | `max_instrument_exposure_pct` | 300 % of equity |
| Portfolio gross notional | `max_portfolio_exposure_pct` | 600 % |
| Correlated-group notional | `max_correlated_exposure_pct` | 400 % |
| Leverage | `max_leverage` | 6× |

These are **notional over equity**, and they are deliberately not equity-like. Futures are
leveraged instruments: one MES contract at 5100 is $25 500 of notional against a few
hundred dollars of margin, so a position sized correctly by `max_risk_per_trade_pct` is
already several times equity in notional terms. Caps set at 100 % would bind before the
per-trade risk limit ever did, silently making the *actual* loss control inoperative while
appearing conservative. Loss is controlled by `max_risk_per_trade_pct` and the daily and
drawdown limits; these caps exist to prevent **concentration**, and they reduce rather
than reject so a portfolio near a limit still trades smaller instead of oscillating
between full size and nothing.

Correlation groups are declared in config (`correlation_groups`), e.g.
`{us_index: [MES, ES, MNQ, NQ, NAS100, US500], gold: [MGC, GC, XAUUSD]}`. MES and ES are
the *same risk* at different sizes; treating them as independent is the classic way to be
4× larger than intended.

### 3.3 Loss and drawdown

| Limit | Key | Default | On breach |
|---|---|---|---|
| Daily loss | `max_daily_loss_pct` | 2 % | `HALT` |
| Weekly loss | `max_weekly_loss_pct` | 4 % | `HALT` |
| Max drawdown from peak equity | `max_drawdown_pct` | 8 % | `HALT` |
| Consecutive losses | `max_consecutive_losses` | 4 | cooldown, then `REJECT` |
| Trades per session | `max_trades_per_session` | 20 | `REJECT` |

Daily loss is measured as **realised + unrealised** against the session's opening equity,
evaluated on every equity update — not only at order time. A position that drifts through
the limit trips the switch without a new order being attempted.

### 3.4 Market-condition gates

| Gate | Key |
|---|---|
| Max spread | `max_spread_ticks` (per instrument) |
| Min top-of-book size | `min_liquidity_size` |
| Max expected slippage | `max_expected_slippage_ticks` |
| Volatility band | `min_atr_ticks` / `max_atr_ticks` |
| News blackout | `news_blackout_minutes_before/after` |
| Session windows | `allowed_sessions`, `no_trade_windows` (e.g. first 30 s of RTH) |
| Cooldown after loss | `cooldown_after_loss_seconds` |

---

## 4. Position sizing

`core.risk.sizing.compute_position_size` — pure, total, side-effect free.

```
risk_amount      = equity × max_risk_per_trade_pct
stop_distance    = |entry − stop|                       (price units)
stop_ticks       = stop_distance / tick_size
risk_per_unit    = stop_ticks × tick_value              (money per 1 contract/share)
raw_qty          = risk_amount / risk_per_unit
qty              = floor_to_step(raw_qty, qty_step)
```

Guards, in order, each returning a named reason:

1. `tick_size <= 0`, `tick_value <= 0`, `equity <= 0` → `INVALID_INSTRUMENT` / `INSUFFICIENT_EQUITY`.
2. `stop_distance <= 0` or `stop_ticks < min_stop_distance_ticks` → `INVALID_STOP_DISTANCE`.
   **Division by zero is structurally impossible**, not merely unlikely.
3. `qty < min_qty` after rounding → `SIZE_ROUNDS_TO_ZERO`, size 0, order not sent.
   Rounding *up* to reach the minimum would silently exceed the risk budget.
4. `qty` capped by `max_position_size`, exposure, leverage → `REDUCE` with binding limit.

For equities `tick_value = tick_size` and `multiplier = 1`. For futures
`tick_value = tick_size × multiplier` and is validated against the instrument definition
at load time (MES: 0.25 × 5 = 1.25).

---

## 5. Kill switch

### 5.1 Triggers

| Trigger | Source |
|---|---|
| `DAILY_LOSS_EXCEEDED`, `WEEKLY_LOSS_EXCEEDED`, `DRAWDOWN_EXCEEDED` | risk engine |
| `BROKER_DISCONNECTED` | adapter health check |
| `MARKET_DATA_STALE` | staleness gate |
| `RECONCILIATION_FAILURE`, `UNKNOWN_POSITION` | portfolio reconciler |
| `DATABASE_UNAVAILABLE`, `RISK_SERVICE_UNAVAILABLE` | infrastructure probes |
| `ABNORMAL_LATENCY`, `ABNORMAL_SLIPPAGE`, `ORDER_REJECT_RATE` | execution monitor |
| `IMPOSSIBLE_STRATEGY_VALUE` | signal validation (NaN, inf, stop on wrong side) |
| `CLOCK_DESYNC` | clock monitor |
| `MANUAL` | operator |

### 5.2 Behaviour on trip

1. Cancel all working orders (best effort; failures are logged, never swallowed).
2. Block all new entries immediately — checked in `RiskEngine` *and* `ExecutionEngine`.
3. Apply the configured emergency policy for open positions:
   * `HOLD` — do nothing (default; flattening into a broken feed can be worse);
   * `FLATTEN_ON_RECOVERY`;
   * `FLATTEN_IMMEDIATELY`.
4. Emit `RiskEvent(KILL_SWITCH_TRIPPED)` and alert the operator.
5. Persist state so a process restart comes back **tripped**. A crash-loop must never
   look like a reset.

### 5.3 Recovery

`reset(operator, reason)` only. Requires: switch tripped for ≥ `min_trip_seconds`,
the triggering condition no longer true, and a recorded operator identity. Reset writes
`RiskEvent(KILL_SWITCH_RESET)`. **There is no automatic resume, no timeout-based resume,
and no config flag that enables one.**

---

## 6. Interaction with confidence and ML

Confidence ∈ [0, 1] may scale size *downward within* the approved envelope, via
`size_confidence_floor ≤ f(confidence) ≤ 1.0`. It can never raise a limit, and
`max_risk_per_trade_pct` is applied **after** any confidence scaling. An ML probability
enters as one confidence input among several. No model output is wired to any limit.

---

## 7. Testing requirements

`tests/risk/` must cover, at minimum:

* each limit binds independently and produces its own reason code;
* sizing is exact for MES/ES/NQ/AAPL/XAUUSD fixtures at known equity and stops;
* zero, negative and sub-minimum stop distances never raise and never size;
* daily-loss breach trips the switch and blocks the *next* order;
* a tripped switch survives serialisation round-trip (restart safety);
* reset is refused without an operator, and refused while the condition persists;
* a strategy cannot construct an order — asserted by module-namespace inspection.
