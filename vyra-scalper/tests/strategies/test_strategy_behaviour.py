"""Each strategy fires under its own thesis, and refuses when a condition is absent.

The universal suite proves the gates work. These prove the strategies are not merely inert
— a strategy that never signals would pass every invariant test in the platform.
"""

from __future__ import annotations

import pytest

from core.config.loader import ConfigBundle
from core.events import Regime, Side, Timeframe
from core.instruments.registry import InstrumentRegistry
from core.signals.signal import SignalIntent
from core.strategies.liquidity_sweep import LiquiditySweepStrategy
from core.strategies.microstructure_scalper import MicrostructureScalperStrategy
from core.strategies.momentum_breakout import MomentumBreakoutStrategy
from core.strategies.opening_range_breakout import OpeningRangeBreakoutStrategy
from core.strategies.order_flow_imbalance import OrderFlowImbalanceStrategy
from core.strategies.trend_pullback import TrendPullbackStrategy
from core.util.clock import NS_PER_MIN
from tests.strategies.conftest import TS, build_strategy, make_bar, make_context


@pytest.fixture
def mes_instrument(registry: InstrumentRegistry):
    return registry.get("CME:MES")


class TestMomentumBreakout:
    @pytest.fixture
    def strategy(self, config_bundle: ConfigBundle, mes_instrument):
        return build_strategy(
            MomentumBreakoutStrategy, "momentum_breakout", config_bundle, mes_instrument,
            regimes=(Regime.BREAKOUT, Regime.TRENDING_UP, Regime.TRENDING_DOWN),
        )

    def base(self) -> dict[str, float]:
        return {
            "range_high": 5100.0, "range_low": 5080.0, "atr": 3.0,
            "last_close": 5100.0, "last_volume": 300.0, "avg_volume": 100.0,
            "mid": 5100.0, "spread_ticks": 1.0, "swing_trend": 1.0,
        }

    def test_a_clean_break_above_fires_long(self, strategy, mes_instrument) -> None:
        ctx = make_context(
            mes_instrument, self.base() | {"last_close": 5105.0, "mid": 5105.0},
            regime=Regime.BREAKOUT,
        )
        signals = strategy.generate_signal(ctx)
        assert len(signals) == 1
        assert signals[0].direction is Side.BUY
        assert "RANGE_BREAKOUT" in signals[0].reason_codes

    def test_a_clean_break_below_fires_short(self, strategy, mes_instrument) -> None:
        ctx = make_context(
            mes_instrument, self.base() | {"last_close": 5075.0, "mid": 5075.0},
            regime=Regime.BREAKOUT,
        )
        assert strategy.generate_signal(ctx)[0].direction is Side.SELL

    def test_price_inside_the_range_does_not_fire(self, strategy, mes_instrument) -> None:
        ctx = make_context(
            mes_instrument, self.base() | {"last_close": 5090.0, "mid": 5090.0},
            regime=Regime.BREAKOUT,
        )
        assert strategy.generate_signal(ctx) == []

    def test_a_break_without_volume_does_not_fire(self, strategy, mes_instrument) -> None:
        """A break on no volume is nobody's decision."""
        ctx = make_context(
            mes_instrument,
            self.base() | {"last_close": 5105.0, "mid": 5105.0, "last_volume": 50.0},
            regime=Regime.BREAKOUT,
        )
        assert strategy.generate_signal(ctx) == []

    def test_a_break_inside_the_buffer_does_not_fire(self, strategy, mes_instrument) -> None:
        """Noise at the boundary is not a break."""
        ctx = make_context(
            mes_instrument, self.base() | {"last_close": 5100.10, "mid": 5100.10},
            regime=Regime.BREAKOUT,
        )
        assert strategy.generate_signal(ctx) == []


