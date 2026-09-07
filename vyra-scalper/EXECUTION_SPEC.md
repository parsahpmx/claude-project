# VYRA — Execution Specification

---

## 1. Order lifecycle

```
PENDING_NEW ──submit──▶ SUBMITTED ──ack──▶ WORKING ──┬──▶ PARTIALLY_FILLED ──▶ FILLED
     │                      │                        ├──▶ CANCELLED
     └──▶ REJECTED_LOCAL    └──▶ REJECTED_BROKER     └──▶ EXPIRED
```

The state machine is explicit; illegal transitions raise `InvalidOrderTransition` rather
than mutating state. `REJECTED_LOCAL` (risk, validation, kill switch) is distinguished
from `REJECTED_BROKER` — they have different operational meanings and different alerts.

---

## 2. Order model

| Field | Notes |
|---|---|
| `order_id` | our id, ULID-like, monotonic per run |
| `client_order_id` | idempotency key sent to the broker (§4) |
| `broker_order_id` | assigned on ack |
| `parent_signal_id`, `risk_decision_id` | full lineage back to the signal |
| `strategy_id`, `instrument_id`, `side`, `quantity`, `order_type`, `tif` | |
| `limit_price`, `stop_price` | tick-quantised at construction |
| `filled_qty`, `avg_fill_price`, `remaining_qty` | |
| `state`, `reason_codes[]` | |
| timestamps | `ts_signal, ts_created, ts_submitted, ts_ack, ts_first_fill, ts_last_fill, ts_terminal` |

**Order types:** `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`.
**TIF:** `DAY`, `GTC`, `IOC`, `FOK`.

Capability negotiation: each adapter publishes `BrokerCapabilities` (supported types,
TIFs, whether native cancel/replace exists, min/max size, price precision). The
`ExecutionEngine` checks capability **before** submitting, and either downgrades along a
declared, logged path (e.g. `STOP` → synthetic stop managed locally) or rejects with
`UNSUPPORTED_ORDER_TYPE`. It never sends an order type the venue will reject.

---

## 3. Entry policies

| Policy | Behaviour |
|---|---|
| `MARKET` | cross immediately; highest certainty, highest cost |
| `MARKETABLE_LIMIT` | limit at far touch ± `aggression_ticks`; caps worst-case price while retaining high fill probability. **Default.** |
| `SMART_LIMIT` | rest at near touch, re-price up to `max_repricings` times as the book moves, escalate to marketable after `escalate_after_ms` |
| `PASSIVE_LIMIT` | rest only; cancel if unfilled after `timeout_ms` |

Every policy carries a timeout. An order with no timeout is a position you did not choose
to have. On timeout: cancel, and emit `ENTRY_TIMEOUT` so the strategy can decide whether
the opportunity is stale — the execution engine never re-enters on its own.

---

## 4. Idempotency and duplicate protection

Three independent layers, because duplicate orders are the most expensive class of bug:

1. **Deterministic `client_order_id`** = `hash(run_id, strategy_id, instrument_id,
   signal_id, attempt)`. A retry of the *same* attempt reuses the id; the broker
   deduplicates. A new attempt increments explicitly.
2. **In-flight registry** in `OrderManager`: at most one working entry order per
   `(strategy_id, instrument_id, direction)` unless `allow_stacking` is set. A second
   signal while one is in flight is rejected with `DUPLICATE_IN_FLIGHT`.
3. **Post-submit verification**: after any ambiguous failure (timeout, disconnect), the
   engine **queries broker state before retrying**. It never retries blind — that is how
   double positions are created.

---

## 5. Retry policy

| Failure | Action |
|---|---|
| transport timeout | query state; retry same `client_order_id` up to `max_retries` (default 2) with backoff |
| broker rejects — transient (`THROTTLED`, `BUSY`) | backoff and retry, up to `max_retries` |
| broker rejects — terminal (`INSUFFICIENT_MARGIN`, `INVALID_CONTRACT`, `MARKET_CLOSED`) | no retry; surface to risk and strategy |
| disconnect mid-submit | mark `UNKNOWN`, reconcile on reconnect, **do not resubmit** |
| reject rate > `max_reject_rate` over the window | kill-switch trigger `ORDER_REJECT_RATE` |

`UNKNOWN` is a real state, tracked explicitly. Treating an unknown order as "not sent" is
how duplicates appear; treating it as "sent" is how positions go untracked. It is
resolved only by reconciliation against broker state.

