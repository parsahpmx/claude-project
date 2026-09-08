"""Shared helpers for strategy tests."""

from __future__ import annotations

from typing import Any

from core.config.loader import ConfigBundle
from core.events import BarEvent, QuoteEvent, Regime, Timeframe
from core.features.engine import FeatureSnapshot
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext, StrategyPosition
from core.util.clock import NS_PER_MIN, from_iso

TS = from_iso("2024-03-05T15:00:00Z")


def shipped_params(bundle: ConfigBundle, name: str) -> dict[str, Any]:
    """The parameters this strategy actually ships with.

    Tests build from the shipped configuration rather than a hand-written fixture, so a
    test cannot pass against parameters nobody runs.
    """
    return dict(
        bundle["strategies"].section("strategies").section(name).section("params").data
    )


def build_strategy(
    cls: type[BaseStrategy],
    name: str,
    bundle: ConfigBundle,
    instrument: Instrument,
    *,
    params: dict[str, Any] | None = None,
    timeframe: Timeframe = Timeframe.M1,
    regimes: tuple[Regime, ...] = (Regime.RANGE,),
    requires_depth: bool | None = None,
    with_scorer: bool = True,
) -> BaseStrategy:
    spec = bundle["strategies"].section("strategies").section(name)
    config = StrategyConfig(
        strategy_id=name,
        version=spec.str_("version", "1.0.0"),
        instruments=(instrument.instrument_id,),
        timeframe=timeframe,
        allowed_regimes=regimes,
        params=shipped_params(bundle, name) if params is None else params,
        requires_exchange_depth=(
            spec.bool_("requires_exchange_depth", False)
            if requires_depth is None
            else requires_depth
        ),
    )
    scorer = (
        ConfidenceScorer.from_config(bundle["strategies"].section("confidence").data)
        if with_scorer
        else None
    )
    return cls(config, {instrument.instrument_id: instrument}, scorer)


def make_context(
    instrument: Instrument,
    values: dict[str, float],
    *,
    bar_count: int = 100,
    position: StrategyPosition | None = None,
    regime: Regime = Regime.RANGE,
    ts: int = TS,
    session_open_ns: int = TS - 60 * NS_PER_MIN,
    timeframe: Timeframe = Timeframe.M1,
    session_open: bool = True,
) -> StrategyContext:
    return StrategyContext(
        ts=ts,
        instrument=instrument,
        features=FeatureSnapshot(
            instrument.instrument_id, ts, timeframe, bar_count, dict(values)
        ),
        position=position or StrategyPosition(),
        regime=regime,
        session_open_ns=session_open_ns,
        is_session_open=session_open,
    )


def make_bar(
    instrument: Instrument,
    *,
    ts: int = TS,
    open_: float = 5100.0,
    high: float = 5101.0,
    low: float = 5099.0,
    close: float = 5100.0,
    volume: float = 100.0,
    timeframe: Timeframe = Timeframe.M1,
    closed: bool = True,
) -> BarEvent:
    return BarEvent(
        instrument.instrument_id, instrument.exchange, ts, ts, ts, 1, "TEST",
        timeframe=timeframe, ts_open=ts - NS_PER_MIN, ts_close=ts,
        open=open_, high=high, low=low, close=close, volume=volume, vwap=close,
        is_closed=closed,
    )


def make_quote(instrument: Instrument, bid: float, ask: float, ts: int = TS) -> QuoteEvent:
    return QuoteEvent(
        instrument.instrument_id, instrument.exchange, ts, ts, ts, 1, "TEST",
        bid=bid, ask=ask, bid_size=10, ask_size=10,
    )
