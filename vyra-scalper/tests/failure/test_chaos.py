"""Fault injection.

Simulates the conditions §28 requires: disconnects, duplicate and out-of-order events,
stale data, rejections, partial fills, gaps and extreme volatility. Each test asserts the
platform fails *safely* — refusing to trade, halting, or recording the fault — rather than
producing a plausible-looking number.
"""

from __future__ import annotations

from datetime import date

import pytest

from core.brokers.base import BrokerError, BrokerErrorCode, OrderRequest
from core.brokers.simulated import SimulatedBrokerAdapter
from core.events import (
    DataFlag,
    FillModel,
    OrderType,
    QuoteEvent,
    Side,
    StalenessState,
    Timeframe,
    TradeEvent,
)
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.instruments.registry import InstrumentRegistry
from core.market_data.bars import BarEngine
from core.market_data.normalization import DropReason, Normalizer
from core.market_data.staleness import StalenessGate, StalenessThresholds
from core.portfolio.portfolio import Portfolio
from core.risk.engine import MarketState, RiskAction, RiskEngine
from core.risk.kill_switch import EmergencyPolicy, KillSwitch, Trigger
from core.risk.limits import RiskLimits
from core.risk.reasons import Reason
from core.signals.signal import EntryType, Signal, SignalIntent
from core.util.clock import NS_PER_MIN, NS_PER_SEC, from_iso

TS = from_iso("2024-03-05T15:00:00Z")


@pytest.fixture
def normalizer(registry: InstrumentRegistry) -> Normalizer:
    return Normalizer({i: registry.get(i) for i in registry.ids()})


def quote(seq: int, bid: float = 5100.00, ask: float = 5100.25, ts: int = TS,
          size: float = 10.0) -> QuoteEvent:
    return QuoteEvent("CME:MES", "CME", ts, ts, ts, seq, "TEST",
                      bid=bid, ask=ask, bid_size=size, ask_size=size)


class TestDuplicateAndOutOfOrderEvents:
    def test_a_duplicate_event_is_dropped_and_counted(self, normalizer: Normalizer) -> None:
        assert normalizer.normalize(quote(1)).is_accepted
        repeat = normalizer.normalize(quote(1))
        assert not repeat.is_accepted
        assert repeat.dropped == DropReason.DUPLICATE
        assert normalizer.counters("CME:MES").drops_by_reason["DUPLICATE"] == 1

    def test_an_out_of_order_event_is_flagged_not_silently_accepted(
        self, normalizer: Normalizer
    ) -> None:
        normalizer.normalize(quote(1, ts=TS))
        late = normalizer.normalize(quote(2, ts=TS - NS_PER_SEC))
        assert late.is_accepted
        assert late.event is not None
        assert DataFlag.OUT_OF_ORDER in late.event.flags

    def test_strict_mode_drops_out_of_order_events(self, registry: InstrumentRegistry) -> None:
        strict = Normalizer(
            {i: registry.get(i) for i in registry.ids()}, strict_ordering=True
        )
        strict.normalize(quote(1, ts=TS))
        assert not strict.normalize(quote(2, ts=TS - NS_PER_SEC)).is_accepted


class TestMalformedData:
    def test_a_crossed_book_is_flagged_and_still_delivered(
        self, normalizer: Normalizer
    ) -> None:
        """Dropping it would destroy the evidence of a degraded feed."""
        result = normalizer.normalize(quote(1, bid=5100.50, ask=5100.25))
        assert result.is_accepted
        assert result.event is not None
        assert DataFlag.CROSSED_BOOK in result.event.flags

    def test_a_negative_size_is_dropped(self, normalizer: Normalizer) -> None:
        result = normalizer.normalize(quote(1, size=-5.0))
        assert not result.is_accepted
        assert result.dropped == DropReason.NEGATIVE_SIZE

    def test_a_non_positive_price_is_dropped(self, normalizer: Normalizer) -> None:
        result = normalizer.normalize(
            TradeEvent("CME:MES", "CME", TS, TS, TS, 1, "T", price=0.0, size=1.0)
        )
        assert not result.is_accepted
        assert result.dropped == DropReason.NON_POSITIVE_PRICE

    def test_an_off_tick_price_is_flagged(self, normalizer: Normalizer) -> None:
        result = normalizer.normalize(quote(1, bid=5100.13))
        assert result.event is not None
        assert DataFlag.OFF_TICK in result.event.flags

    def test_a_price_spike_is_flagged_not_removed(self, normalizer: Normalizer) -> None:
        """Real markets gap; deleting the gap teaches a strategy that stops always fill."""
        normalizer.normalize(
            TradeEvent("CME:MES", "CME", TS, TS, TS, 1, "T", price=5100.0, size=1.0)
        )
        spike = normalizer.normalize(
            TradeEvent("CME:MES", "CME", TS, TS, TS, 2, "T", price=5400.0, size=1.0)
        )
        assert spike.is_accepted
        assert spike.event is not None
        assert DataFlag.PRICE_SPIKE in spike.event.flags

    def test_all_faults_are_counted_for_the_report(self, normalizer: Normalizer) -> None:
        normalizer.normalize(quote(1))
        normalizer.normalize(quote(1))
        normalizer.normalize(quote(2, size=-1.0))
        counters = normalizer.counters("CME:MES")
        assert counters.total == 3
        assert counters.drop_rate == pytest.approx(2 / 3)