class TestTrendPullback:
    @pytest.fixture
    def strategy(self, config_bundle: ConfigBundle, mes_instrument):
        return build_strategy(
            TrendPullbackStrategy, "trend_pullback", config_bundle, mes_instrument,
            timeframe=Timeframe.M5,
            regimes=(Regime.TRENDING_UP, Regime.TRENDING_DOWN),
        )

    def base(self) -> dict[str, float]:
        return {
            "ema_fast": 5100.0, "ema_slow": 5090.0, "atr": 4.0, "last_close": 5101.0,
            "mid": 5101.0, "swing_trend": 1.0, "spread_ticks": 1.0,
        }

    def test_a_shallow_pullback_in_an_uptrend_fires_long(
        self, strategy, mes_instrument
    ) -> None:
        ctx = make_context(
            mes_instrument, self.base(), regime=Regime.TRENDING_UP, timeframe=Timeframe.M5
        )
        signals = strategy.generate_signal(ctx)
        assert len(signals) == 1
        assert signals[0].direction is Side.BUY
        assert "TREND_PULLBACK" in signals[0].reason_codes

    def test_a_deep_retracement_is_a_reversal_not_a_pullback(
        self, strategy, mes_instrument
    ) -> None:
        ctx = make_context(
            mes_instrument,
            self.base() | {"last_close": 5088.0, "mid": 5088.0},
            regime=Regime.TRENDING_UP, timeframe=Timeframe.M5,
        )
        assert strategy.generate_signal(ctx) == []

    def test_structure_disagreeing_with_the_emas_blocks_entry(
        self, strategy, mes_instrument
    ) -> None:
        ctx = make_context(
            mes_instrument, self.base() | {"swing_trend": -1.0},
            regime=Regime.TRENDING_UP, timeframe=Timeframe.M5,
        )
        assert strategy.generate_signal(ctx) == []

    def test_a_downtrend_pullback_fires_short(self, strategy, mes_instrument) -> None:
        ctx = make_context(
            mes_instrument,
            {"ema_fast": 5090.0, "ema_slow": 5100.0, "atr": 4.0, "last_close": 5089.0,
             "mid": 5089.0, "swing_trend": -1.0, "spread_ticks": 1.0},
            regime=Regime.TRENDING_DOWN, timeframe=Timeframe.M5,
        )
        assert strategy.generate_signal(ctx)[0].direction is Side.SELL

    def test_the_parameter_ordering_is_validated(
        self, config_bundle: ConfigBundle, mes_instrument
    ) -> None:
        from tests.strategies.conftest import shipped_params

        params = shipped_params(config_bundle, "trend_pullback")
        params["max_pullback_atr_multiple"] = params["pullback_atr_multiple"]
        with pytest.raises(ValueError, match="must exceed"):
            build_strategy(
                TrendPullbackStrategy, "trend_pullback", config_bundle, mes_instrument,
                params=params,
            )


class TestOpeningRangeBreakout:
    @pytest.fixture
    def strategy(self, config_bundle: ConfigBundle, mes_instrument):
        return build_strategy(
            OpeningRangeBreakoutStrategy, "opening_range_breakout", config_bundle,
            mes_instrument, regimes=(Regime.BREAKOUT,),
        )

    def base(self) -> dict[str, float]:
        return {
            "opening_range_high": 5100.0, "opening_range_low": 5090.0, "atr": 3.0,
            "last_close": 5103.0, "mid": 5103.0, "last_volume": 200.0,
            "avg_volume": 100.0, "spread_ticks": 1.0,
        }

    def test_a_break_after_the_range_completes_fires(self, strategy, mes_instrument) -> None:
        ctx = make_context(
            mes_instrument, self.base(), regime=Regime.BREAKOUT,
            ts=TS, session_open_ns=TS - 30 * NS_PER_MIN,
        )
        signals = strategy.generate_signal(ctx)
        assert len(signals) == 1
        assert "OPENING_RANGE_BREAKOUT" in signals[0].reason_codes

    def test_a_break_before_the_range_completes_does_not_fire(
        self, strategy, mes_instrument
    ) -> None:
        """The range would be redefined by the very bar being traded."""
        ctx = make_context(
            mes_instrument, self.base(), regime=Regime.BREAKOUT,
            ts=TS, session_open_ns=TS - 5 * NS_PER_MIN,
        )
        assert strategy.generate_signal(ctx) == []

    def test_only_one_trade_per_session(self, strategy, mes_instrument) -> None:
        """A repeated break of the same level is the range failing, not the thesis."""
        ctx = make_context(
            mes_instrument, self.base(), regime=Regime.BREAKOUT,
            ts=TS, session_open_ns=TS - 30 * NS_PER_MIN,
        )
        assert strategy.generate_signal(ctx)
        assert strategy.generate_signal(ctx) == []

    def test_a_new_session_resets_the_limit(self, strategy, mes_instrument) -> None:
        first = make_context(
            mes_instrument, self.base(), regime=Regime.BREAKOUT,
            ts=TS, session_open_ns=TS - 30 * NS_PER_MIN,
        )
        assert strategy.generate_signal(first)
        next_session = make_context(
            mes_instrument, self.base(), regime=Regime.BREAKOUT,
            ts=TS + 24 * 60 * NS_PER_MIN,
            session_open_ns=TS + 23 * 60 * NS_PER_MIN,
        )
        assert strategy.generate_signal(next_session)


