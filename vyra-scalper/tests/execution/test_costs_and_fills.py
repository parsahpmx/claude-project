"""Transaction costs and fill realism.

The tests that matter most here are the negative ones: a limit order that must *not* fill,
and a stop that must *not* fill at its stop price when the market gapped.
"""

from __future__ import annotations

import pytest

from core.events import FillModel, OrderType, QuoteEvent, Side, TradeEvent
from core.execution.costs import (
    CommissionModel,
    CommissionType,
    CostModel,
    LatencyModel,
    MarketImpactModel,
    SlippageModel,
    SlippageType,
)
from core.execution.fills import FillSimulator, MarketSnapshot
from core.instruments.instrument import Instrument


def quote(bid: float, ask: float, size: float = 10.0) -> QuoteEvent:
    return QuoteEvent("CME:MES", "CME", 0, 0, 1, 1, "T",
                      bid=bid, ask=ask, bid_size=size, ask_size=size)


def trade(price: float, size: float) -> TradeEvent:
    return TradeEvent("CME:MES", "CME", 0, 0, 1, 1, "T", price=price, size=size)


class TestCommission:
    def test_per_unit_scales_with_quantity(self, mes: Instrument) -> None:
        model = CommissionModel(CommissionType.PER_UNIT, amount=0.62)
        assert model.compute(mes, 10, 5100.0) == pytest.approx(6.2)

    def test_a_minimum_applies_to_small_orders(self, aapl: Instrument) -> None:
        model = CommissionModel(CommissionType.PER_UNIT, amount=0.005, minimum=1.0)
        assert model.compute(aapl, 10, 190.0) == 1.0
        assert model.compute(aapl, 500, 190.0) == pytest.approx(2.5)

    def test_notional_bps(self, xauusd: Instrument) -> None:
        model = CommissionModel(CommissionType.NOTIONAL_BPS, amount=2.0)
        # 1 lot at 2050 with multiplier 100 = 205,000 notional; 2 bps = 41.
        assert model.compute(xauusd, 1.0, 2050.0) == pytest.approx(41.0)

    def test_zero_quantity_costs_nothing(self, mes: Instrument) -> None:
        assert CommissionModel(CommissionType.PER_UNIT, 0.62).compute(mes, 0, 5100.0) == 0.0


class TestCostAttribution:
    def test_every_component_is_reported_separately(
        self, mes: Instrument, config_bundle
    ) -> None:
        """Spread must not be able to hide inside slippage, nor slippage inside commission."""
        model = CostModel.from_config(config_bundle["execution"])
        cost = model.compute(mes, 10, 5100.0, spread=0.25, atr=3.0, reference_volume=5000.0)
        assert cost.commission > 0
        assert cost.exchange_fees > 0
        assert cost.spread_cost > 0
        assert cost.slippage_cost > 0
        assert cost.total == pytest.approx(
            cost.commission + cost.exchange_fees + cost.spread_cost
            + cost.slippage_cost + cost.impact_cost
        )
        assert cost.explicit + cost.implicit == pytest.approx(cost.total)

    def test_a_passive_fill_pays_no_spread(self, mes: Instrument, config_bundle) -> None:
        """Earning the spread rather than paying it is the point of resting an order."""
        model = CostModel.from_config(config_bundle["execution"])
        aggressive = model.compute(mes, 10, 5100.0, spread=0.25, crossed_spread=True)
        passive = model.compute(mes, 10, 5100.0, spread=0.25, crossed_spread=False)
        assert aggressive.spread_cost > 0
        assert passive.spread_cost == 0.0


