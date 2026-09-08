"""Time-series splits with purging and an embargo.

A random split of market data is a leak, not a shortcut. Two mechanisms are needed and they
are different:

**Ordering.** Training data must precede test data in time. A model trained on Thursday and
tested on Wednesday is being asked a question nobody will ever ask it.

**Purging and embargo.** A label looks forward by construction — "did price rise over the
next N bars" — so the training sample at time *t* contains information about *t + N*. If the
test period begins at *t + 1*, that training sample has already seen part of it. The fix is
to drop training samples whose label window reaches into the test period (purging) and to
leave a further gap afterwards (embargo), because features are computed from trailing
windows and a test sample immediately after the boundary was partly built from training-era
bars.

Both gaps are expressed in *samples*, and the label horizon is the floor for the purge. A
caller who passes a smaller purge than the horizon is asking for a leak, and gets an error.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np

__all__ = ["MIN_TEST_SAMPLES", "MIN_TRAIN_SAMPLES", "PurgedSplit", "purged_time_splits"]

# Floors, not preferences. Below these a fold's metric is dominated by which side of a coin
# a dozen samples happened to land on, and that number is averaged into the verdict with the
# same weight as a fold trained on thousands. Skipping the fold and reporting
# INSUFFICIENT_EVIDENCE is the honest outcome for a dataset this small.
MIN_TRAIN_SAMPLES = 50
MIN_TEST_SAMPLES = 30


@dataclass(frozen=True, slots=True)
class PurgedSplit:
    """One fold: contiguous, ordered, with a gap between the two halves."""

    train: np.ndarray
    test: np.ndarray
    purge: int
    embargo: int

    @property
    def gap(self) -> int:
        """Samples dropped between the last training row and the first test row."""
        if len(self.train) == 0 or len(self.test) == 0:
            return 0
        return int(self.test[0] - self.train[-1] - 1)


def purged_time_splits(
    n_samples: int,
    n_splits: int = 5,
    label_horizon: int = 1,
    purge: int | None = None,
    embargo: int = 0,
    min_train: int = MIN_TRAIN_SAMPLES,
    min_test: int = MIN_TEST_SAMPLES,
) -> Iterator[PurgedSplit]:
    """Yield expanding-window folds, each with a purged gap before its test period.

    Expanding rather than rolling: a model that will be refit on everything available should
    be evaluated the same way. A rolling window is the right choice for a different
    question — whether the edge decays — and that is the walk-forward analysis in
    ``core.validation``, not this.

    Args:
        n_samples: rows in the dataset, in time order.
        n_splits: number of folds.
        label_horizon: how many samples forward each label looks. The floor for ``purge``.
        purge: samples dropped from the end of training. Defaults to ``label_horizon``.
        embargo: further samples dropped, for feature windows that straddle the boundary.
        min_train: smallest usable training set. Folds below it are skipped rather than
            yielded tiny — a metric from a handful of samples is noise with a number on it,
            and it is noise that goes straight into the mean. On an early fold of a small
            dataset this default is the difference between reporting nothing and reporting
            an AUC of 0.73 from eight training rows of pure noise.
        min_test: smallest usable test set, for the same reason from the other side.

    Raises:
        ValueError: when ``purge`` is smaller than ``label_horizon``. That combination
            leaks the test period into training, and silently correcting it would hide the
            caller's misunderstanding.
    """
    if n_splits < 1:
        raise ValueError("n_splits must be at least 1")
    if label_horizon < 0:
        raise ValueError("label_horizon must be non-negative")
    if purge is None:
        purge = label_horizon
    if purge < label_horizon:
        raise ValueError(
            f"purge ({purge}) is smaller than the label horizon ({label_horizon}); the "
            "training set would contain samples whose labels are drawn from the test "
            "period"
        )
    if embargo < 0:
        raise ValueError("embargo must be non-negative")

    fold_size = n_samples // (n_splits + 1)
    if fold_size < 1:
        return

    for fold in range(1, n_splits + 1):
        test_start = fold * fold_size
        test_end = test_start + fold_size if fold < n_splits else n_samples
        train_end = test_start - purge - embargo
        if train_end < min_train or (test_end - test_start) < min_test:
            continue
        yield PurgedSplit(
            train=np.arange(0, train_end),
            test=np.arange(test_start, test_end),
            purge=purge,
            embargo=embargo,
        )
