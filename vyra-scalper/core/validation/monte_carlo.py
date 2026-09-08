"""Monte Carlo resampling of a trade sequence.

A backtest produces **one** path. The question that matters is not how that path looked
but how bad the plausible paths get: a strategy whose realised drawdown was 4 % but whose
5th-percentile resampled drawdown is 22 % is a strategy that got lucky in its ordering.

Two resampling schemes, because they answer different questions:

* ``SHUFFLE`` — reorders the same trades. Isolates *sequence* risk: the same edge with a
  bad run of losses at the wrong time.
* ``BOOTSTRAP`` — samples with replacement. Also captures *sample* risk: what if the
  distribution of trades were drawn again from the same generator.

Neither invents a trade the strategy did not take, which is the property that keeps this
honest. Both are seeded and therefore reproducible.
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from core.portfolio.position import RealizedTrade
from core.util.numeric import round_money

__all__ = ["MonteCarloResult", "ResampleMethod", "run_monte_carlo"]


class ResampleMethod(StrEnum):
    SHUFFLE = "SHUFFLE"
    BOOTSTRAP = "BOOTSTRAP"


@dataclass(frozen=True, slots=True)
class MonteCarloResult:
    """Distribution of outcomes over resampled trade sequences."""

    method: ResampleMethod
    iterations: int
    trade_count: int
    starting_equity: float
    realised_pnl: float
    realised_max_drawdown: float
    median_pnl: float
    pnl_p05: float
    pnl_p95: float
    median_max_drawdown: float
    drawdown_p95: float
    worst_drawdown: float
    probability_of_loss: float
    probability_of_ruin: float
    ruin_threshold_pct: float

    @property
    def drawdown_understatement(self) -> float:
        """How much worse the 95th-percentile drawdown is than the realised one.

        The realised path is one draw. A large ratio means the backtest's drawdown figure
        owes more to ordering luck than to the strategy.
        """
        if self.realised_max_drawdown <= 0:
            return 0.0
        return self.drawdown_p95 / self.realised_max_drawdown

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method.value,
            "iterations": self.iterations,
            "trade_count": self.trade_count,
            "realised_pnl": round_money(self.realised_pnl),
            "realised_max_drawdown": round_money(self.realised_max_drawdown),
            "median_pnl": round_money(self.median_pnl),
            "pnl_p05": round_money(self.pnl_p05),
            "pnl_p95": round_money(self.pnl_p95),
            "median_max_drawdown": round_money(self.median_max_drawdown),
            "drawdown_p95": round_money(self.drawdown_p95),
            "worst_drawdown": round_money(self.worst_drawdown),
            "drawdown_understatement": round(self.drawdown_understatement, 4),
            "probability_of_loss": round(self.probability_of_loss, 6),
            "probability_of_ruin": round(self.probability_of_ruin, 6),
            "ruin_threshold_pct": self.ruin_threshold_pct,
        }


def _percentile(sorted_values: Sequence[float], fraction: float) -> float:
    """Linear-interpolated percentile of an already-sorted sequence."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = fraction * (len(sorted_values) - 1)
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return sorted_values[int(position)]
    weight = position - low
    return sorted_values[low] * (1 - weight) + sorted_values[high] * weight


def _path_statistics(pnls: Sequence[float]) -> tuple[float, float]:
    """Total PnL and maximum drawdown of one equity path."""
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for pnl in pnls:
        equity += pnl
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    return equity, max_drawdown


def run_monte_carlo(
    trades: Sequence[RealizedTrade],
    starting_equity: float,
    *,
    iterations: int = 1_000,
    method: ResampleMethod = ResampleMethod.BOOTSTRAP,
    ruin_threshold_pct: float = 0.20,
    seed: int = 0,
) -> MonteCarloResult:
    """Resample the trade sequence and summarise the distribution of outcomes.

    Args:
        trades: the realised trades. **Net** PnL is used — a Monte Carlo on gross PnL
            would answer a question about a strategy nobody can trade.
        ruin_threshold_pct: drawdown fraction of starting equity treated as ruin.
        seed: makes the result reproducible, like every other number in the platform.

    Raises:
        ValueError: if there are no trades, or fewer than two — a distribution over one
            observation is not a distribution.
    """
    if starting_equity <= 0:
        raise ValueError(f"starting_equity must be positive, got {starting_equity}")
    if len(trades) < 2:
        raise ValueError(
            f"Monte Carlo needs at least 2 trades, got {len(trades)}. A distribution over "
            "one observation is not a distribution."
        )
    if iterations < 1:
        raise ValueError(f"iterations must be positive, got {iterations}")

    pnls = [t.net_pnl for t in trades]
    realised_pnl, realised_drawdown = _path_statistics(pnls)
    ruin_level = starting_equity * ruin_threshold_pct

    rng = random.Random(seed)
    total_pnls: list[float] = []
    drawdowns: list[float] = []
    ruined = 0

    for _ in range(iterations):
        if method is ResampleMethod.SHUFFLE:
            path = pnls[:]
            rng.shuffle(path)
        else:
            path = [pnls[rng.randrange(len(pnls))] for _ in range(len(pnls))]
        total, drawdown = _path_statistics(path)
        total_pnls.append(total)
        drawdowns.append(drawdown)
        if drawdown >= ruin_level:
            ruined += 1

    total_pnls.sort()
    drawdowns.sort()

    return MonteCarloResult(
        method=method,
        iterations=iterations,
        trade_count=len(trades),
        starting_equity=starting_equity,
        realised_pnl=realised_pnl,
        realised_max_drawdown=realised_drawdown,
        median_pnl=_percentile(total_pnls, 0.5),
        pnl_p05=_percentile(total_pnls, 0.05),
        pnl_p95=_percentile(total_pnls, 0.95),
        median_max_drawdown=_percentile(drawdowns, 0.5),
        drawdown_p95=_percentile(drawdowns, 0.95),
        worst_drawdown=drawdowns[-1],
        probability_of_loss=sum(1 for p in total_pnls if p <= 0) / iterations,
        probability_of_ruin=ruined / iterations,
        ruin_threshold_pct=ruin_threshold_pct,
    )