class TestSlippage:
    def test_spread_fraction_scales_with_the_spread(self, mes: Instrument) -> None:
        model = SlippageModel(SlippageType.SPREAD_FRACTION, spread_fraction=0.5)
        narrow = model.ticks(mes, spread=0.25)
        wide = model.ticks(mes, spread=1.00)
        assert wide == pytest.approx(4 * narrow)

    def test_slippage_is_never_negative(self, mes: Instrument) -> None:
        """Slippage in your favour is not slippage; it is a modelling error."""
        import random

        model = SlippageModel(SlippageType.SPREAD_FRACTION, spread_fraction=0.5)
        rng = random.Random(7)
        for _ in range(200):
            assert model.ticks(mes, spread=0.25, rng=rng) >= 0.0

    def test_volatility_scaled_grows_with_participation(self, mes: Instrument) -> None:
        model = SlippageModel(SlippageType.VOLATILITY_SCALED, volatility_coefficient=0.1)
        small = model.ticks(mes, spread=0.25, atr=3.0, participation=0.01)
        large = model.ticks(mes, spread=0.25, atr=3.0, participation=0.25)
        assert large > small


class TestMarketImpact:
    def test_impact_applies_only_above_the_participation_threshold(
        self, mes: Instrument
    ) -> None:
        model = MarketImpactModel(coefficient=0.1, threshold_participation=0.01)
        assert model.ticks(mes, 1, reference_volume=100_000, atr=3.0) == 0.0
        assert model.ticks(mes, 500, reference_volume=1_000, atr=3.0) > 0.0

    def test_impact_follows_a_square_root_law(self, mes: Instrument) -> None:
        model = MarketImpactModel(coefficient=0.1, threshold_participation=0.0)
        one = model.ticks(mes, 100, reference_volume=1_000, atr=3.0)
        four = model.ticks(mes, 400, reference_volume=1_000, atr=3.0)
        assert four == pytest.approx(2 * one)

    def test_unknown_volume_yields_no_impact(self, mes: Instrument) -> None:
        """A known optimism, surfaced rather than hidden."""
        model = MarketImpactModel()
        assert model.ticks(mes, 100, reference_volume=None, atr=3.0) == 0.0


class TestLatency:
    def test_defaults_are_non_zero(self) -> None:
        """A strategy that only works at zero latency must fail visibly."""
        model = LatencyModel()
        assert model.order_ns() > 0
        assert model.market_data_ns() > 0
        assert not model.is_idealised

    def test_zero_latency_is_recognised_as_idealised(self) -> None:
        assert LatencyModel(0, 0, 0, 0, 0).is_idealised


class TestLimitOrderRealism:
    """A limit order does not fill just because the price printed at its level."""

    @pytest.fixture
    def snapshot_touch(self) -> MarketSnapshot:
        return MarketSnapshot(quote(5100.25, 5100.50), trade(5100.00, 1.0))

    @pytest.fixture
    def snapshot_through(self) -> MarketSnapshot:
        return MarketSnapshot(quote(5100.25, 5100.50), trade(5099.75, 50.0))

    def test_optimistic_fills_on_a_touch(
        self, mes: Instrument, snapshot_touch: MarketSnapshot
    ) -> None:
        sim = FillSimulator(FillModel.OPTIMISTIC, seed=1)
        assert sim.match(mes, Side.BUY, OrderType.LIMIT, 2, 5100.00, None, snapshot_touch).filled

    def test_realistic_refuses_a_touch_without_queue_clearing_volume(
        self, mes: Instrument, snapshot_touch: MarketSnapshot
    ) -> None:
        sim = FillSimulator(FillModel.REALISTIC, queue_ratio=1.0, seed=1)
        decision = sim.match(mes, Side.BUY, OrderType.LIMIT, 2, 5100.00, None, snapshot_touch)
        assert not decision.filled
        assert decision.reason == "QUEUE_NOT_CLEARED"

    def test_realistic_fills_on_trade_through(
        self, mes: Instrument, snapshot_through: MarketSnapshot
    ) -> None:
        sim = FillSimulator(FillModel.REALISTIC, seed=1)
        decision = sim.match(mes, Side.BUY, OrderType.LIMIT, 2, 5100.00, None, snapshot_through)
        assert decision.filled
        assert decision.price == 5100.00
        assert not decision.crossed_spread  # a passive fill earns the spread

    def test_conservative_requires_trade_through_by_a_full_tick(
        self, mes: Instrument, snapshot_touch: MarketSnapshot
    ) -> None:
        sim = FillSimulator(FillModel.CONSERVATIVE, seed=1)
        decision = sim.match(mes, Side.BUY, OrderType.LIMIT, 2, 5100.00, None, snapshot_touch)
        assert not decision.filled
        assert decision.reason == "INSUFFICIENT_TRADE_THROUGH"

    def test_a_marketable_limit_fills_at_the_touch_and_pays_the_spread(
        self, mes: Instrument
    ) -> None:
        sim = FillSimulator(FillModel.REALISTIC, seed=1)
        snapshot = MarketSnapshot(quote(5100.00, 5100.25))
        decision = sim.match(mes, Side.BUY, OrderType.LIMIT, 2, 5100.50, None, snapshot)
        assert decision.filled
        assert decision.price == 5100.25
        assert decision.crossed_spread


