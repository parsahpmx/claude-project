"""Parameter sensitivity and plateau detection.

The single most common way to fool yourself with a backtest is to sweep a parameter, take
the best value, and report its PnL. That number is the maximum of a noisy sample, and the
expected out-of-sample performance of a maximum is much worse than the maximum.

The defence is a **plateau**: the chosen parameter must sit in a contiguous region where
neighbouring values are also profitable. A peak surrounded by losses is noise, and this
module's job is to say so with a number (``BACKTEST_SPEC.md`` §8).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

__all__ = ["ParameterSweep", "PlateauResult", "SweepPoint", "find_plateau"]


@dataclass(frozen=True, slots=True)
class SweepPoint:
    """One parameter value and the metric it produced."""

    value: float
    metric: float
    trade_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "metric": round(self.metric, 6),
            "trade_count": self.trade_count,
        }


@dataclass(frozen=True, slots=True)
class PlateauResult:
    """The contiguous profitable region around the best parameter value."""

    parameter: str
    best_value: float
    best_metric: float
    plateau_values: tuple[float, ...]
    plateau_fraction: float
    plateau_mean_metric: float
    swept_count: int
    profitable_count: int
    peak_to_plateau_ratio: float

    @property
    def is_plateau(self) -> bool:
        """Whether the best value sits inside a contiguous profitable region at all."""
        return len(self.plateau_values) > 1

    def passes(self, min_fraction: float) -> bool:
        """Whether the plateau is wide enough to be a region rather than a point."""
        return self.is_plateau and self.plateau_fraction >= min_fraction

    def to_dict(self) -> dict[str, Any]:
        return {
            "parameter": self.parameter,
            "best_value": self.best_value,
            "best_metric": round(self.best_metric, 6),
            "plateau_values": list(self.plateau_values),
            "plateau_fraction": round(self.plateau_fraction, 6),
            "plateau_mean_metric": round(self.plateau_mean_metric, 6),
            "swept_count": self.swept_count,
            "profitable_count": self.profitable_count,
            "peak_to_plateau_ratio": round(self.peak_to_plateau_ratio, 6),
            "is_plateau": self.is_plateau,
        }


@dataclass(frozen=True, slots=True)
class ParameterSweep:
    """The results of varying one parameter."""

    parameter: str
    points: tuple[SweepPoint, ...]

    def __post_init__(self) -> None:
        if len(self.points) < 3:
            raise ValueError(
                f"a sweep of {self.parameter!r} needs at least 3 points to distinguish a "
                f"plateau from a peak, got {len(self.points)}"
            )
        values = [p.value for p in self.points]
        if len(set(values)) != len(values):
            raise ValueError(f"sweep of {self.parameter!r} has duplicate values")

    @property
    def sorted_points(self) -> tuple[SweepPoint, ...]:
        return tuple(sorted(self.points, key=lambda p: p.value))


def find_plateau(
    sweep: ParameterSweep, *, min_metric: float = 0.0, min_trades: int = 0
) -> PlateauResult:
    """Find the contiguous profitable region containing the best parameter value.

    Args:
        sweep: the swept results, in any order.
        min_metric: the threshold a point must clear to count as profitable. Zero means
            "better than break-even"; a higher bar can be set for promotion.
        min_trades: points with fewer trades than this are excluded — a parameter value
            that produced three trades tells you nothing, and including it would let a
            plateau be built out of noise.

    Returns:
        A :class:`PlateauResult`. ``plateau_fraction`` is the plateau's width as a
        fraction of the swept range, which is what the promotion gate thresholds on.
    """
    points = sweep.sorted_points
    qualifying = [p.metric > min_metric and p.trade_count >= min_trades for p in points]

    best_index = max(range(len(points)), key=lambda i: points[i].metric)
    best = points[best_index]

    if not qualifying[best_index]:
        # The best value does not itself qualify, so there is no plateau to speak of.
        return PlateauResult(
            parameter=sweep.parameter,
            best_value=best.value,
            best_metric=best.metric,
            plateau_values=(),
            plateau_fraction=0.0,
            plateau_mean_metric=0.0,
            swept_count=len(points),
            profitable_count=sum(qualifying),
            peak_to_plateau_ratio=0.0,
        )

    # Expand outward from the best value while neighbours also qualify.
    low = best_index
    while low > 0 and qualifying[low - 1]:
        low -= 1
    high = best_index
    while high < len(points) - 1 and qualifying[high + 1]:
        high += 1

    plateau = points[low : high + 1]
    plateau_mean = math.fsum(p.metric for p in plateau) / len(plateau)
    ratio = best.metric / plateau_mean if plateau_mean > 0 else 0.0

    return PlateauResult(
        parameter=sweep.parameter,
        best_value=best.value,
        best_metric=best.metric,
        plateau_values=tuple(p.value for p in plateau),
        plateau_fraction=len(plateau) / len(points),
        plateau_mean_metric=plateau_mean,
        swept_count=len(points),
        profitable_count=sum(qualifying),
        # A peak far above its own neighbourhood is the signature of an outlier, even
        # when the neighbourhood is technically profitable.
        peak_to_plateau_ratio=ratio,
    )


def sweep_from_results(
    parameter: str, results: Sequence[tuple[float, float, int]]
) -> ParameterSweep:
    """Build a sweep from ``(value, metric, trade_count)`` triples."""
    return ParameterSweep(
        parameter=parameter,
        points=tuple(SweepPoint(v, m, n) for v, m, n in results),
    )
