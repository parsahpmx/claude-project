# VYRA — Data Specification

---

## 1. Principles

1. **UTC integer nanoseconds internally.** Conversion happens only at ingestion and
   presentation boundaries.
2. **Never silently repair data.** No interpolated ticks, no forward-filled quotes, no
   invented volume. Gaps are first-class objects (`DataGap`) that appear in reports.
3. **Never combine contracts implicitly.** A continuous series exists only when built by
   an explicit `ContinuousContractSpec`, and the resulting series is stamped with the
   roll rule and adjustment method used.
4. **Provenance travels with the data.** Every event carries `source`; every dataset
   carries a manifest (§8).

---

## 2. Canonical event schema

Common to every market event:

| Field | Type | Notes |
|---|---|---|
| `instrument_id` | str | canonical internal id, e.g. `CME:MES` |
| `exchange` | str | `CME`, `NASDAQ`, `BROKER:OANDA` |
| `ts_exchange` | int ns | venue timestamp; `0` if the venue does not provide one |
| `ts_receive` | int ns | our first touch |
| `ts_processed` | int ns | when the engine handed it to consumers |
| `sequence_id` | int | strictly increasing per run |
| `source` | str | feed identifier, e.g. `SYNTH:v1`, `CSV:cme_mes_2024` |

Type-specific:

* `QuoteEvent` — `bid, ask, bid_size, ask_size`
* `TradeEvent` — `price, size, aggressor` (`BUY`/`SELL`/`UNKNOWN`)
* `OrderBookEvent` — `bids[(price,size)], asks[(price,size)], depth`
* `BarEvent` — `timeframe, ts_open, ts_close, open, high, low, close, volume, vwap,
  trade_count, is_closed`
* `SessionEvent` — `session_state` (`PRE`, `OPEN`, `CLOSE`, `POST`, `HALTED`)
* `NewsEvent` — `headline, importance, scheduled_ts, instruments[]`

Order/Fill/Position/Risk events are defined in `EXECUTION_SPEC.md` and `RISK_SPEC.md`.

### 2.1 Latency metrics

`exchange_to_receive = ts_receive − ts_exchange`,
`receive_to_process  = ts_processed − ts_receive`,
`end_to_end          = ts_processed − ts_exchange`.

When `ts_exchange == 0` (venue gives no stamp), exchange-derived latencies are `None`,
never `0`. A missing measurement must not read as a perfect measurement.

---

## 3. Validation on ingestion

Each event passes `core.market_data.normalization.validate_*`. Failures are classified,
counted, and either dropped-with-record or flagged:

| Condition | Action |
|---|---|
| non-finite price/size (NaN, ±inf) | drop, `INVALID_VALUE` |
| price ≤ 0 (non-spread instruments) | drop, `NON_POSITIVE_PRICE` |
| size < 0 | drop, `NEGATIVE_SIZE` |
| `bid >= ask` | keep, flag `CROSSED_BOOK`; sustained → integrity gate blocks trading |
| price off-tick | keep, flag `OFF_TICK`; quantised copy exposed separately |
| `ts_exchange > ts_receive` beyond tolerance | flag `CLOCK_SKEW` |
| out-of-order (`ts < last_ts`) | flag `OUT_OF_ORDER`; strict mode drops it |
| duplicate `(instrument, sequence_id)` | drop, `DUPLICATE` |
| price jump > `max_jump_atr` × ATR in one tick | keep, flag `PRICE_SPIKE` |

Counters are exposed per instrument per session and land in the run manifest. A backtest
whose input had 3 % invalid ticks says so on the report.

---

## 4. Staleness

Per instrument: `age = now − ts_receive` of the last accepted quote.

| State | Condition |
|---|---|
| `FRESH` | `age ≤ warn_ms` |
| `WARN` | `warn_ms < age ≤ stale_ms` — logged, trading continues |
| `STALE` | `age > stale_ms` — instrument blocked, no new entries |
| `DEAD` | `age > dead_ms` — kill-switch trigger `MARKET_DATA_STALE` |

Defaults: futures 500/2 000/10 000 ms; equities 1 000/5 000/30 000 ms; CFD
2 000/10 000/60 000 ms. Session-aware: the clock does not run outside session hours.

---

## 5. Bars

`core.market_data.bars.BarEngine` builds `1s, 5s, 15s, 30s, 1m, 3m, 5m, 15m, 1h, 4h, 1d`.

**Look-ahead safety, the central rule:** a bar is emitted only when an event arrives with
`ts >= bar_close_ts`, or when a session-close event arrives. The emitted bar has
`is_closed = True`. The engine also exposes `current_partial(timeframe)`, which returns a
bar with `is_closed = False`; feature and strategy code that consumes closed-bar series
**refuses** partial bars (`ValueError`), so a partial bar cannot enter a historical
series by accident.

Other rules:

* Bar boundaries are aligned to the exchange session, not to wall-clock midnight UTC.
  A 4h bar on CME starts at the session open, not at 00:00 UTC.
* **Empty periods produce no bar.** No zero-volume phantom candles. The gap is recorded.
* Daily bars close at the session close defined in `configs/sessions.yaml`, honouring
  holidays and early closes.
