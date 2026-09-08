"""Transaction-cost, latency and slippage stress tests.

A strategy whose expectancy disappears when costs rise 20 % has no margin: real costs drift
with volatility, venue fees change, and a live fill is not a modelled one. The number this
module produces — the multiple at which expectancy reaches zero — is the one that says how
much room there actually is (``BACKTEST_SPEC.md`` §8).

Cost headroom is computed analytically from the realised trade ledger rather than by
re-running the backtest. That is deliberate and its limitation is stated: scaling costs
does not change *which* trades were taken, whereas a re-run at higher costs might trade
differently. The analytic figure is therefore an **upper bound** on headroom — the honest
direction for a safety measure to err.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from core.portfolio.position import RealizedTrade
from core.util.numeric import round_money

__all__ = ["StressPoint", "StressResult", "run_cost_stress"]


@dataclass(frozen=True, slots=True)
class StressPoint:
    """Performance at one cost multiple."""

    multiple: float
    net_pnl: float
    expectancy: float
    win_count: int
    loss_count: int

    @property
    def survives(self) -> bool:
        return self.expectancy > 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "multiple": self.multiple,
            "net_pnl": round_money(self.net_pnl),
            "expectancy": round(self.expectancy, 6),
            "win_count": self.win_count,
            "loss_count": self.loss_count,
            "survives": self.survives,
        }


@dataclass(frozen=True, slots=True)
class StressResult:
    """The cost curve and the point at which the edge disappears."""

    points: tuple[StressPoint, ...]
    breakeven_multiple: float | None
    baseline_expectancy: float
    fee_share_of_gross: float

    @property
    def headroom(self) -> float | None:
        """Cost multiple at which expectancy reaches zero.

        ``None`` when the strategy has no edge at 1x, in which case headroom is not a
        meaningful question.
        """
        return self.breakeven_multiple

    def passes(self, minimum: float) -> bool:
        return self.breakeven_multiple is not None and self.breakeven_multiple >= minimum

    def to_dict(self) -> dict[str, Any]:
        return {
            "points": [p.to_dict() for p in self.points],
            "breakeven_multiple": (
                round(self.breakeven_multiple, 4)
                if self.breakeven_multiple is not None
                else None
            ),
            "baseline_expectancy": round(self.baseline_expectancy, 6),
            "fee_share_of_gross": round(self.fee_share_of_gross, 6),
            "note": (
                "Computed analytically from the realised ledger. Scaling costs does not "
                "change which trades were taken, so this is an upper bound on headroom."
            ),
        }


def _restate(trades: Sequence[RealizedTrade], multiple: float) -> StressPoint:
    """Recompute performance with fees scaled by ``multiple``."""
    net_pnls = [t.gross_pnl - t.fees * multiple for t in trades]
    total = math.fsum(net_pnls)
    return StressPoint(
        multiple=multiple,
        net_pnl=total,
        expectancy=total / len(net_pnls) if net_pnls else 0.0,
        win_count=sum(1 for p in net_pnls if p > 0),
        loss_count=sum(1 for p in net_pnls if p < 0),
    )


def run_cost_stress(
    trades: Sequence[RealizedTrade],
    multiples: Sequence[float] = (1.0, 1.5, 2.0, 3.0, 5.0),
    *,
    breakeven_tolerance: float = 1e-4,
    max_search_multiple: float = 100.0,
) -> StressResult:
    """Restate performance at several cost multiples and locate the break-even point.

    Args:
        multiples: cost multiples to report. ``1.0`` (the realised costs) should be
            included so the curve has a baseline.
        breakeven_tolerance: bisection precision on the break-even multiple.
        max_search_multiple: upper bound for the search. A strategy that still has an edge
            at 100x its costs is reported as such rather than searched indefinitely.

    Raises:
        ValueError: if there are no trades. A cost curve over nothing is not a curve.
    """
    if not trades:
        raise ValueError("cost stress requires at least one trade")

    points = tuple(_restate(trades, m) for m in sorted(set(multiples)))
    baseline = _restate(trades, 1.0)

    gross = math.fsum(t.gross_pnl for t in trades)
    fees = math.fsum(t.fees for t in trades)
    fee_share = fees / abs(gross) if gross != 0 else float("inf")

    breakeven = _find_breakeven(
        trades, baseline.expectancy, breakeven_tolerance, max_search_multiple
    )
    return StressResult(
        points=points,
        breakeven_multiple=breakeven,
        baseline_expectancy=baseline.expectancy,
        fee_share_of_gross=fee_share if math.isfinite(fee_share) else 0.0,
    )


def _find_breakeven(
    trades: Sequence[RealizedTrade],
    baseline_expectancy: float,
    tolerance: float,
    maximum: float,
) -> float | None:
    """Bisect for the cost multiple at which expectancy reaches zero.

    Expectancy is strictly decreasing in the cost multiple whenever any fee was paid, so
    bisection is exact rather than a heuristic.
    """
    if baseline_expectancy <= 0:
        return None
    if math.fsum(t.fees for t in trades) <= 0:
        # No costs were charged, so no multiple of them removes the edge. That is itself
        # suspicious and is reported as unbounded rather than as a large finite number.
        return maximum

    if _restate(trades, maximum).expectancy > 0:
        return maximum

    low, high = 1.0, maximum
    while high - low > tolerance:
        mid = (low + high) / 2.0
        if _restate(trades, mid).expectancy > 0:
            low = mid
        else:
            high = mid
    return low
