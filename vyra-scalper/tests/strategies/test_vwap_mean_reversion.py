"""VWAP mean reversion: configuration validation and signal geometry."""

from __future__ import annotations

from typing import Any

import pytest

from core.config.loader import ConfigBundle
from core.events import BarEvent, Regime, Side, Timeframe
from core.features.engine import FeatureSnapshot
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import SignalIntent
from core.strategies.base import StrategyConfig, StrategyContext, StrategyPosition
from core.strategies.vwap_mean_reversion import VWAPMeanReversionStrategy
from core.util.clock import NS_PER_MIN, from_iso

TS = from_iso("2024-03-05T15:00:00Z")


def base_params() -> dict[str, Any]:
    return {
        "vwap_anchor": "SESSION",
        "entry_deviation_sigma": 2.0,
        "exit_deviation_sigma": 0.25,
        "min_bars_for_vwap": 20,
        "atr_period": 14,
        "stop_atr_multiple": 1.5,
        "target_atr_multiple": 2.0,
        "max_holding_bars": 60,
        "min_sigma_ticks": 2.0,
        "cooldown_bars_after_exit": 3,
        "trade_direction": "BOTH",
    }


def build(mes: Instrument, params: dict[str, Any] | None = None,
          scorer: ConfidenceScorer | None = None) -> VWAPMeanReversionStrategy:
    config = StrategyConfig(
        strategy_id="vwap_mean_reversion", version="1.0.0", instruments=("CME:MES",),
        timeframe=Timeframe.M1, allowed_regimes=(Regime.RANGE, Regime.LOW_VOLATILITY),
        # `params or base_params()` would silently substitute defaults for an empty
        # dict, which is exactly the case the validation tests need to exercise.
        params=base_params() if params is None else params,
    )
    return VWAPMeanReversionStrategy(config, {"CME:MES": mes}, scorer)


def context(
    mes: Instrument, values: dict[str, float], *, bar_count: int = 50,
    position: StrategyPosition | None = None, regime: Regime = Regime.RANGE,
    ts: int = TS,
) -> StrategyContext:
    return StrategyContext(
        ts=ts, instrument=mes,
        features=FeatureSnapshot("CME:MES", ts, Timeframe.M1, bar_count, dict(values)),
        position=position or StrategyPosition(), regime=regime,
    )


def closed_bar(ts: int = TS, close: float = 5100.0) -> BarEvent:
    return BarEvent("CME:MES", "CME", ts, ts, ts, 1, "T", timeframe=Timeframe.M1,
                    ts_open=ts - NS_PER_MIN, ts_close=ts, open=close, high=close + 1,
                    low=close - 1, close=close, volume=100.0, vwap=close, is_closed=True)


class TestConfigurationValidation:
    def test_missing_parameters_are_named_at_construction(self, mes: Instrument) -> None:
        with pytest.raises(ValueError, match="missing required params"):
            build(mes, {})

    def test_entry_must_exceed_exit_sigma(self, mes: Instrument) -> None:
        """Otherwise every entry exits on the next bar."""
        params = base_params() | {"entry_deviation_sigma": 0.1}
        with pytest.raises(ValueError, match="must exceed exit_deviation_sigma"):
            build(mes, params)

    @pytest.mark.parametrize(
        "field", ["stop_atr_multiple", "target_atr_multiple", "min_sigma_ticks"]
    )
    def test_multiples_must_be_positive(self, mes: Instrument, field: str) -> None:
        with pytest.raises(ValueError, match=f"{field} must be positive"):
            build(mes, base_params() | {field: 0.0})

    def test_trade_direction_is_validated(self, mes: Instrument) -> None:
        with pytest.raises(ValueError, match="trade_direction must be"):
            build(mes, base_params() | {"trade_direction": "SIDEWAYS"})

    def test_the_shipped_configuration_loads(
        self, mes: Instrument, config_bundle: ConfigBundle
    ) -> None:
        spec = config_bundle["strategies"].section("strategies").section(
            "vwap_mean_reversion"
        )
        build(mes, spec.section("params").data)