class TestLiquiditySweep:
    @pytest.fixture
    def strategy(self, config_bundle: ConfigBundle, mes_instrument):
        return build_strategy(
            LiquiditySweepStrategy, "liquidity_sweep", config_bundle, mes_instrument,
            regimes=(Regime.RANGE, Regime.REVERSAL),
        )

    def features(self, close: float) -> dict[str, float]:
        return {
            "session_high": 5110.0, "session_low": 5090.0,
            "prev_session_high": 5115.0, "prev_session_low": 5085.0,
            "atr": 3.0, "last_close": close, "mid": close,
            "spread_ticks": 1.0, "trade_imbalance": -0.5,
        }

    def test_a_sweep_reclaimed_on_its_own_bar_fires_short(
        self, strategy, mes_instrument
    ) -> None:
        """A bar that pokes above the level and closes back inside is a single-bar sweep."""
        sweep_bar = make_bar(mes_instrument, ts=TS, high=5112.0, low=5105.0, close=5108.0)
        ctx = make_context(mes_instrument, self.features(5108.0), regime=Regime.RANGE, ts=TS)
        signals = strategy.on_bar(sweep_bar, ctx)
        assert len(signals) == 1
        assert signals[0].direction is Side.SELL
        assert "LIQUIDITY_SWEEP" in signals[0].reason_codes

    def test_a_sweep_reclaimed_on_a_later_bar_fires_short(
        self, strategy, mes_instrument
    ) -> None:
        """The multi-bar path: the bar closes beyond the level, the next one reclaims."""
        sweep_bar = make_bar(mes_instrument, ts=TS, high=5112.0, low=5109.0, close=5111.0)
        held = make_context(mes_instrument, self.features(5111.0), regime=Regime.RANGE, ts=TS)
        assert strategy.on_bar(sweep_bar, held) == []   # swept, not yet reclaimed

        reclaim_bar = make_bar(
            mes_instrument, ts=TS + NS_PER_MIN, high=5111.0, low=5106.0, close=5107.0
        )
        reclaim = make_context(
            mes_instrument, self.features(5107.0), regime=Regime.RANGE, ts=TS + NS_PER_MIN
        )
        signals = strategy.on_bar(reclaim_bar, reclaim)
        assert len(signals) == 1
        assert signals[0].direction is Side.SELL

    def test_a_break_that_never_reclaims_does_not_fire(self, strategy, mes_instrument) -> None:
        """Without the reclaim this is a breakout strategy positioned backwards."""
        sweep_bar = make_bar(
            mes_instrument, ts=TS, high=5112.0, low=5109.0, close=5111.0
        )
        ctx = make_context(mes_instrument, self.features(5111.0), regime=Regime.RANGE, ts=TS)
        assert strategy.on_bar(sweep_bar, ctx) == []

        # Price stays above the level for longer than reclaim_bars.
        for i in range(1, 6):
            ts = TS + i * NS_PER_MIN
            held = make_context(
                mes_instrument, self.features(5113.0), regime=Regime.RANGE, ts=ts
            )
            bar = make_bar(
                mes_instrument, ts=ts, high=5114.0, low=5112.0, close=5113.0
            )
            assert strategy.on_bar(bar, held) == []

    def test_the_stop_sits_beyond_the_swept_extreme(self, strategy, mes_instrument) -> None:
        """An ATR stop inside the wick would be taken out by the setup's own noise."""
        sweep_bar = make_bar(mes_instrument, ts=TS, high=5112.0, low=5105.0, close=5108.0)
        ctx = make_context(mes_instrument, self.features(5108.0), regime=Regime.RANGE, ts=TS)
        signal = strategy.on_bar(sweep_bar, ctx)[0]
        assert signal.suggested_stop > 5112.0


