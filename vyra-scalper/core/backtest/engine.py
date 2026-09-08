"""The event-driven backtest engine.

Runs the **production** strategy, feature, risk and execution objects over a historical
event stream.  Only the event source and the broker adapter differ from live trading
(``BACKTEST_SPEC.md`` §1).

The loop's ordering property is what makes latency and costs meaningful: an order created
while processing event *n* becomes eligible at the venue only at ``ts + order_latency``, so
it cannot be filled by the event that produced it.
"""

from __future__ import annotations

import heapq
import random
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from core.brokers.simulated import SimulatedBrokerAdapter
from core.events import (
    BarEvent,
    Event,
    FillEvent,
    QuoteEvent,
    Timeframe,
    TradeEvent,
)
from core.execution.engine import ExecutionEngine
from core.execution.order_manager import OrderManager
from core.features.engine import FeatureEngine
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry
from core.market_data.bars import BarEngine
from core.market_data.normalization import Normalizer
from core.market_data.staleness import StalenessGate
from core.portfolio.portfolio import Portfolio
from core.portfolio.reconciliation import PositionReconciler
from core.regime.engine import MarketRegimeEngine
from core.risk.engine import MarketState, RiskEngine
from core.signals.signal import Signal
from core.strategies.base import BaseStrategy, StrategyContext, StrategyPosition
from core.util.clock import Nanos
from core.util.logging import get_logger

__all__ = ["BacktestEngine", "BacktestResult"]

_log = get_logger("backtest.engine")


@dataclass(slots=True)
class BacktestResult:
    """Everything a run produced."""

    run_id: str
    portfolio: Portfolio
    orders: list[dict[str, Any]] = field(default_factory=list)
    fills: list[dict[str, Any]] = field(default_factory=list)
    risk_events: list[dict[str, Any]] = field(default_factory=list)
    signals: list[dict[str, Any]] = field(default_factory=list)
    events_processed: int = 0
    bars_built: int = 0
    data_quality: dict[str, Any] = field(default_factory=dict)
    regime_by_trade: dict[int, str] = field(default_factory=dict)
    session_dates: dict[int, date] = field(default_factory=dict)
    halted: bool = False
    halt_reason: str = ""

    def result_payload(self) -> dict[str, Any]:
        """The canonical payload hashed into the manifest.

        Covers the **economic** result and nothing else.  Run-scoped identifiers are
        excluded on purpose: ``order_id``, ``client_order_id`` and ``fill_id`` all embed
        the run id, so hashing them would mean two runs of the same configuration could
        never agree, and the hash would certify only that a run equals itself.

        What is hashed is what a trader would compare: which instrument, which side, what
        size, at what price, for what cost, at what time — plus the equity path and
        whether the run halted.
        """
        return {
            "trades": [t.to_dict() for t in self.portfolio.realized_trades],
            "equity": [
                {"ts": p.ts, "equity": p.equity} for p in self.portfolio.equity_curve
            ],
            "fills": [
                {
                    "instrument_id": f["instrument_id"],
                    "strategy_id": f["strategy_id"],
                    "side": f["side"],
                    "quantity": f["quantity"],
                    "price": f["price"],
                    "commission": f["commission"],
                    "exchange_fees": f["exchange_fees"],
                    "is_partial": f["is_partial"],
                    "liquidity_flag": f["liquidity_flag"],
                    "expected_price": f["expected_price"],
                    "decision_price": f["decision_price"],
                    "ts_fill": f["ts_fill"],
                }
                for f in self.fills
            ],
            "summary": self.portfolio.summary(),
            "halted": self.halted,
        }


