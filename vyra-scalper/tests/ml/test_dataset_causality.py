"""Prefix invariance: the empirical version of the causality argument.

Every other leak test checks a mechanism — the split ordering, the scaler, the purge. This
one checks the outcome directly: build a dataset over a window, build it again over a longer
window starting at the same point, and the rows they share must be **bit-identical**.

If any feature or label peeks forward — a rolling window that centres instead of trails, an
indicator that back-fills, a label off by one — then extending the stream changes rows that
were already computed, and this test fails. It is slow because it replays a real event
stream through the real feature engine twice, and that is the point: a faster version would
be testing a reimplementation.
"""

from __future__ import annotations

import numpy as np
import pytest

from core.events import Timeframe
from core.features.engine import FeatureConfig, FeatureEngine
from core.instruments.registry import InstrumentRegistry
from core.market_data.bars import BarEngine
from core.ml import build_dataset
from core.util.clock import from_iso
from data.collectors.synthetic import SyntheticConfig, SyntheticTickSource

FEATURES = ("atr", "rsi", "roc", "realized_vol", "close_std", "trade_imbalance")
START = "2024-03-04T14:30:00Z"


def build(registry: InstrumentRegistry, end_iso: str, horizon: int = 5):
    instrument = registry.get("CME:MES")
    timeframe = Timeframe("1m")
    source = SyntheticTickSource(
        instrument, SyntheticConfig(seed=99), registry.calendar("CME:MES")
    )
    bars = BarEngine(
        instrument_id="CME:MES",
        exchange=instrument.exchange,
        timeframes=[timeframe],
        calendar=registry.calendar("CME:MES"),
    )
    engine = FeatureEngine(
        {"CME:MES": instrument},
        FeatureConfig.from_params({}, timeframe),
        calendars={"CME:MES": registry.calendar("CME:MES")},
    )

    def events():
        for event in source.events(from_iso(START), from_iso(end_iso)):
            yield event
            yield from bars.on_event(event)

    return build_dataset(events(), engine, "CME:MES", FEATURES, label_horizon=horizon)


@pytest.mark.slow
def test_extending_the_stream_does_not_change_earlier_rows(
    registry: InstrumentRegistry,
) -> None:
    short = build(registry, "2024-03-04T18:00:00Z")
    long = build(registry, "2024-03-05T18:00:00Z")

    n = len(short)
    assert n > 100, "the short window produced too few rows to prove anything"
    assert len(long) > n, "the long window must extend the short one"

    assert np.array_equal(short.timestamps, long.timestamps[:n])
    assert np.array_equal(short.labels, long.labels[:n]), (
        "labels changed when future data was added: the label window is misaligned"
    )
    # Exact, not approximate. A feature that peeks forward changes by a real amount; a
    # tolerance here would let a small leak through as a rounding difference.
    assert np.array_equal(short.features, long.features[:n]), (
        "features changed when future data was added: something is reading forward"
    )


@pytest.mark.slow
def test_the_final_rows_are_dropped_rather_than_labelled_by_guesswork(
    registry: InstrumentRegistry,
) -> None:
    """The last `horizon` bars have no forward window. They are dropped, not filled."""
    horizon = 7
    dataset = build(registry, "2024-03-04T18:00:00Z", horizon=horizon)
    assert dataset.dropped_incomplete == horizon
    bar_count = len(dataset) + horizon + dataset.dropped_not_ready
    assert bar_count > len(dataset)