* Bar VWAP uses trade prints only. If a period had no trades, VWAP is `None`, not the
  midpoint.

---

## 6. Order book, and the CFD boundary

For venues with real depth (CME), `OrderBookEngine` computes spread, mid, microprice,
liquidity per side, imbalance, delta and cumulative delta, trade velocity, order-arrival
and cancellation rates, liquidity walls, absorption and large-trade detection.

**Hard boundary:** a broker CFD "book" is that broker's own quoting, not centralised
market liquidity. Therefore:

* CFD-derived microstructure features are namespaced `cfd.*`; exchange-derived features
  are `exch.*`.
* No feature ever mixes the two namespaces.
* A strategy declares `requires_exchange_depth: bool`. The loader refuses to attach such
  a strategy to a CFD instrument, at configuration time, with an explicit error.

---

## 7. Instruments, sessions, contracts

### 7.1 Definition

`configs/markets.yaml` defines each instrument: `instrument_id, symbol, asset_class,
exchange, currency, tick_size, tick_value, multiplier, min_qty, qty_step, session_id,
timezone, expiry` (futures), `max_spread_ticks`, `commission`.

Loader validation: futures must satisfy `tick_value == tick_size × multiplier`
(tolerance 1e-9); equities must have `multiplier == 1`. A mis-specified tick value
silently scales every PnL number in the system, so it is checked at load, loudly.

### 7.2 Sessions and holidays

`configs/sessions.yaml` — named sessions with segments in exchange-local time, plus
holidays and early closes. `zoneinfo` handles DST. `SessionCalendar` answers:
`is_open(ts)`, `session_state(ts)`, `session_bounds(ts)`, `next_open(ts)`,
`is_holiday(date)`.

### 7.3 Contract rollover

`ContinuousContractSpec` requires an explicit choice of both:

| Roll rule | |
|---|---|
| `CALENDAR_DAYS_BEFORE_EXPIRY(n)` | deterministic, reproducible |
| `VOLUME_CROSSOVER` | roll when front volume < back volume for `k` consecutive sessions |
| `OPEN_INTEREST_CROSSOVER` | same on OI |

| Adjustment | |
|---|---|
| `NONE` | raw prices; a visible gap at each roll |
| `BACK_ADJUST_DIFF` | subtract the roll gap from history (default for futures research) |
| `BACK_ADJUST_RATIO` | multiplicative; use for very long histories |

Rules:

* Roll happens **between sessions**, never intraday.
* Every roll is recorded (`roll_date, from_contract, to_contract, gap, method`) and the
  record travels with the series.
* Back-adjusted prices are **research-only**. Live orders and PnL always use the actual
  contract's raw prices; the engine raises if an adjusted series reaches the execution
  path.
* Volume is never adjusted, only price.

### 7.4 Symbol mapping

`SymbolMapper` maps canonical ids to broker symbols and back:

```
XAUUSD → {IBKR: XAUUSD, MT5_A: GOLD, MT5_B: XAU_USD, OANDA: XAU_USD}
```

Mappings are declared per broker in `configs/brokers.yaml`. Lookups are total: an
unmapped symbol raises `SymbolNotMapped` at connect time, not at order time. Reverse
mapping must be unambiguous; duplicate broker symbols fail validation at load.

---

## 8. Storage and datasets

| Layer | Format |
|---|---|
| raw capture | append-only JSONL/Parquet, partitioned `source/instrument/date` |
| normalised | Parquet, partitioned `instrument/date`, one schema version per directory |
| bars | Parquet, partitioned `instrument/timeframe/date` |
| live state | Redis |
| audit | PostgreSQL/TimescaleDB, append-only |

Every dataset directory carries `_manifest.json`:

```json
{
  "dataset_id": "...", "schema_version": 1, "source": "SYNTH:v1",
  "instruments": ["CME:MES"], "start_ts": 0, "end_ts": 0,
  "row_count": 0, "content_sha256": "...", "created_at": "...",
  "generator_version": "...", "seed": 42,
  "gaps": [{"start_ts": 0, "end_ts": 0, "reason": "SESSION_CLOSED"}],
  "validation_counters": {"OFF_TICK": 0, "CROSSED_BOOK": 0}
}
```

`content_sha256` is what a backtest manifest references. If the dataset changes, the
backtest hash changes, and the old result is not silently re-attributed to new data.

---

## 9. Phase 1 sources

* `SyntheticTickSource` — seeded GBM mid with a session-dependent spread process, a
  Poisson trade-arrival process and configurable microstructure noise. Deterministic for
  a given seed; used by tests and by the reproducibility proof.
* `CsvTickSource` / `CsvBarSource` — column mapping declared in config, no guessing.
* `ParquetSource` — reads the normalised layer. **Not yet implemented**; selecting it in
  configuration fails with an explicit error rather than falling back to another source.

Synthetic data is for **plumbing and invariants only**. No expectancy claim is ever made
from it, and reports generated from a synthetic dataset are watermarked `SYNTHETIC`.