class BacktestEngine:
    """Single-threaded, deterministic event loop.

    Args:
        registry: instrument and session definitions.
        strategies: production strategy instances.
        feature_engine, risk_engine, execution_engine, portfolio, broker: the same
            objects the live trader would use.
        timeframes: bars to build.
        market_data_latency_ns: delay before an event reaches the strategy.
        seed: seeds the loop's own randomness so a replay is exact.
    """

    def __init__(
        self,
        run_id: str,
        registry: InstrumentRegistry,
        strategies: Sequence[BaseStrategy],
        feature_engine: FeatureEngine,
        risk_engine: RiskEngine,
        execution_engine: ExecutionEngine,
        portfolio: Portfolio,
        broker: SimulatedBrokerAdapter,
        order_manager: OrderManager,
        normalizer: Normalizer,
        staleness: StalenessGate,
        regime_engine: MarketRegimeEngine | None = None,
        reconciler: PositionReconciler | None = None,
        timeframes: Sequence[Timeframe] = (Timeframe.M1,),
        market_data_latency_ns: int = 800_000,
        seed: int = 0,
    ) -> None:
        self._run_id = run_id
        self._registry = registry
        self._strategies = list(strategies)
        self._features = feature_engine
        self._risk = risk_engine
        self._execution = execution_engine
        self._portfolio = portfolio
        self._broker = broker
        self._orders = order_manager
        self._normalizer = normalizer
        self._staleness = staleness
        self._regimes = regime_engine or MarketRegimeEngine()
        self._reconciler = reconciler
        self._md_latency_ns = market_data_latency_ns
        self._rng = random.Random(seed)

        self._instruments: dict[str, Instrument] = {
            iid: registry.get(iid) for iid in registry.ids()
        }
        self._bar_engines: dict[str, BarEngine] = {}
        self._timeframes = list(timeframes)
        self._sequence = 0
        self._last_quote: dict[str, QuoteEvent] = {}
        self._current_session: dict[str, date] = {}
        self._result = BacktestResult(run_id=run_id, portfolio=portfolio)
        self._strategies_by_instrument: dict[str, list[BaseStrategy]] = {}
        for strategy in self._strategies:
            for instrument_id in strategy.config.instruments:
                self._strategies_by_instrument.setdefault(instrument_id, []).append(strategy)

        # Which event types each strategy actually handles.  Building a feature snapshot
        # and a context for a handler that is the inherited no-op is pure waste, and at
        # tick rates it dominated the loop: a bar strategy would pay for a full snapshot on
        # every quote and trade it never looks at.
        self._handles: dict[str, frozenset[str]] = {
            s.config.strategy_id: self._overridden_handlers(s) for s in self._strategies
        }

    @staticmethod
    def _overridden_handlers(strategy: BaseStrategy) -> frozenset[str]:
        """Names of the ``on_*`` handlers this strategy overrides."""
        cls = type(strategy)
        return frozenset(
            name
            for name in ("on_quote", "on_trade", "on_bar", "on_orderbook")
            if getattr(cls, name, None) is not getattr(BaseStrategy, name)
        )

    # -- setup --------------------------------------------------------------------------

    def _bar_engine_for(self, instrument_id: str) -> BarEngine:
        engine = self._bar_engines.get(instrument_id)
        if engine is None:
            instrument = self._instruments[instrument_id]
            engine = BarEngine(
                instrument_id=instrument_id,
                exchange=instrument.exchange,
                timeframes=self._timeframes,
                calendar=self._registry.calendar(instrument_id),
                source=f"BARS:{self._run_id}",
            )
            self._bar_engines[instrument_id] = engine
        return engine

    # -- main loop ----------------------------------------------------------------------

    def run(self, events: Iterator[Event]) -> BacktestResult:
        """Process the event stream to completion.

        The stream is merged through a heap keyed by ``(ts_processed, sequence_id)``, so
        ordering is total and a replay produces the identical sequence.
        """
        for strategy in self._strategies:
            strategy.initialize()
        self._broker.connect()

        queue: list[tuple[int, int, Event]] = []

        # The counter is the tiebreaker in the heap key, so ordering is total even when two
        # events share a timestamp -- which is what makes a replay produce the identical
        # sequence rather than an arbitrary one.
        for counter, raw in enumerate(events, start=1):
            # The market-data latency model: a strategy sees an event only after the feed
            # would actually have delivered it.  Applied here so every downstream
            # component shares one definition of "now".
            delayed = raw.with_processed(raw.ts_processed + self._md_latency_ns)
            heapq.heappush(queue, (delayed.ts_processed, counter, delayed))

            # Drain everything that is definitely in the past.  Holding a small buffer lets
            # out-of-order source events be reordered without an unbounded memory cost.
            while queue and queue[0][0] <= delayed.ts_processed - self._md_latency_ns:
                _, _, event = heapq.heappop(queue)
                self._process(event)

        while queue:
            _, _, event = heapq.heappop(queue)
            self._process(event)

        self._finalise()
        return self._result

    def _process(self, event: Event) -> None:
        """One event through the whole pipeline."""
        self._result.events_processed += 1

        normalised = self._normalizer.normalize(event)
        if not normalised.is_accepted or normalised.event is None:
            return
        event = normalised.event

        instrument_id = event.instrument_id
        if instrument_id not in self._instruments:
            return

        self._staleness.observe(event)
        if isinstance(event, QuoteEvent):
            self._last_quote[instrument_id] = event

        self._roll_session(event)

        # Bars first: a bar that closes on this event must be visible to features and
        # strategies while they are handling it.
        closed_bars = self._bar_engine_for(instrument_id).on_event(event)
        self._features.on_event(event)
        for bar in closed_bars:
            self._result.bars_built += 1
            self._features.on_event(bar)
            # Regime is reclassified only on a bar close.  It is a property of the market
            # over a period; recomputing it per tick would flicker faster than a strategy
            # could act on it.
            self._regimes.on_bar_close(
                self._instruments[instrument_id],
                self._features.snapshot(instrument_id),
                bar.ts_close,
            )

        self._mark_portfolio(event)

        # Halt conditions are evaluated on every equity update, so a position drifting
        # through the daily-loss limit stops trading without a new order being attempted.
        if self._risk.check_equity_update(event.ts) and not self._result.halted:
            self._on_halt(event.ts, "equity update breached a hard limit")

        self._execution.cancel_expired(event.ts)
        self._dispatch_to_strategies(event, closed_bars)

        for fill in self._broker.advance(event):
            self._on_fill(fill)

        self._maybe_reconcile(event.ts)

    def _dispatch_to_strategies(self, event: Event, closed_bars: Sequence[BarEvent]) -> None:
        strategies = self._strategies_by_instrument.get(event.instrument_id, [])
        if not strategies:
            return

        needed = self._handler_for(event)
        snapshot = None  # built at most once per event, shared by every strategy

        for strategy in strategies:
            if not strategy.config.enabled:
                continue
            handles = self._handles[strategy.config.strategy_id]
            if needed not in handles and not (closed_bars and "on_bar" in handles):
                continue
            if snapshot is None:
                snapshot = self._features.snapshot(event.instrument_id)
                # Features must never carry information from after the event being handled.
                snapshot.require_causal(event.ts)
            context = self._build_context(strategy, event, snapshot)
            signals: list[Signal] = []
            try:
                if isinstance(event, QuoteEvent):
                    signals.extend(strategy.on_quote(event, context))
                elif isinstance(event, TradeEvent):
                    signals.extend(strategy.on_trade(event, context))
                for bar in closed_bars:
                    signals.extend(strategy.on_bar(bar, context))
            except Exception:
                # A strategy raising is a strategy whose state may be corrupt.  It is
                # logged and skipped for this event rather than aborting the run, and the
                # occurrence appears in the run's data-quality block.
                _log.exception(
                    "strategy_raised",
                    strategy_id=strategy.config.strategy_id,
                    instrument=event.instrument_id,
                    event_type=type(event).__name__,
                )
                self._result.data_quality.setdefault("strategy_errors", 0)
                self._result.data_quality["strategy_errors"] += 1
                continue

            for signal in signals:
                self._handle_signal(signal, event)

    @staticmethod
    def _handler_for(event: Event) -> str:
        if isinstance(event, QuoteEvent):
            return "on_quote"
        if isinstance(event, TradeEvent):
            return "on_trade"
        if isinstance(event, BarEvent):
            return "on_bar"
        return "on_orderbook"

    def _build_context(
        self, strategy: BaseStrategy, event: Event, snapshot: Any | None = None
    ) -> StrategyContext:
        instrument_id = event.instrument_id
        instrument = self._instruments[instrument_id]
        if snapshot is None:
            snapshot = self._features.snapshot(instrument_id)
            snapshot.require_causal(event.ts)

        position = self._portfolio.position(instrument_id)
        calendar = self._registry.calendar(instrument_id)
        return StrategyContext(
            ts=event.ts,
            instrument=instrument,
            features=snapshot,
            position=StrategyPosition(
                quantity=position.quantity,
                avg_price=position.avg_price,
                unrealized_pnl=position.unrealized_pnl,
                entry_ts=position.entry_ts,
            ),
            regime=self._regimes.current(instrument_id),
            session_open_ns=calendar.session_open_ns(event.ts) or 0,
            is_session_open=calendar.is_open(event.ts),
            last_quote=self._last_quote.get(instrument_id),
        )

    def _handle_signal(self, signal: Signal, event: Event) -> None:
        self._result.signals.append(signal.to_dict())
        market = self._market_state(signal.instrument_id, event.ts)
        decision = self._risk.evaluate(signal, market)
        self._result.risk_events.append(decision.to_dict())

        if not decision.permits_order:
            return

        result = self._execution.submit(
            signal=signal,
            decision=decision,
            quote=self._last_quote.get(signal.instrument_id),
            ts=event.ts,
        )
        if result.order is not None:
            self._result.orders.append(result.order.to_dict())

    def _market_state(self, instrument_id: str, ts: Nanos) -> MarketState:
        instrument = self._instruments[instrument_id]
        quote = self._last_quote.get(instrument_id)
        features = self._features.snapshot(instrument_id)
        atr = features.get("atr")
        calendar = self._registry.calendar(instrument_id)
        return MarketState(
            ts=ts,
            spread_ticks=(quote.spread / instrument.tick_size)
            if quote and quote.is_two_sided
            else None,
            top_of_book_size=min(quote.bid_size, quote.ask_size) if quote else None,
            atr_ticks=(atr / instrument.tick_size) if atr else None,
            staleness=self._staleness.state(instrument_id, ts),
            is_session_open=calendar.is_open(ts),
            blocked_window_reason=self._registry.is_blocked_window(instrument_id, ts),
            regime=self._regimes.current(instrument_id),
        )

    def _on_fill(self, fill: FillEvent) -> None:
        self._result.fills.append(fill.to_dict())
        order = self._execution.on_fill(fill)
        if order is not None:
            self._result.orders.append(order.to_dict())

        trade_count_before = len(self._portfolio.realized_trades)
        trade = self._portfolio.apply_fill(fill)
        if trade is not None:
            index = trade_count_before
            self._result.regime_by_trade[index] = self._regimes.current(
                fill.instrument_id
            ).value
            self._result.session_dates[index] = self._portfolio.trading_date(
                fill.instrument_id, fill.ts_fill or fill.ts
            )
            self._risk.on_trade_closed(
                fill.strategy_id or trade.strategy_id, trade.net_pnl, fill.ts_fill or fill.ts
            )

        for strategy in self._strategies_by_instrument.get(fill.instrument_id, []):
            if strategy.config.strategy_id == fill.strategy_id:
                strategy.on_fill(fill, self._build_context(strategy, fill))

    def _maybe_reconcile(self, ts: Nanos) -> None:
        """Run reconciliation when it falls due.

        In a backtest our book and the simulated venue's are derived from the same fills,
        so this should always agree — which is the point: it exercises the code path that
        will run against a real venue, and a divergence here means an accounting bug in the
        engine itself.
        """
        if self._reconciler is None or not self._reconciler.is_due(ts):
            return
        result = self._reconciler.reconcile(ts, reason="SCHEDULED")
        if result.is_clean:
            return
        self._result.risk_events.extend(e.to_dict() for e in result.risk_events)
        self._result.data_quality.setdefault("reconciliation", []).append(result.to_dict())
        if result.tripped_kill_switch and not self._result.halted:
            self._on_halt(ts, f"reconciliation: {result.critical[0].describe()}")

    def _mark_portfolio(self, event: Event) -> None:
        price: float | None = None
        if isinstance(event, QuoteEvent) and event.is_two_sided:
            price = event.mid
        elif isinstance(event, TradeEvent):
            price = event.price
        if price is not None and price > 0:
            self._portfolio.mark(event.instrument_id, price, event.ts)

    def _roll_session(self, event: Event) -> None:
        """Start a new trading date when the calendar rolls."""
        instrument_id = event.instrument_id
        trading_date = self._portfolio.trading_date(instrument_id, event.ts)
        if self._current_session.get(instrument_id) == trading_date:
            return
        self._current_session[instrument_id] = trading_date
        self._risk.start_session(trading_date)

    def _on_halt(self, ts: Nanos, reason: str) -> None:
        """Cancel working orders and stop entering.  Never resumes automatically."""
        self._result.halted = True
        self._result.halt_reason = reason
        cancelled = self._execution.cancel_all(ts, "KILL_SWITCH")
        _log.critical(
            "backtest_halted",
            run_id=self._run_id,
            reason=reason,
            cancelled_orders=cancelled,
            reason_codes=["KILL_SWITCH_ACTIVE"],
        )
        if self._risk.kill_switch.should_flatten_now():
            self._broker.flatten_all()

    def _finalise(self) -> None:
        """Close out the run: cancel working orders and record data quality."""
        last_ts = self._broker.now
        self._execution.cancel_all(last_ts, "END_OF_RUN")
        # A final pass: an engine whose book disagrees with the venue at the end of a run
        # produced a PnL figure it cannot substantiate.
        if self._reconciler is not None:
            final = self._reconciler.reconcile(last_ts, reason="END_OF_RUN")
            self._result.data_quality["final_reconciliation"] = final.to_dict()
        self._result.data_quality.update(
            {
                "validation": self._normalizer.all_counters(),
                "bar_gaps": {
                    iid: [g.to_dict() for g in engine.gaps]
                    for iid, engine in self._bar_engines.items()
                    if engine.gaps
                },
                "order_stats": self._orders.stats(),
            }
        )
        _log.info(
            "backtest_complete",
            run_id=self._run_id,
            events=self._result.events_processed,
            bars=self._result.bars_built,
            trades=len(self._portfolio.realized_trades),
            halted=self._result.halted,
        )

    @property
    def regime_engine(self) -> MarketRegimeEngine:
        return self._regimes

    @property
    def result(self) -> BacktestResult:
        return self._result