---

## 6. Partial fills

* Every fill is an immutable `FillEvent`; orders accumulate, they are never overwritten.
* `avg_fill_price` is size-weighted across fills.
* Protective orders (stop/target) are sized to **filled quantity**, and are amended as
  further fills arrive. A stop for the full intended size against a partial position is a
  reversal, not a stop.
* On timeout with a partial fill: cancel the remainder, keep the position, emit
  `PARTIAL_ENTRY` with the actual size so risk accounting is correct.

---

## 7. Position reconciliation

Runs on: connect, every `reconcile_interval_s` (default 30 s), after any disconnect, and
before every flatten.

```
for each instrument:
    ours   = portfolio.position(instrument)
    theirs = broker.get_positions()[instrument]
    if ours != theirs: -> divergence
```

| Divergence | Response |
|---|---|
| broker has a position we do not know about | `UNKNOWN_POSITION` → kill switch, immediate operator alert |
| we think we have a position, broker has none | `PHANTOM_POSITION` → kill switch |
| quantity mismatch | `QTY_MISMATCH` → adopt broker as truth, alert, block new entries |
| price/avg mismatch within tolerance | log, adopt broker |

The broker is always the source of truth for positions. Our book is a *belief*.
Reconciliation never silently overwrites without an emitted `RiskEvent`.

---

## 8. Execution quality measurement

Recorded per fill, and aggregated per strategy / instrument / hour / session:

| Metric | Definition |
|---|---|
| `decision_price` | mid at `ts_signal` |
| `arrival_price` | mid at `ts_submitted` |
| `expected_fill` | model's predicted fill at submission |
| `actual_fill` | realised average fill price |
| `slippage_vs_decision` | `(actual − decision) × side` — implementation shortfall |
| `slippage_vs_expected` | model error; drives model recalibration |
| `spread_cost` | `half_spread × qty × multiplier` at submission |
| `commission`, `exchange_fees` | as charged |
| `total_execution_cost` | sum of the above |
| `latency_signal_to_submit` / `submit_to_ack` / `ack_to_fill` / `signal_to_fill` | ns |
| `fill_rate` | filled / submitted quantity |
| `reject_rate`, `cancel_rate`, `timeout_rate` | per window |

`slippage_vs_expected` is the number that keeps the backtest honest: a persistent bias
means the simulator is optimistic, and the cost model is recalibrated before any
conclusion about the strategy is drawn.

Anomaly triggers: `|slippage| > slippage_alert_ticks`, `signal_to_fill >
latency_alert_ms`, or `reject_rate > max_reject_rate` → `RiskEvent` and, past the hard
thresholds, the kill switch.

---

## 9. Broker adapter contract

```python
class BrokerAdapter(Protocol):
    def connect() -> None
    def disconnect() -> None
    def health_check() -> BrokerHealth
    def get_account() -> AccountSnapshot
    def get_positions() -> dict[str, Position]
    def get_orders() -> dict[str, Order]
    def submit_order(req: OrderRequest) -> OrderAck
    def cancel_order(order_id: str) -> None
    def replace_order(order_id: str, changes: OrderAmendment) -> OrderAck
    def flatten_position(instrument_id: str) -> None
    def flatten_all() -> None
    def subscribe_quotes(instruments) -> None
    def subscribe_trades(instruments) -> None
    def subscribe_orderbook(instruments) -> None
    def subscribe_account_updates() -> None
```

Rules every adapter must honour:

1. Translate symbols through `SymbolMapper` — never pass an internal id to a venue, never
   let a venue symbol into the engine.
2. Normalise venue errors to the `BrokerErrorCode` enum; never leak vendor exceptions
   upward.
3. Report capabilities honestly. Claiming an unsupported order type is a contract
   violation caught by the shared adapter test suite (`tests/execution/test_adapter_contract.py`),
   which every adapter must pass — including `PaperBrokerAdapter`.
4. Never retry internally. Retry policy belongs to the `ExecutionEngine`, in one place.
5. `flatten_all()` must be safe to call repeatedly and while disconnected (it queues).

---

## 10. Kill-switch interaction

Before every submission the `ExecutionEngine` re-checks the kill switch — the state may
have changed between the risk decision and the submission. On trip: cancel all working
orders, block new entries, apply the configured emergency policy, alert. Exit orders that
reduce risk remain permitted when the policy is `FLATTEN_*`; **entries never are**.