class TestStaleData:
    @pytest.fixture
    def gate(self) -> StalenessGate:
        return StalenessGate(default=StalenessThresholds(500.0, 2_000.0, 10_000.0))

    def test_freshness_degrades_with_age(self, gate: StalenessGate) -> None:
        gate.observe(quote(1, ts=TS))
        assert gate.state("CME:MES", TS) is StalenessState.FRESH
        assert gate.state("CME:MES", TS + 1_000 * 1_000_000) is StalenessState.WARN
        assert gate.state("CME:MES", TS + 5_000 * 1_000_000) is StalenessState.STALE
        assert gate.state("CME:MES", TS + 30_000 * 1_000_000) is StalenessState.DEAD

    def test_stale_blocks_trading_and_warn_does_not(self, gate: StalenessGate) -> None:
        gate.observe(quote(1, ts=TS))
        assert gate.is_tradeable("CME:MES", TS + 1_000 * 1_000_000)
        assert not gate.is_tradeable("CME:MES", TS + 5_000 * 1_000_000)

    def test_an_unseen_instrument_is_stale_not_fresh(self, gate: StalenessGate) -> None:
        assert gate.state("NEVER:SEEN", TS) is StalenessState.STALE

    def test_an_out_of_order_quote_cannot_make_the_feed_look_fresher(
        self, gate: StalenessGate
    ) -> None:
        gate.observe(quote(1, ts=TS))
        gate.observe(quote(2, ts=TS - 60 * NS_PER_SEC))
        assert gate.age_ns("CME:MES", TS) == 0

    def test_a_closed_venue_is_not_reported_as_stale(
        self, registry: InstrumentRegistry
    ) -> None:
        """Otherwise the kill switch would trip every evening."""
        gate = StalenessGate(
            default=StalenessThresholds(500.0, 2_000.0, 10_000.0),
            calendars={"CME:MES": registry.calendar("CME:MES")},
        )
        gate.observe(quote(1, ts=TS))
        saturday = from_iso("2024-03-16T18:00:00Z")
        assert gate.state("CME:MES", saturday) is StalenessState.FRESH


class TestBrokerFailures:
    @pytest.fixture
    def broker(self, registry: InstrumentRegistry, config_bundle) -> SimulatedBrokerAdapter:
        broker = SimulatedBrokerAdapter(
            {i: registry.get(i) for i in registry.ids()},
            CostModel.from_config(config_bundle["execution"]),
            FillSimulator(FillModel.REALISTIC, seed=1),
        )
        broker.connect()
        return broker

    def test_a_disconnect_refuses_operations_rather_than_returning_stale_state(
        self, broker: SimulatedBrokerAdapter
    ) -> None:
        broker.disconnect()
        for call in (broker.get_account, broker.get_positions, broker.get_orders):
            with pytest.raises(BrokerError) as exc:
                call()
            assert exc.value.code is BrokerErrorCode.NOT_CONNECTED

    def test_a_high_reject_rate_is_observable(
        self, registry: InstrumentRegistry, config_bundle
    ) -> None:
        broker = SimulatedBrokerAdapter(
            {i: registry.get(i) for i in registry.ids()},
            CostModel.from_config(config_bundle["execution"]),
            FillSimulator(FillModel.REALISTIC, reject_rate=1.0, seed=1),
        )
        broker.connect()
        broker.advance(quote(1))
        ack = broker.submit_order(
            OrderRequest("c1", "CME:MES", Side.BUY, 1.0, OrderType.MARKET)
        )
        assert not ack.accepted
        assert ack.error_code is BrokerErrorCode.VENUE_REJECT