class TestRegimeGating:
    def test_no_signal_in_a_disallowed_regime(self, mes: Instrument) -> None:
        """Being switched off in the wrong regime is the control working."""
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
            regime=Regime.TRENDING_UP,
        )
        assert strategy.generate_signal(ctx) == []

    def test_no_signal_in_an_unknown_regime(self, mes: Instrument) -> None:
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
            regime=Regime.UNKNOWN,
        )
        assert strategy.generate_signal(ctx) == []

    def test_a_signal_fires_in_an_allowed_regime(self, mes: Instrument) -> None:
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
            regime=Regime.RANGE,
        )
        signals = strategy.generate_signal(ctx)
        assert len(signals) == 1
        assert signals[0].direction is Side.BUY  # price below VWAP is faded long


class TestEntryConditions:
    def test_no_signal_before_the_vwap_has_enough_bars(self, mes: Instrument) -> None:
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
            bar_count=5,
        )
        assert strategy.generate_signal(ctx) == []

    def test_no_signal_when_the_band_is_inside_the_noise_floor(self, mes: Instrument) -> None:
        """A band narrower than the spread offers less than it costs to capture."""
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 0.1, "atr": 3.0, "last_close": 5099.5,
             "mid": 5099.5},
        )
        assert strategy.generate_signal(ctx) == []

    def test_no_signal_inside_the_entry_band(self, mes: Instrument) -> None:
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5099.0,
             "mid": 5099.0},
        )
        assert strategy.generate_signal(ctx) == []

    def test_missing_features_produce_no_signal_and_no_error(self, mes: Instrument) -> None:
        """Warm-up is an expected state, not a failure."""
        strategy = build(mes)
        assert strategy.generate_signal(context(mes, {"vwap": 5100.0})) == []

    def test_direction_filter_is_honoured(self, mes: Instrument) -> None:
        strategy = build(mes, base_params() | {"trade_direction": "SHORT"})
        long_setup = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
        )
        assert strategy.generate_signal(long_setup) == []
        short_setup = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5106.0,
             "mid": 5106.0},
        )
        assert len(strategy.generate_signal(short_setup)) == 1


class TestSignalGeometry:
    def test_a_long_signal_has_its_stop_below_and_target_above(
        self, mes: Instrument
    ) -> None:
        strategy = build(mes)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0,
                          "last_close": 5094.0, "mid": 5094.0})
        )[0]
        assert signal.direction is Side.BUY
        assert signal.suggested_stop < signal.suggested_entry
        assert signal.suggested_target is not None
        assert signal.suggested_target > signal.suggested_entry

    def test_a_short_signal_mirrors_it(self, mes: Instrument) -> None:
        strategy = build(mes)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0,
                          "last_close": 5106.0, "mid": 5106.0})
        )[0]
        assert signal.direction is Side.SELL
        assert signal.suggested_stop > signal.suggested_entry
        assert signal.suggested_target is not None
        assert signal.suggested_target < signal.suggested_entry

    def test_stop_distance_follows_atr(self, mes: Instrument) -> None:
        strategy = build(mes)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 4.0,
                          "last_close": 5094.0, "mid": 5094.0})
        )[0]
        assert signal.stop_distance == pytest.approx(4.0 * 1.5, abs=0.25)

    def test_prices_are_tick_aligned(self, mes: Instrument) -> None:
        strategy = build(mes)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.13,
                          "last_close": 5094.07, "mid": 5094.07})
        )[0]
        for price in (signal.suggested_entry, signal.suggested_stop, signal.suggested_target):
            assert price is not None
            assert abs(round(price / 0.25) * 0.25 - price) < 1e-9

    def test_the_signal_carries_its_reasoning(self, mes: Instrument) -> None:
        strategy = build(mes)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0,
                          "last_close": 5094.0, "mid": 5094.0})
        )[0]
        assert "VWAP_DEVIATION" in signal.reason_codes
        assert "LONG_FADE" in signal.reason_codes
        assert signal.features


