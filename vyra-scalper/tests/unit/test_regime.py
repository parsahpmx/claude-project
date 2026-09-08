"""Market regime classification."""

from __future__ import annotations

import pytest

from core.events import Regime, Timeframe
from core.features.engine import FeatureSnapshot
from core.instruments.instrument import Instrument
from core.regime.engine import MarketRegimeEngine, RegimeConfig

TS = 1_700_000_000_000_000_000


def snapshot(values: dict[str, float], bar_count: int = 100) -> FeatureSnapshot:
    return FeatureSnapshot("CME:MES", TS, Timeframe.M1, bar_count, dict(values))


def settle(engine: MarketRegimeEngine, mes: Instrument, values: dict[str, float],
           bars: int = 5) -> Regime:
    """Feed the same evidence repeatedly so a candidate confirms."""
    result = None
    for i in range(bars):
        result = engine.on_bar_close(mes, snapshot(values), TS + i)
    assert result is not None
    return result.regime


class TestInsufficientEvidence:
    def test_too_few_bars_is_unknown(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine(RegimeConfig(min_bars=30))
        result = engine.on_bar_close(
            mes, snapshot({"atr": 3.0, "last_close": 5100.0,
                           "range_high": 5110.0, "range_low": 5090.0}, bar_count=5), TS
        )
        assert result.regime is Regime.UNKNOWN

    def test_missing_features_is_unknown(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine()
        assert engine.on_bar_close(mes, snapshot({"atr": 3.0}), TS).regime is Regime.UNKNOWN

    def test_unknown_blocks_a_regime_gated_strategy(self) -> None:
        """The whole point of the gate."""
        from core.strategies.base import StrategyConfig

        config = StrategyConfig("s", "1", (), Timeframe.M1, (Regime.RANGE,), {})
        assert not config.allows(Regime.UNKNOWN)


class TestClassification:
    def test_a_contained_market_is_a_range(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=2))
        regime = settle(engine, mes, {
            "atr": 3.0, "last_close": 5100.0, "range_high": 5110.0, "range_low": 5090.0,
            "ema_fast": 5100.0, "ema_slow": 5100.0, "swing_trend": 0.0,
        })
        assert regime is Regime.RANGE

    def test_a_break_of_the_range_is_a_breakout(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=2, breakout_atr=0.75))
        regime = settle(engine, mes, {
            "atr": 3.0, "last_close": 5120.0, "range_high": 5110.0, "range_low": 5090.0,
        })
        assert regime is Regime.BREAKOUT

    def test_separated_emas_with_agreeing_structure_is_a_trend(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=2))
        up = settle(engine, mes, {
            "atr": 3.0, "last_close": 5105.0, "range_high": 5110.0, "range_low": 5090.0,
            "ema_fast": 5105.0, "ema_slow": 5100.0, "swing_trend": 1.0,
        })
        assert up is Regime.TRENDING_UP

        engine.reset()
        down = settle(engine, mes, {
            "atr": 3.0, "last_close": 5095.0, "range_high": 5110.0, "range_low": 5090.0,
            "ema_fast": 5095.0, "ema_slow": 5100.0, "swing_trend": -1.0,
        })
        assert down is Regime.TRENDING_DOWN

    def test_structure_disagreeing_with_the_emas_is_not_a_trend(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=2))
        regime = settle(engine, mes, {
            "atr": 3.0, "last_close": 5105.0, "range_high": 5110.0, "range_low": 5090.0,
            "ema_fast": 5105.0, "ema_slow": 5100.0, "swing_trend": -1.0,
        })
        assert regime is not Regime.TRENDING_UP

    def test_volatility_extremes_are_classified(self, mes: Instrument) -> None:
        engine = MarketRegimeEngine(RegimeConfig(min_bars=1, confirm_bars=1, vol_lookback=50))
        base = {"last_close": 5100.0, "range_high": 5110.0, "range_low": 5090.0,
                "ema_fast": 5100.0, "ema_slow": 5100.0, "swing_trend": 0.0}
        for _ in range(30):
            engine.on_bar_close(mes, snapshot(base | {"atr": 3.0}), TS)
        spike = engine.on_bar_close(mes, snapshot(base | {"atr": 30.0}), TS)
        assert spike.regime is Regime.HIGH_VOLATILITY


class TestHysteresis:
    def test_a_candidate_must_confirm_before_it_is_published(self, mes: Instrument) -> None:
        """One noisy bar must not toggle a strategy on and off."""
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=3))
        values = {"atr": 3.0, "last_close": 5100.0, "range_high": 5110.0,
                  "range_low": 5090.0, "ema_fast": 5100.0, "ema_slow": 5100.0,
                  "swing_trend": 0.0}
        first = engine.on_bar_close(mes, snapshot(values), TS)
        assert first.candidate is Regime.RANGE
        assert first.regime is Regime.UNKNOWN  # not yet confirmed

        engine.on_bar_close(mes, snapshot(values), TS + 1)
        third = engine.on_bar_close(mes, snapshot(values), TS + 2)
        assert third.regime is Regime.RANGE

    def test_losing_the_evidence_publishes_unknown_immediately(self, mes: Instrument) -> None:
        """Holding a stale regime would keep a strategy enabled on a state we cannot see."""
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=2))
        values = {"atr": 3.0, "last_close": 5100.0, "range_high": 5110.0,
                  "range_low": 5090.0, "ema_fast": 5100.0, "ema_slow": 5100.0,
                  "swing_trend": 0.0}
        assert settle(engine, mes, values) is Regime.RANGE
        degraded = engine.on_bar_close(mes, snapshot({"atr": 3.0}), TS + 10)
        assert degraded.regime is Regime.UNKNOWN


class TestReset:
    def test_reset_clears_history(self, mes: Instrument) -> None:
        """Regime history crossing a walk-forward boundary leaks in-sample information."""
        engine = MarketRegimeEngine(RegimeConfig(min_bars=10, confirm_bars=2))
        values = {"atr": 3.0, "last_close": 5100.0, "range_high": 5110.0,
                  "range_low": 5090.0, "ema_fast": 5100.0, "ema_slow": 5100.0,
                  "swing_trend": 0.0}
        settle(engine, mes, values)
        assert engine.current("CME:MES") is Regime.RANGE
        engine.reset()
        assert engine.current("CME:MES") is Regime.UNKNOWN


class TestConfigValidation:
    def test_volatility_thresholds_must_be_ordered(self) -> None:
        with pytest.raises(ValueError, match="low_vol_ratio"):
            RegimeConfig(low_vol_ratio=2.0, high_vol_ratio=1.6)

    def test_containment_must_be_a_fraction(self) -> None:
        with pytest.raises(ValueError, match="range_containment"):
            RegimeConfig(range_containment=1.5)

    def test_the_shipped_configuration_loads(self, config_bundle) -> None:
        section = config_bundle.get("regime")
        assert section is not None, "regime.yaml is not in the standard bundle"
        RegimeConfig.from_config(section.section("classification"))
