"""Invariants every strategy must satisfy, applied to all of them.

A strategy that passes its own tests but violates one of these is a strategy that can
bypass a platform guarantee. Adding a strategy means adding it to ``STRATEGIES`` here.
"""

from __future__ import annotations

import pytest

from core.config.loader import ConfigBundle
from core.events import Regime, Side, Timeframe
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry
from core.signals.signal import SignalIntent
from core.strategies.base import BaseStrategy
from core.strategies.liquidity_sweep import LiquiditySweepStrategy
from core.strategies.microstructure_scalper import MicrostructureScalperStrategy
from core.strategies.momentum_breakout import MomentumBreakoutStrategy
from core.strategies.opening_range_breakout import OpeningRangeBreakoutStrategy
from core.strategies.order_flow_imbalance import OrderFlowImbalanceStrategy
from core.strategies.trend_pullback import TrendPullbackStrategy
from core.strategies.vwap_mean_reversion import VWAPMeanReversionStrategy
from tests.strategies.conftest import build_strategy, make_context

STRATEGIES: dict[str, type[BaseStrategy]] = {
    "vwap_mean_reversion": VWAPMeanReversionStrategy,
    "momentum_breakout": MomentumBreakoutStrategy,
    "liquidity_sweep": LiquiditySweepStrategy,
    "trend_pullback": TrendPullbackStrategy,
    "order_flow_imbalance": OrderFlowImbalanceStrategy,
    "opening_range_breakout": OpeningRangeBreakoutStrategy,
    "microstructure_scalper": MicrostructureScalperStrategy,
}

# Feature values rich enough that any strategy could act, used to prove the *gates* work
# rather than that a strategy happened to lack data.
RICH_FEATURES: dict[str, float] = {
    "vwap": 5100.0, "vwap_std": 2.0, "atr": 3.0, "last_close": 5094.0, "mid": 5094.0,
    "last_volume": 500.0, "avg_volume": 100.0, "range_high": 5090.0, "range_low": 5080.0,
    "ema_fast": 5095.0, "ema_slow": 5090.0, "swing_trend": 1.0, "spread": 0.25,
    "spread_ticks": 1.0, "trade_imbalance": 0.5, "session_high": 5105.0,
    "session_low": 5085.0, "prev_session_high": 5106.0, "prev_session_low": 5084.0,
    "opening_range_high": 5090.0, "opening_range_low": 5080.0,
    "exch.trade_imbalance": 0.8, "exch.depth_imbalance": 0.7, "exch.spread_ticks": 1.0,
    "exch.bid_liquidity": 100.0, "exch.ask_liquidity": 100.0, "exch.mid": 5094.0,
    "exch.microprice_deviation_ticks": 1.0, "exch.book_imbalance": 0.8,
}


def instrument_for(name: str, registry: InstrumentRegistry) -> Instrument:
    """Every strategy is tested on a venue with real depth."""
    return registry.get("CME:MES")


@pytest.fixture(params=sorted(STRATEGIES), ids=sorted(STRATEGIES))
def strategy_case(request, config_bundle: ConfigBundle, registry: InstrumentRegistry):
    name = request.param
    instrument = instrument_for(name, registry)
    spec = config_bundle["strategies"].section("strategies").section(name)
    timeframe = Timeframe.parse(spec.str_("timeframe"))
    regimes = tuple(Regime(r) for r in spec.list_("allowed_regimes"))
    strategy = build_strategy(
        STRATEGIES[name], name, config_bundle, instrument,
        timeframe=timeframe, regimes=regimes,
    )
    return name, strategy, instrument, timeframe, regimes