class TestExits:
    def test_reversion_to_the_mean_exits(self, mes: Instrument) -> None:
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5100.0,
             "mid": 5100.0},
            position=StrategyPosition(quantity=10, avg_price=5094.0),
        )
        signals = strategy.generate_signal(ctx)
        assert len(signals) == 1
        assert signals[0].intent is SignalIntent.EXIT
        assert signals[0].direction is Side.SELL
        assert "VWAP_REVERSION_COMPLETE" in signals[0].reason_codes

    def test_max_holding_bars_forces_an_exit(self, mes: Instrument) -> None:
        strategy = build(mes, base_params() | {"max_holding_bars": 2})
        position = StrategyPosition(quantity=10, avg_price=5094.0)
        values = {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5090.0,
                  "mid": 5090.0}
        signals: list = []
        for i in range(3):
            ctx = context(mes, values, position=position, ts=TS + i * NS_PER_MIN)
            signals = strategy.on_bar(closed_bar(TS + i * NS_PER_MIN), ctx)
        assert signals
        assert "MAX_HOLDING_BARS" in signals[0].reason_codes

    def test_no_exit_while_still_extended(self, mes: Instrument) -> None:
        strategy = build(mes)
        ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5093.0,
             "mid": 5093.0},
            position=StrategyPosition(quantity=10, avg_price=5094.0),
        )
        assert strategy.generate_signal(ctx) == []


class TestCooldownAndReset:
    def test_a_cooldown_follows_an_exit(self, mes: Instrument) -> None:
        strategy = build(mes, base_params() | {"cooldown_bars_after_exit": 3})
        exit_ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5100.0,
             "mid": 5100.0},
            position=StrategyPosition(quantity=10, avg_price=5094.0),
        )
        strategy.generate_signal(exit_ctx)  # triggers the cooldown

        entry_ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
        )
        assert strategy.generate_signal(entry_ctx) == []

    def test_reset_clears_all_state(self, mes: Instrument) -> None:
        """State surviving a walk-forward boundary makes an OOS test in-sample."""
        strategy = build(mes)
        exit_ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5100.0,
             "mid": 5100.0},
            position=StrategyPosition(quantity=10, avg_price=5094.0),
        )
        strategy.generate_signal(exit_ctx)
        strategy.reset()

        entry_ctx = context(
            mes,
            {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0,
             "mid": 5094.0},
        )
        assert len(strategy.generate_signal(entry_ctx)) == 1


class TestConfidence:
    def test_confidence_is_bounded_and_uses_the_configured_weights(
        self, mes: Instrument, config_bundle: ConfigBundle
    ) -> None:
        scorer = ConfidenceScorer.from_config(
            config_bundle["strategies"].section("confidence").data
        )
        strategy = build(mes, scorer=scorer)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0,
                          "last_close": 5094.0, "mid": 5094.0, "spread": 0.25,
                          "spread_ticks": 1.0, "trade_imbalance": 0.5})
        )[0]
        assert 0.0 <= signal.confidence <= 1.0

    def test_a_strategy_without_a_scorer_is_still_usable(self, mes: Instrument) -> None:
        strategy = build(mes, scorer=None)
        signal = strategy.generate_signal(
            context(mes, {"vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0,
                          "last_close": 5094.0, "mid": 5094.0})
        )[0]
        assert signal.confidence == 0.5


class TestDepthRequirement:
    def test_a_depth_requiring_strategy_is_refused_on_a_cfd(
        self, registry: InstrumentRegistry
    ) -> None:
        """Broker CFD depth is that broker's quoting, not market liquidity."""
        config = StrategyConfig(
            strategy_id="depth", version="1.0.0", instruments=("CFD:XAUUSD",),
            timeframe=Timeframe.M1, allowed_regimes=(Regime.RANGE,),
            params=base_params(), requires_exchange_depth=True,
        )
        with pytest.raises(ValueError, match="requires exchange depth"):
            VWAPMeanReversionStrategy(config, {"CFD:XAUUSD": registry.get("CFD:XAUUSD")})