class TestOrderFlowImbalance:
    @pytest.fixture
    def strategy(self, config_bundle: ConfigBundle, mes_instrument):
        return build_strategy(
            OrderFlowImbalanceStrategy, "order_flow_imbalance", config_bundle,
            mes_instrument, timeframe=Timeframe.S15,
            regimes=(Regime.RANGE, Regime.BREAKOUT, Regime.HIGH_VOLATILITY),
            requires_depth=True,
        )

    def base(self) -> dict[str, float]:
        return {
            "atr": 3.0, "last_close": 5100.0,
            "exch.trade_imbalance": 0.8, "exch.depth_imbalance": 0.5,
            "exch.spread_ticks": 1.0, "exch.bid_liquidity": 100.0,
            "exch.ask_liquidity": 100.0, "exch.mid": 5100.0,
        }

    def context(self, instrument, values):
        return make_context(
            instrument, values, regime=Regime.RANGE, timeframe=Timeframe.S15
        )

    def test_strong_buy_aggression_fires_long(self, strategy, mes_instrument) -> None:
        signals = strategy.generate_signal(self.context(mes_instrument, self.base()))
        assert len(signals) == 1
        assert signals[0].direction is Side.BUY
        assert "ORDER_FLOW_IMBALANCE" in signals[0].reason_codes

    def test_aggression_below_the_threshold_does_not_fire(
        self, strategy, mes_instrument
    ) -> None:
        values = self.base() | {"exch.trade_imbalance": 0.3}
        assert strategy.generate_signal(self.context(mes_instrument, values)) == []

    def test_aggression_into_a_disagreeing_book_does_not_fire(
        self, strategy, mes_instrument
    ) -> None:
        """Aggression into a wall is absorption, which is the opposite setup."""
        values = self.base() | {"exch.depth_imbalance": -0.7}
        assert strategy.generate_signal(self.context(mes_instrument, values)) == []

    def test_a_thin_book_does_not_fire(self, strategy, mes_instrument) -> None:
        values = self.base() | {"exch.ask_liquidity": 1.0}
        assert strategy.generate_signal(self.context(mes_instrument, values)) == []

    def test_a_wide_spread_does_not_fire(self, strategy, mes_instrument) -> None:
        values = self.base() | {"exch.spread_ticks": 10.0}
        assert strategy.generate_signal(self.context(mes_instrument, values)) == []


class TestMicrostructureScalper:
    @pytest.fixture
    def strategy(self, config_bundle: ConfigBundle, mes_instrument):
        return build_strategy(
            MicrostructureScalperStrategy, "microstructure_scalper", config_bundle,
            mes_instrument, timeframe=Timeframe.S1,
            regimes=(Regime.RANGE, Regime.LOW_VOLATILITY), requires_depth=True,
        )

    def base(self) -> dict[str, float]:
        return {
            "exch.microprice_deviation_ticks": 1.0, "exch.book_imbalance": 0.8,
            "exch.spread_ticks": 1.0, "exch.mid": 5100.0,
        }

    def context(self, instrument, values, **kw):
        return make_context(
            instrument, values, regime=Regime.RANGE, timeframe=Timeframe.S1, **kw
        )

    def test_a_book_leaning_bid_fires_long(self, strategy, mes_instrument) -> None:
        signals = strategy.generate_signal(self.context(mes_instrument, self.base()))
        assert len(signals) == 1
        assert signals[0].direction is Side.BUY
        assert "MICROPRICE_DEVIATION" in signals[0].reason_codes

    def test_a_book_leaning_ask_fires_short(self, strategy, mes_instrument) -> None:
        values = self.base() | {
            "exch.microprice_deviation_ticks": -1.0, "exch.book_imbalance": -0.8
        }
        assert strategy.generate_signal(
            self.context(mes_instrument, values)
        )[0].direction is Side.SELL

    def test_a_spread_that_eats_the_target_does_not_fire(
        self, strategy, mes_instrument
    ) -> None:
        """A 4-tick target against a 3-tick spread is a fee, not an edge."""
        values = self.base() | {"exch.spread_ticks": 3.0}
        assert strategy.generate_signal(self.context(mes_instrument, values)) == []

    def test_a_weak_imbalance_does_not_fire(self, strategy, mes_instrument) -> None:
        values = self.base() | {"exch.book_imbalance": 0.2}
        assert strategy.generate_signal(self.context(mes_instrument, values)) == []

    def test_the_holding_limit_forces_an_exit(self, strategy, mes_instrument) -> None:
        from core.strategies.base import StrategyPosition
        from core.util.clock import NS_PER_SEC

        entry = self.context(mes_instrument, self.base())
        strategy.generate_signal(entry)
        held = self.context(
            mes_instrument, self.base(),
            position=StrategyPosition(quantity=2, avg_price=5100.0, entry_ts=TS),
            ts=TS + 120 * NS_PER_SEC,
        )
        signals = strategy.generate_signal(held)
        assert signals
        assert signals[0].intent is SignalIntent.EXIT
        assert "MAX_HOLDING_SECONDS" in signals[0].reason_codes