class TestStopOrderRealism:
    def test_a_gap_through_a_stop_fills_at_the_gap_price(self, mes: Instrument) -> None:
        """Filling at the stop is how a backtest manufactures money."""
        sim = FillSimulator(FillModel.REALISTIC, seed=1)
        snapshot = MarketSnapshot(quote(5085.00, 5085.25), trade(5085.00, 10.0))
        decision = sim.match(mes, Side.SELL, OrderType.STOP, 2, None, 5095.00, snapshot)
        assert decision.filled
        assert decision.price == 5085.00, "the stop filled at its own price despite a gap"

    def test_an_untriggered_stop_does_not_fill(self, mes: Instrument) -> None:
        sim = FillSimulator(FillModel.REALISTIC, seed=1)
        snapshot = MarketSnapshot(quote(5100.00, 5100.25), trade(5100.00, 10.0))
        decision = sim.match(mes, Side.SELL, OrderType.STOP, 2, None, 5095.00, snapshot)
        assert not decision.filled
        assert decision.reason == "STOP_NOT_TRIGGERED"


class TestPartialFills:
    def test_a_partial_is_always_a_legal_quantity(self, mes: Instrument) -> None:
        """A venue cannot execute 0.76 of a futures contract."""
        sim = FillSimulator(FillModel.REALISTIC, partial_fill_probability=1.0, seed=3)
        snapshot = MarketSnapshot(quote(5100.00, 5100.25))
        for qty in (2, 5, 10, 20):
            decision = sim.match(mes, Side.BUY, OrderType.MARKET, qty, None, None, snapshot)
            assert decision.quantity == int(decision.quantity)
            assert decision.quantity > 0

    def test_fractional_instruments_respect_their_step(self, xauusd: Instrument) -> None:
        sim = FillSimulator(FillModel.REALISTIC, partial_fill_probability=1.0, seed=3)
        snapshot = MarketSnapshot(
            QuoteEvent("CFD:XAUUSD", "X", 0, 0, 1, 1, "T",
                       bid=2050.0, ask=2050.5, bid_size=10, ask_size=10)
        )
        decision = sim.match(xauusd, Side.BUY, OrderType.MARKET, 1.0, None, None, snapshot)
        assert abs(round(decision.quantity / 0.01) * 0.01 - decision.quantity) < 1e-9


class TestVenueRejection:
    def test_a_spread_beyond_the_instrument_limit_is_rejected(self, mes: Instrument) -> None:
        """A venue in that state is not one where an order behaves normally."""
        sim = FillSimulator(FillModel.REALISTIC, seed=1)
        assert sim.should_reject(mes, MarketSnapshot(quote(5100.00, 5102.00))) == (
            "SPREAD_BEYOND_LIMIT"
        )

    def test_a_normal_spread_is_not_rejected(self, mes: Instrument) -> None:
        sim = FillSimulator(FillModel.REALISTIC, reject_rate=0.0, seed=1)
        assert sim.should_reject(mes, MarketSnapshot(quote(5100.00, 5100.25))) is None

    def test_the_configured_reject_rate_is_honoured(self, mes: Instrument) -> None:
        sim = FillSimulator(FillModel.REALISTIC, reject_rate=0.5, seed=11)
        snapshot = MarketSnapshot(quote(5100.00, 5100.25))
        rejects = sum(1 for _ in range(400) if sim.should_reject(mes, snapshot))
        assert 150 < rejects < 250, f"expected roughly half of 400, got {rejects}"