class TestUniversalInvariants:
    def test_it_constructs_from_the_shipped_configuration(self, strategy_case) -> None:
        name, strategy, _, _, _ = strategy_case
        assert strategy.config.strategy_id == name

    def test_missing_parameters_are_rejected_at_construction(
        self, strategy_case, config_bundle, registry
    ) -> None:
        name, _, instrument, timeframe, regimes = strategy_case
        with pytest.raises(ValueError, match="missing required params"):
            build_strategy(
                STRATEGIES[name], name, config_bundle, instrument,
                params={}, timeframe=timeframe, regimes=regimes,
            )

    def test_it_never_signals_in_a_disallowed_regime(self, strategy_case) -> None:
        """Being switched off in the wrong regime is the control working."""
        _name, strategy, instrument, timeframe, regimes = strategy_case
        forbidden = next(r for r in Regime if r not in regimes and r is not Regime.UNKNOWN)
        ctx = make_context(
            instrument, RICH_FEATURES, regime=forbidden, timeframe=timeframe
        )
        assert strategy.generate_signal(ctx) == []

    def test_it_never_signals_in_an_unknown_regime(self, strategy_case) -> None:
        _name, strategy, instrument, timeframe, _ = strategy_case
        ctx = make_context(
            instrument, RICH_FEATURES, regime=Regime.UNKNOWN, timeframe=timeframe
        )
        assert strategy.generate_signal(ctx) == []

    def test_it_never_signals_outside_a_session(self, strategy_case) -> None:
        _name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(
            instrument, RICH_FEATURES, regime=regimes[0], timeframe=timeframe,
            session_open=False,
        )
        assert strategy.generate_signal(ctx) == []

    def test_missing_features_produce_no_signal_and_no_error(self, strategy_case) -> None:
        """Warm-up is an expected state, not a failure."""
        _name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(instrument, {}, regime=regimes[0], timeframe=timeframe)
        assert strategy.generate_signal(ctx) == []

    def test_zero_atr_produces_no_signal(self, strategy_case) -> None:
        """A zero-ATR stop distance would divide the risk budget by zero."""
        _name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(
            instrument, RICH_FEATURES | {"atr": 0.0}, regime=regimes[0], timeframe=timeframe
        )
        for signal in strategy.generate_signal(ctx):
            assert signal.stop_distance > 0

    def test_any_signal_it_emits_has_valid_geometry(self, strategy_case) -> None:
        _name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(instrument, RICH_FEATURES, regime=regimes[0], timeframe=timeframe)
        for signal in strategy.generate_signal(ctx):
            if signal.intent is SignalIntent.EXIT:
                continue
            assert signal.stop_distance > 0
            if signal.direction is Side.BUY:
                assert signal.suggested_stop < signal.suggested_entry
            else:
                assert signal.suggested_stop > signal.suggested_entry
            assert 0.0 <= signal.confidence <= 1.0
            assert signal.reason_codes

    def test_any_signal_it_emits_is_tick_aligned(self, strategy_case) -> None:
        _name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(instrument, RICH_FEATURES, regime=regimes[0], timeframe=timeframe)
        for signal in strategy.generate_signal(ctx):
            for price in (signal.suggested_entry, signal.suggested_stop, signal.suggested_target):
                if price is None:
                    continue
                steps = price / instrument.tick_size
                assert abs(round(steps) - steps) < 1e-6

    def test_reset_clears_state(self, strategy_case) -> None:
        """State surviving a walk-forward boundary makes an OOS test in-sample."""
        name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(instrument, RICH_FEATURES, regime=regimes[0], timeframe=timeframe)
        strategy.generate_signal(ctx)
        strategy.reset()
        for attribute, value in vars(strategy).items():
            if isinstance(value, dict) and attribute.startswith("_"):
                assert not value, f"{name}.{attribute} survived reset()"

    def test_it_cannot_express_a_position_size(self, strategy_case) -> None:
        _name, strategy, instrument, timeframe, regimes = strategy_case
        ctx = make_context(instrument, RICH_FEATURES, regime=regimes[0], timeframe=timeframe)
        for signal in strategy.generate_signal(ctx):
            assert not hasattr(signal, "quantity")


class TestDepthRequirements:
    @pytest.mark.parametrize(
        "name", ["order_flow_imbalance", "microstructure_scalper"]
    )
    def test_depth_strategies_are_refused_on_a_cfd(
        self, name: str, config_bundle: ConfigBundle, registry: InstrumentRegistry
    ) -> None:
        """Broker CFD quoting is not centralised market liquidity."""
        with pytest.raises(ValueError, match="requires exchange depth"):
            build_strategy(
                STRATEGIES[name], name, config_bundle, registry.get("CFD:XAUUSD"),
                requires_depth=True,
            )

    @pytest.mark.parametrize(
        "name", ["order_flow_imbalance", "microstructure_scalper"]
    )
    def test_depth_strategies_refuse_to_run_without_the_flag(
        self, name: str, config_bundle: ConfigBundle, registry: InstrumentRegistry
    ) -> None:
        """Turning the flag off would let the strategy be attached to a CFD."""
        with pytest.raises(ValueError, match="requires_exchange_depth must be true"):
            build_strategy(
                STRATEGIES[name], name, config_bundle, registry.get("CME:MES"),
                requires_depth=False,
            )

    def test_depth_strategies_read_only_exchange_namespaced_features(
        self, config_bundle: ConfigBundle, registry: InstrumentRegistry
    ) -> None:
        """A CFD-namespaced feature must not satisfy an exchange-depth strategy."""
        strategy = build_strategy(
            OrderFlowImbalanceStrategy, "order_flow_imbalance", config_bundle,
            registry.get("CME:MES"), timeframe=Timeframe.S15,
            regimes=(Regime.RANGE,), requires_depth=True,
        )
        cfd_only = {
            "atr": 3.0, "last_close": 5100.0,
            "cfd.trade_imbalance": 0.9, "cfd.depth_imbalance": 0.9,
            "cfd.spread_ticks": 1.0, "cfd.bid_liquidity": 100.0,
            "cfd.ask_liquidity": 100.0,
        }
        ctx = make_context(
            registry.get("CME:MES"), cfd_only, regime=Regime.RANGE, timeframe=Timeframe.S15
        )
        assert strategy.generate_signal(ctx) == []


class TestCoverage:
    def test_every_configured_strategy_is_tested_here(
        self, config_bundle: ConfigBundle
    ) -> None:
        """A strategy that ships without appearing in this suite is untested."""
        configured = set(config_bundle["strategies"].section("strategies"))
        assert configured == set(STRATEGIES), (
            f"configured but untested: {sorted(configured - set(STRATEGIES))}; "
            f"tested but not configured: {sorted(set(STRATEGIES) - configured)}"
        )
