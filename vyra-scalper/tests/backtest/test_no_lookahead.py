"""Bias prevention.

The central test in this file is the deliberate cheat: a strategy that tries to read a
future bar must be caught. A backtester that cannot detect cheating cannot certify
honesty (``BACKTEST_SPEC.md`` §3).
"""

from __future__ import annotations

import pytest

from core.events import BarEvent, Timeframe, TradeEvent
from core.features.engine import FeatureConfig, FeatureEngine, FeatureSnapshot
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry
from core.market_data.bars import BarEngine
from core.util.clock import NS_PER_MIN, NS_PER_SEC, from_iso

T0 = from_iso("2024-03-05T15:00:00Z")


def trade(ts: int, price: float, size: float = 1.0, seq: int = 1) -> TradeEvent:
    return TradeEvent(
        "CME:MES", "CME", ts, ts, ts, seq, "TEST", price=price, size=size
    )


class TestBarBoundary:
    """A bar closes only when an event proves its window has elapsed."""

    def test_bar_is_not_emitted_before_its_boundary(self) -> None:
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        for i in range(59):
            assert engine.on_event(trade(T0 + i * NS_PER_SEC, 5100.0, seq=i + 1)) == []

    def test_bar_closes_on_the_first_event_past_the_boundary(self) -> None:
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        engine.on_event(trade(T0, 5100.0, seq=1))
        closed = engine.on_event(trade(T0 + NS_PER_MIN, 5101.0, seq=2))
        assert len(closed) == 1
        bar = closed[0]
        assert bar.is_closed
        # The closing event's own price is in the NEXT bar, not this one.
        assert bar.close == 5100.0
        assert bar.ts_close <= T0 + NS_PER_MIN

    def test_a_closed_bar_never_contains_data_after_its_close(self) -> None:
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        for i, price in enumerate([5100.0, 5101.0, 5099.0]):
            engine.on_event(trade(T0 + i * NS_PER_SEC, price, seq=i + 1))
        closed = engine.on_event(trade(T0 + NS_PER_MIN, 9999.0, seq=99))
        assert closed[0].high == 5101.0  # the 9999 spike is in the next bar
        assert closed[0].low == 5099.0

    def test_partial_bar_is_marked_and_refused_as_history(self) -> None:
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        engine.on_event(trade(T0, 5100.0, seq=1))
        partial = engine.current_partial(Timeframe.M1)
        assert partial is not None
        assert not partial.is_closed
        with pytest.raises(ValueError, match="look-ahead guard"):
            partial.require_closed()


class TestNoSilentDataRepair:
    def test_empty_periods_produce_no_phantom_bars(self) -> None:
        """A zero-volume candle is invented data."""
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        engine.on_event(trade(T0, 5100.0, seq=1))
        closed = engine.on_event(trade(T0 + 5 * NS_PER_MIN, 5105.0, seq=2))
        assert len(closed) == 1  # one real bar, not five

    def test_the_gap_is_recorded_instead(self) -> None:
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1])
        engine.on_event(trade(T0, 5100.0, seq=1))
        engine.on_event(trade(T0 + 5 * NS_PER_MIN, 5105.0, seq=2))
        assert engine.gaps
        assert engine.gaps[0].periods_missing == 4

    def test_vwap_is_none_without_trades_not_the_midpoint(self) -> None:
        """Substituting the mid would invent a level nothing transacted at."""
        engine = BarEngine("CME:MES", "CME", [Timeframe.M1], use_quotes_when_no_trades=True)
        from core.events import QuoteEvent

        for i in range(3):
            engine.on_event(
                QuoteEvent("CME:MES", "CME", T0 + i * NS_PER_SEC, T0 + i * NS_PER_SEC,
                           T0 + i * NS_PER_SEC, i + 1, "TEST",
                           bid=5100.0, ask=5100.25, bid_size=5, ask_size=5)
            )
        closed = engine.on_event(
            QuoteEvent("CME:MES", "CME", T0 + NS_PER_MIN, T0 + NS_PER_MIN, T0 + NS_PER_MIN,
                       99, "TEST", bid=5101.0, ask=5101.25, bid_size=5, ask_size=5)
        )
        assert closed[0].vwap is None
        assert closed[0].volume == 0.0


class TestFeatureCausality:
    def test_a_snapshot_from_the_future_is_refused(self, registry: InstrumentRegistry) -> None:
        """Timestamp leakage: a decision must never use later information."""
        snapshot = FeatureSnapshot(
            instrument_id="CME:MES", computed_at=1_000, timeframe=Timeframe.M1, bar_count=10
        )
        assert snapshot.require_causal(1_000) is snapshot
        assert snapshot.require_causal(2_000) is snapshot
        with pytest.raises(ValueError, match="timestamp leakage"):
            snapshot.require_causal(999)

    def test_partial_bars_do_not_advance_features(self, mes: Instrument) -> None:
        engine = FeatureEngine({"CME:MES": mes}, FeatureConfig(timeframe=Timeframe.M1))
        partial = BarEvent(
            "CME:MES", "CME", T0, T0, T0, 1, "TEST", timeframe=Timeframe.M1,
            ts_open=T0, ts_close=T0 + NS_PER_MIN, open=5100.0, high=5101.0,
            low=5099.0, close=5100.5, volume=10.0, is_closed=False,
        )
        engine.on_event(partial)
        assert engine.bar_count("CME:MES") == 0

        closed = BarEvent(
            "CME:MES", "CME", T0, T0, T0, 2, "TEST", timeframe=Timeframe.M1,
            ts_open=T0, ts_close=T0 + NS_PER_MIN, open=5100.0, high=5101.0,
            low=5099.0, close=5100.5, volume=10.0, is_closed=True,
        )
        engine.on_event(closed)
        assert engine.bar_count("CME:MES") == 1

    def test_a_strategy_reading_a_future_bar_is_caught(self, mes: Instrument) -> None:
        """The deliberate cheat.

        An indicator that is handed an unclosed bar — the only way to see the future in
        this engine — raises rather than quietly computing on it.
        """
        from core.features.indicators import ATR

        atr = ATR(3)
        future_bar = BarEvent(
            "CME:MES", "CME", T0, T0, T0, 1, "TEST", timeframe=Timeframe.M1,
            ts_open=T0, ts_close=T0 + NS_PER_MIN, open=5100.0, high=5200.0,
            low=5099.0, close=5199.0, volume=10.0, is_closed=False,
        )
        with pytest.raises(ValueError, match="look-ahead guard"):
            atr.update(future_bar)
