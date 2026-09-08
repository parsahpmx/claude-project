"""Window splitting: the guarantees that make an out-of-sample test out of sample."""

from __future__ import annotations

import itertools

import pytest

from core.util.clock import NS_PER_DAY, from_iso
from core.validation.windows import (
    Split,
    SplitError,
    WalkForwardMode,
    WindowSplitter,
    walk_forward_windows,
)

START = from_iso("2024-01-01T00:00:00Z")
END = from_iso("2024-12-31T00:00:00Z")


class TestSplitIntegrity:
    def test_an_overlapping_test_window_is_refused(self) -> None:
        """An overlapping OOS window contains data the parameters were fitted on."""
        with pytest.raises(SplitError, match="before training ends"):
            Split(0, START, START + 100 * NS_PER_DAY, START + 50 * NS_PER_DAY, END)

    def test_an_empty_training_window_is_refused(self) -> None:
        with pytest.raises(SplitError, match="empty training window"):
            Split(0, START, START, START, END)

    def test_an_empty_test_window_is_refused(self) -> None:
        with pytest.raises(SplitError, match="empty test window"):
            Split(0, START, START + NS_PER_DAY, START + NS_PER_DAY, START + NS_PER_DAY)

    def test_a_contiguous_split_is_accepted(self) -> None:
        split = Split(0, START, START + 100 * NS_PER_DAY, START + 100 * NS_PER_DAY, END)
        assert split.train_days == pytest.approx(100.0)


class TestWindowSplitter:
    def test_the_three_blocks_are_contiguous_and_non_overlapping(self) -> None:
        split, oos_start, oos_end = WindowSplitter(0.5, 0.2).split(START, END)
        assert split.train_end == split.test_start
        assert split.test_end == oos_start
        assert oos_end == END

    def test_the_fractions_are_honoured(self) -> None:
        splitter = WindowSplitter(0.5, 0.2)
        split, oos_start, oos_end = splitter.split(START, END)
        span = END - START
        assert split.train_end - split.train_start == pytest.approx(span * 0.5, rel=1e-6)
        assert oos_end - oos_start == pytest.approx(span * 0.3, rel=1e-3)

    def test_a_split_leaving_no_out_of_sample_is_refused(self) -> None:
        """The OOS block is the only unbiased measurement in the pipeline."""
        with pytest.raises(SplitError, match="leaves no out-of-sample"):
            WindowSplitter(0.9, 0.2)

    @pytest.mark.parametrize("fraction", [0.0, 1.0, 1.5, -0.1])
    def test_invalid_fractions_are_refused(self, fraction: float) -> None:
        with pytest.raises(SplitError):
            WindowSplitter(fraction, 0.1)

    def test_an_empty_range_is_refused(self) -> None:
        with pytest.raises(SplitError, match="empty range"):
            WindowSplitter().split(END, START)

    def test_the_split_is_a_pure_function_of_its_configuration(self) -> None:
        """The OOS boundary cannot drift after results have been seen."""
        first = WindowSplitter(0.5, 0.2).split(START, END)
        second = WindowSplitter(0.5, 0.2).split(START, END)
        assert first == second


class TestWalkForward:
    def test_anchored_windows_grow(self) -> None:
        splits = walk_forward_windows(START, END, 90, 30, WalkForwardMode.ANCHORED)
        assert len(splits) > 1
        assert all(s.train_start == START for s in splits)
        assert splits[-1].train_days > splits[0].train_days

    def test_rolling_windows_stay_fixed(self) -> None:
        splits = walk_forward_windows(START, END, 90, 30, WalkForwardMode.ROLLING)
        assert len({round(s.train_days) for s in splits}) == 1

    def test_test_windows_do_not_overlap_by_default(self) -> None:
        """Reusing test data across folds inflates apparent significance."""
        splits = walk_forward_windows(START, END, 90, 30)
        for earlier, later in itertools.pairwise(splits):
            assert earlier.test_end <= later.test_start

    def test_training_never_overlaps_its_own_test_window(self) -> None:
        for mode in WalkForwardMode:
            for split in walk_forward_windows(START, END, 90, 30, mode):
                assert split.train_end <= split.test_start

    def test_a_smaller_step_must_be_asked_for(self) -> None:
        contiguous = walk_forward_windows(START, END, 90, 30)
        overlapping = walk_forward_windows(START, END, 90, 30, step_days=15)
        assert len(overlapping) > len(contiguous)

    def test_a_range_too_short_for_one_fold_is_refused(self) -> None:
        """An empty tuple could be read as 'nothing failed'."""
        with pytest.raises(SplitError, match="one fold needs"):
            walk_forward_windows(START, START + 10 * NS_PER_DAY, 90, 30)

    @pytest.mark.parametrize(("train", "test"), [(0, 30), (90, 0), (-1, 30)])
    def test_non_positive_window_lengths_are_refused(self, train: float, test: float) -> None:
        with pytest.raises(SplitError, match="must both be positive"):
            walk_forward_windows(START, END, train, test)
