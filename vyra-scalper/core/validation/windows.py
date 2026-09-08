"""Window splitting for out-of-sample and walk-forward analysis.

The properties that make a split honest:

* **The out-of-sample window is chosen before the in-sample run**, and recorded in the
  manifest. A window picked after seeing in-sample results is not out of sample.
* **Windows never overlap.** An overlapping "out-of-sample" period contains data the
  parameters were fitted on.
* **Walk-forward is anchored or rolling by explicit choice**, because the two answer
  different questions and silently picking one would make the result uninterpretable.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from core.util.clock import NS_PER_DAY, Nanos, to_iso

__all__ = ["Split", "SplitError", "WalkForwardMode", "WindowSplitter", "walk_forward_windows"]


class SplitError(ValueError):
    """Raised when a requested split cannot be made honestly."""


class WalkForwardMode(StrEnum):
    """How the training window moves.

    ``ANCHORED``
        The training window always starts at the beginning: the model sees all history.
        Answers "does this work with everything we know?".
    ``ROLLING``
        The training window is a fixed length that slides. Answers "does this work with
        only recent history?", which is the relevant question when a market's character
        changes.
    """

    ANCHORED = "ANCHORED"
    ROLLING = "ROLLING"


@dataclass(frozen=True, slots=True)
class Split:
    """One train/test pair. Non-overlapping by construction."""

    index: int
    train_start: Nanos
    train_end: Nanos
    test_start: Nanos
    test_end: Nanos

    def __post_init__(self) -> None:
        if self.train_end <= self.train_start:
            raise SplitError(f"split {self.index}: empty training window")
        if self.test_end <= self.test_start:
            raise SplitError(f"split {self.index}: empty test window")
        if self.test_start < self.train_end:
            raise SplitError(
                f"split {self.index}: the test window starts at {to_iso(self.test_start)}, "
                f"before training ends at {to_iso(self.train_end)}. An overlapping "
                "out-of-sample window contains data the parameters were fitted on."
            )

    @property
    def train_days(self) -> float:
        return (self.train_end - self.train_start) / NS_PER_DAY

    @property
    def test_days(self) -> float:
        return (self.test_end - self.test_start) / NS_PER_DAY

    def to_dict(self) -> dict[str, object]:
        return {
            "index": self.index,
            "train_start": to_iso(self.train_start),
            "train_end": to_iso(self.train_end),
            "test_start": to_iso(self.test_start),
            "test_end": to_iso(self.test_end),
            "train_days": round(self.train_days, 3),
            "test_days": round(self.test_days, 3),
        }


@dataclass(frozen=True, slots=True)
class WindowSplitter:
    """Splits a date range into in-sample, validation and out-of-sample blocks.

    The fractions are declared up front and the split is a pure function of them, so the
    out-of-sample boundary cannot drift after results are seen.
    """

    in_sample_fraction: float = 0.5
    validation_fraction: float = 0.2

    def __post_init__(self) -> None:
        if not 0 < self.in_sample_fraction < 1:
            raise SplitError("in_sample_fraction must be in (0, 1)")
        if not 0 <= self.validation_fraction < 1:
            raise SplitError("validation_fraction must be in [0, 1)")
        total = self.in_sample_fraction + self.validation_fraction
        if total >= 1:
            raise SplitError(
                f"in_sample_fraction + validation_fraction = {total:.3f} leaves no "
                "out-of-sample window. The OOS block is the only unbiased measurement in "
                "the pipeline and cannot be zero."
            )

    @property
    def out_of_sample_fraction(self) -> float:
        return 1.0 - self.in_sample_fraction - self.validation_fraction

    def split(self, start: Nanos, end: Nanos) -> tuple[Split, Nanos, Nanos]:
        """Return ``(is_validation_split, oos_start, oos_end)``.

        The in-sample and validation blocks are returned as a :class:`Split` because that
        is the pair used for parameter selection; the out-of-sample bounds are returned
        separately because nothing may touch them until the final step.
        """
        if end <= start:
            raise SplitError(f"empty range: {to_iso(start)} to {to_iso(end)}")
        span = end - start
        is_end = start + int(span * self.in_sample_fraction)
        validation_end = is_end + int(span * self.validation_fraction)
        return (
            Split(0, start, is_end, is_end, validation_end),
            validation_end,
            end,
        )


def walk_forward_windows(
    start: Nanos,
    end: Nanos,
    train_days: float,
    test_days: float,
    mode: WalkForwardMode = WalkForwardMode.ANCHORED,
    step_days: float | None = None,
) -> tuple[Split, ...]:
    """Generate rolling train/test windows.

    Args:
        train_days: length of the initial (anchored) or fixed (rolling) training window.
        test_days: length of each out-of-sample window.
        mode: anchored or rolling — see :class:`WalkForwardMode`.
        step_days: how far the window advances. Defaults to ``test_days``, which makes the
            test windows contiguous and non-overlapping. A smaller step reuses test data
            across folds and inflates apparent significance, so it must be asked for.

    Raises:
        SplitError: if the range cannot accommodate even one fold, rather than silently
            returning an empty tuple that a caller might read as "nothing failed".
    """
    if train_days <= 0 or test_days <= 0:
        raise SplitError("train_days and test_days must both be positive")
    step = step_days if step_days is not None else test_days
    if step <= 0:
        raise SplitError("step_days must be positive")

    train_ns = int(train_days * NS_PER_DAY)
    test_ns = int(test_days * NS_PER_DAY)
    step_ns = int(step * NS_PER_DAY)

    if end - start < train_ns + test_ns:
        raise SplitError(
            f"the range spans {(end - start) / NS_PER_DAY:.1f} days but one fold needs "
            f"{train_days + test_days:.1f} ({train_days} train + {test_days} test)"
        )

    splits: list[Split] = []
    index = 0
    test_start = start + train_ns
    while test_start + test_ns <= end:
        train_start = start if mode is WalkForwardMode.ANCHORED else test_start - train_ns
        splits.append(
            Split(index, train_start, test_start, test_start, test_start + test_ns)
        )
        index += 1
        test_start += step_ns
    return tuple(splits)
