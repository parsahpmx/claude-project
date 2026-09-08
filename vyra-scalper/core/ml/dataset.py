"""Turning an event stream into a supervised dataset, without looking forward.

The features come from :class:`~core.features.engine.FeatureEngine` — the same object the
strategies use, fed the same events in the same order. That is not a convenience: a research
feature computed by a second implementation produces a backtest about a system nobody is
running, and the difference is invisible until live results disagree with the study.

The labels look forward on purpose. That is what a label is. What matters is that the
forward window is *declared*, so the splitter can purge training samples whose labels reach
into the test period, and that the last rows — the ones whose window runs off the end of the
data — are dropped rather than filled with a guess.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from core.events import BarEvent, Event
from core.features.engine import FeatureEngine
from core.util.clock import Nanos
from core.util.logging import get_logger

__all__ = ["Dataset", "build_dataset"]

_log = get_logger("ml.dataset")


@dataclass(slots=True)
class Dataset:
    """A supervised dataset in time order.

    Time order is a property, not a convention: every split in this package assumes rows
    are ordered, and a shuffled dataset would make the purging meaningless while still
    producing numbers.
    """

    features: np.ndarray
    labels: np.ndarray
    timestamps: np.ndarray
    feature_names: tuple[str, ...]
    instrument_id: str
    label_horizon: int
    dropped_incomplete: int = 0
    dropped_not_ready: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if len(self.features) != len(self.labels) != len(self.timestamps):
            raise ValueError("features, labels and timestamps must be the same length")
        if len(self.timestamps) > 1 and not np.all(np.diff(self.timestamps) > 0):
            raise ValueError(
                "dataset timestamps are not strictly increasing; every split in this "
                "package assumes time order and would silently produce a leak without it"
            )

    def __len__(self) -> int:
        return len(self.labels)

    @property
    def positive_rate(self) -> float:
        """Share of positive labels. Reported because a 95/5 split makes accuracy a lie."""
        return float(np.mean(self.labels)) if len(self.labels) else 0.0

    def summary(self) -> dict[str, Any]:
        return {
            "rows": len(self),
            "features": len(self.feature_names),
            "feature_names": list(self.feature_names),
            "instrument_id": self.instrument_id,
            "label_horizon": self.label_horizon,
            "positive_rate": round(self.positive_rate, 6),
            "dropped_incomplete_label": self.dropped_incomplete,
            "dropped_features_not_ready": self.dropped_not_ready,
            "start_ts": int(self.timestamps[0]) if len(self) else None,
            "end_ts": int(self.timestamps[-1]) if len(self) else None,
        }


def build_dataset(
    events: Iterable[Event],
    engine: FeatureEngine,
    instrument_id: str,
    feature_names: tuple[str, ...],
    label_horizon: int = 5,
    label_threshold: float = 0.0,
) -> Dataset:
    """Build a dataset by replaying ``events`` through ``engine``.

    One row per closed bar, with the features as of that bar's close and a label drawn from
    the ``label_horizon`` bars after it.

    Args:
        label_threshold: the forward return above which the label is positive. Zero means
            "did it go up at all", which is the honest default: a threshold tuned to make a
            class balance look better is a decision about the answer, taken before the
            question.

    Rows where a feature is not yet ready are dropped, not imputed. An indicator that needs
    fifty bars has no value at bar ten, and a zero there is a number the model would learn
    from.
    """
    if label_horizon < 1:
        raise ValueError("label_horizon must be at least 1")

    rows: list[list[float]] = []
    stamps: list[Nanos] = []
    closes: list[float] = []
    not_ready = 0

    for event in events:
        engine.on_event(event)
        if not isinstance(event, BarEvent) or event.instrument_id != instrument_id:
            continue
        snapshot = engine.snapshot(instrument_id)
        # The same guard the strategies use: a snapshot that carries anything the engine
        # could not have known at this timestamp raises rather than being used.
        snapshot = snapshot.require_causal(event.ts)
        if not snapshot.has(*feature_names):
            not_ready += 1
            continue
        rows.append([float(v) for v in snapshot.require(*feature_names)])
        stamps.append(event.ts)
        closes.append(float(event.close))

    if not rows:
        return Dataset(
            features=np.empty((0, len(feature_names))),
            labels=np.empty(0),
            timestamps=np.empty(0, dtype=np.int64),
            feature_names=feature_names,
            instrument_id=instrument_id,
            label_horizon=label_horizon,
            dropped_not_ready=not_ready,
        )

    prices = np.asarray(closes, dtype=float)
    usable = len(prices) - label_horizon
    if usable <= 0:
        # Every row's label window runs off the end. Returning an empty dataset is the
        # honest answer; filling the labels would be inventing the thing being predicted.
        return Dataset(
            features=np.empty((0, len(feature_names))),
            labels=np.empty(0),
            timestamps=np.empty(0, dtype=np.int64),
            feature_names=feature_names,
            instrument_id=instrument_id,
            label_horizon=label_horizon,
            dropped_incomplete=len(prices),
            dropped_not_ready=not_ready,
        )

    forward = (prices[label_horizon:] - prices[:usable]) / prices[:usable]
    labels = (forward > label_threshold).astype(float)

    dataset = Dataset(
        features=np.asarray(rows[:usable], dtype=float),
        labels=labels,
        timestamps=np.asarray(stamps[:usable], dtype=np.int64),
        feature_names=feature_names,
        instrument_id=instrument_id,
        label_horizon=label_horizon,
        dropped_incomplete=label_horizon,
        dropped_not_ready=not_ready,
        metadata={"label_threshold": label_threshold},
    )
    _log.info("ml_dataset_built", **dataset.summary())
    return dataset