class TestMarketGapsAndVolatility:
    def test_a_market_gap_produces_one_bar_and_a_recorded_gap(self) -> None:
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        engine.on_event(TradeEvent("CME:MES", "CME", TS, TS, TS, 1, "T",
                                   price=5100.0, size=1.0))
        closed = engine.on_event(
            TradeEvent("CME:MES", "CME", TS + 10 * NS_PER_MIN, TS + 10 * NS_PER_MIN,
                       TS + 10 * NS_PER_MIN, 2, "T", price=5000.0, size=1.0)
        )
        assert len(closed) == 1
        assert engine.gaps and engine.gaps[0].periods_missing == 9

    def test_extreme_volatility_blocks_trading_via_the_atr_band(
        self, registry: InstrumentRegistry, config_bundle
    ) -> None:
        instruments = {i: registry.get(i) for i in registry.ids()}
        portfolio = Portfolio(100_000.0, instruments,
                              {i: registry.calendar(i) for i in registry.ids()})
        portfolio.start_session(date(2024, 3, 5))
        engine = RiskEngine(
            RiskLimits.from_config(config_bundle["risk"]), portfolio, registry,
            KillSwitch(EmergencyPolicy.HOLD, 0),
        )
        signal = Signal("s1", "vwap", "CME:MES", Side.BUY, SignalIntent.ENTER, TS,
                        EntryType.MARKET, 5100.0, 5095.0)
        decision = engine.evaluate(signal, MarketState(ts=TS, atr_ticks=100_000.0))
        assert decision.action is RiskAction.REJECT
        assert decision.reason_codes == (Reason.VOLATILITY_LIMIT,)


class TestRiskServiceFailure:
    def test_a_failing_check_rejects_rather_than_approving(
        self, registry: InstrumentRegistry, config_bundle, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Fail-closed: an engine that cannot evaluate does not approve."""
        instruments = {i: registry.get(i) for i in registry.ids()}
        portfolio = Portfolio(100_000.0, instruments,
                              {i: registry.calendar(i) for i in registry.ids()})
        portfolio.start_session(date(2024, 3, 5))
        engine = RiskEngine(
            RiskLimits.from_config(config_bundle["risk"]), portfolio, registry,
            KillSwitch(EmergencyPolicy.HOLD, 0),
        )

        def boom(*args: object, **kwargs: object) -> bool:
            raise RuntimeError("risk service unavailable")

        monkeypatch.setattr(RiskEngine, "_daily_loss_exceeded", boom)
        signal = Signal("s1", "vwap", "CME:MES", Side.BUY, SignalIntent.ENTER, TS,
                        EntryType.MARKET, 5100.0, 5095.0)
        decision = engine.evaluate(signal, MarketState(ts=TS))
        assert decision.action is RiskAction.REJECT
        assert decision.reason_codes == (Reason.RISK_CHECK_ERROR,)

    def test_an_unreadable_kill_switch_state_file_blocks_trading(self, tmp_path) -> None:
        path = tmp_path / "ks.json"
        path.write_text("{corrupted")
        switch = KillSwitch(EmergencyPolicy.HOLD, 0, path)
        assert switch.is_tripped
        assert not switch.allows_new_entries()


class TestUnknownPosition:
    def test_an_unknown_position_is_a_kill_switch_trigger(self) -> None:
        switch = KillSwitch(EmergencyPolicy.HOLD, 0)
        switch.trip(Trigger.UNKNOWN_POSITION, "broker reported a position we do not know",
                    ts=TS)
        assert switch.is_tripped
        assert not switch.allows_new_entries()

    def test_a_fill_for_an_unknown_order_is_surfaced_not_absorbed(
        self, registry: InstrumentRegistry, config_bundle
    ) -> None:
        from core.events import FillEvent
        from core.execution.engine import ExecutionEngine
        from core.execution.order_manager import OrderManager

        instruments = {i: registry.get(i) for i in registry.ids()}
        broker = SimulatedBrokerAdapter(
            instruments, CostModel.from_config(config_bundle["execution"]),
            FillSimulator(FillModel.REALISTIC, seed=1),
        )
        engine = ExecutionEngine(broker, OrderManager("r"), instruments,
                                 KillSwitch(EmergencyPolicy.HOLD, 0))
        orphan = FillEvent("CME:MES", "CME", 0, 0, TS, 1, "SIM",
                           client_order_id="never-created", side=Side.BUY,
                           quantity=1.0, price=5100.0)
        assert engine.on_fill(orphan) is None  # reported, never silently applied
