"""Performance metrics.

Every metric is computed **twice**: before transaction costs and after.  The difference is
the platform's central finding, so it is reported side by side rather than as a footnote
(§17 of the platform specification).

Metrics are computed from the trade ledger and equity curve, both of which are produced by
the same engine that would have traded live.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from core.portfolio.portfolio import EquityPoint
from core.portfolio.position import RealizedTrade
from core.util.clock import NS_PER_DAY, NS_PER_SEC
from core.util.numeric import round_money, safe_div

__all__ = ["MetricSet", "PerformanceReport", "compute_metrics"]

_TRADING_DAYS_PER_YEAR = 252

# Thresholds for the plausibility check.  Deliberately generous: the point is to catch
# results that are obviously artefacts, not to second-guess a merely good one.
_MIN_TRADES_FOR_PLAUSIBILITY = 100
_IMPLAUSIBLE_WIN_RATE = 0.90
_IMPLAUSIBLE_SHARPE = 10.0


@dataclass(frozen=True, slots=True)
class MetricSet:
    """One consistent set of performance figures.

    Produced twice per report: once on gross PnL and once on net.
    """

    label: str
    total_pnl: float = 0.0
    trade_count: int = 0
    win_count: int = 0
    loss_count: int = 0
    win_rate: float = 0.0
    average_win: float = 0.0
    average_loss: float = 0.0
    payoff_ratio: float = 0.0
    profit_factor: float = 0.0
    expectancy: float = 0.0
    largest_win: float = 0.0
    largest_loss: float = 0.0
    sharpe: float = 0.0
    sortino: float = 0.0
    calmar: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_pct: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "total_pnl": round_money(self.total_pnl),
            "trade_count": self.trade_count,
            "win_count": self.win_count,
            "loss_count": self.loss_count,
            "win_rate": round(self.win_rate, 6),
            "average_win": round_money(self.average_win),
            "average_loss": round_money(self.average_loss),
            "payoff_ratio": round(self.payoff_ratio, 6),
            "profit_factor": round(self.profit_factor, 6),
            "expectancy": round_money(self.expectancy),
            "largest_win": round_money(self.largest_win),
            "largest_loss": round_money(self.largest_loss),
            "sharpe": round(self.sharpe, 6),
            "sortino": round(self.sortino, 6),
            "calmar": round(self.calmar, 6),
            "max_drawdown": round_money(self.max_drawdown),
            "max_drawdown_pct": round(self.max_drawdown_pct, 6),
        }


@dataclass(frozen=True, slots=True)
class PerformanceReport:
    """Gross and net metrics plus the cost breakdown that separates them."""

    gross: MetricSet
    net: MetricSet
    starting_equity: float
    ending_equity: float
    commission_cost: float = 0.0
    exchange_fee_cost: float = 0.0
    total_cost: float = 0.0
    average_holding_seconds: float = 0.0
    trades_per_day: float = 0.0
    average_mae: float = 0.0
    average_mfe: float = 0.0
    max_drawdown_duration_ns: int = 0
    average_drawdown_pct: float = 0.0
    by_instrument: dict[str, float] = field(default_factory=dict)
    by_strategy: dict[str, float] = field(default_factory=dict)
    by_regime: dict[str, float] = field(default_factory=dict)
    by_hour: dict[int, float] = field(default_factory=dict)
    by_session_date: dict[str, float] = field(default_factory=dict)
    execution: dict[str, float] = field(default_factory=dict)

    @property
    def cost_drag(self) -> float:
        """Money the costs removed.  The number a gross-only report hides."""
        return round_money(self.gross.total_pnl - self.net.total_pnl)

    @property
    def cost_drag_pct_of_gross(self) -> float | None:
        """Costs as a fraction of gross PnL, or ``None`` when gross PnL is zero."""
        if self.gross.total_pnl == 0:
            return None
        return self.cost_drag / abs(self.gross.total_pnl)

    @property
    def implausibility_warnings(self) -> list[str]:
        """Result shapes that are far more often a bug than an edge.

        A backtest that reports no losing trades, or a Sharpe an order of magnitude above
        what any real strategy sustains, is almost always describing the test bed rather
        than the market: leaked future information, a fill model that never says no, or
        synthetic data with the answer built into it. Surfacing these next to the
        headline number is the difference between a platform that measures and one that
        flatters.
        """
        warnings: list[str] = []
        net = self.net

        if net.trade_count >= _MIN_TRADES_FOR_PLAUSIBILITY and net.loss_count == 0:
            warnings.append(
                f"NO LOSING TRADES in {net.trade_count} trades. Real strategies lose. "
                "Check for look-ahead, an over-permissive fill model, or data that "
                "contains the answer."
            )
        if net.trade_count >= _MIN_TRADES_FOR_PLAUSIBILITY and net.win_rate >= _IMPLAUSIBLE_WIN_RATE:
            warnings.append(
                f"WIN RATE {net.win_rate:.1%} over {net.trade_count} trades is implausibly "
                "high for a short-horizon strategy."
            )
        if abs(net.sharpe) >= _IMPLAUSIBLE_SHARPE:
            warnings.append(
                f"SHARPE {net.sharpe:.1f} is far outside the range any real strategy "
                "sustains. Treat as a modelling artefact until proven otherwise."
            )
        if net.trade_count and net.trade_count < _MIN_TRADES_FOR_PLAUSIBILITY:
            warnings.append(
                f"ONLY {net.trade_count} TRADES. Too few to distinguish edge from noise; "
                f"the validation pipeline requires at least {_MIN_TRADES_FOR_PLAUSIBILITY}."
            )
        return warnings

    @property
    def survives_costs(self) -> bool:
        """Whether expectancy is still positive after costs.

        The only question the platform exists to answer.
        """
        return self.net.expectancy > 0 and self.net.total_pnl > 0

    @property
    def cost_headroom(self) -> float | None:
        """How many times current costs the strategy could bear before breaking even.

        ``None`` when it does not survive costs at all.  Below about 1.5x there is no
        margin for real-world cost drift, and the validation pipeline rejects it
        (``BACKTEST_SPEC.md`` §8).
        """
        if self.cost_drag <= 0 or self.net.total_pnl <= 0:
            return None
        return self.gross.total_pnl / self.cost_drag

    def to_dict(self) -> dict[str, Any]:
        return {
            "gross": self.gross.to_dict(),
            "net": self.net.to_dict(),
            "starting_equity": round_money(self.starting_equity),
            "ending_equity": round_money(self.ending_equity),
            "return_pct": round(
                safe_div(
                    self.ending_equity - self.starting_equity, self.starting_equity, 0.0
                ),
                6,
            ),
            "costs": {
                "commission": round_money(self.commission_cost),
                "exchange_fees": round_money(self.exchange_fee_cost),
                "total": round_money(self.total_cost),
                "drag": self.cost_drag,
                "drag_pct_of_gross": self.cost_drag_pct_of_gross,
                "headroom": self.cost_headroom,
            },
            "survives_costs": self.survives_costs,
            "implausibility_warnings": self.implausibility_warnings,
            "average_holding_seconds": round(self.average_holding_seconds, 3),
            "trades_per_day": round(self.trades_per_day, 4),
            "average_mae": round_money(self.average_mae),
            "average_mfe": round_money(self.average_mfe),
            "max_drawdown_duration_days": round(
                self.max_drawdown_duration_ns / NS_PER_DAY, 4
            ),
            "average_drawdown_pct": round(self.average_drawdown_pct, 6),
            "pnl_by_instrument": {k: round_money(v) for k, v in sorted(self.by_instrument.items())},
            "pnl_by_strategy": {k: round_money(v) for k, v in sorted(self.by_strategy.items())},
            "pnl_by_regime": {k: round_money(v) for k, v in sorted(self.by_regime.items())},
            "pnl_by_hour": {str(k): round_money(v) for k, v in sorted(self.by_hour.items())},
            "pnl_by_session_date": {
                k: round_money(v) for k, v in sorted(self.by_session_date.items())
            },
            "execution": {k: round(v, 6) for k, v in sorted(self.execution.items())},
        }


def _metrics_from(
    label: str, pnls: Sequence[float], equity_curve: Sequence[EquityPoint], starting_equity: float
) -> MetricSet:
    """Compute one metric set from a PnL series and the equity curve."""
    if not pnls:
        return MetricSet(label=label)

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_profit = math.fsum(wins)
    gross_loss = abs(math.fsum(losses))
    total = math.fsum(pnls)

    average_win = gross_profit / len(wins) if wins else 0.0
    average_loss = gross_loss / len(losses) if losses else 0.0
    win_rate = len(wins) / len(pnls)

    # Profit factor is undefined without a losing trade.  Reporting ``inf`` would let a
    # sample of three winners look like the best strategy ever measured, so it is reported
    # as 0 and the trade count next to it tells the reader why.
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0
    expectancy = total / len(pnls)
    payoff = average_win / average_loss if average_loss > 0 else 0.0

    max_dd, max_dd_pct = _drawdown_from(equity_curve, starting_equity)
    sharpe, sortino = _risk_adjusted(pnls, starting_equity)
    years = _years_spanned(equity_curve)
    annual_return = (total / starting_equity) / years if years > 0 and starting_equity > 0 else 0.0
    calmar = annual_return / max_dd_pct if max_dd_pct > 0 else 0.0

    return MetricSet(
        label=label,
        total_pnl=total,
        trade_count=len(pnls),
        win_count=len(wins),
        loss_count=len(losses),
        win_rate=win_rate,
        average_win=average_win,
        average_loss=average_loss,
        payoff_ratio=payoff,
        profit_factor=profit_factor,
        expectancy=expectancy,
        largest_win=max(wins) if wins else 0.0,
        largest_loss=min(losses) if losses else 0.0,
        sharpe=sharpe,
        sortino=sortino,
        calmar=calmar,
        max_drawdown=max_dd,
        max_drawdown_pct=max_dd_pct,
    )


def _risk_adjusted(pnls: Sequence[float], starting_equity: float) -> tuple[float, float]:
    """Per-trade Sharpe and Sortino, annualised by trade frequency.

    Computed on per-trade returns rather than daily ones because a scalping strategy may
    place many trades in a day and few over a month; annualising from trade count keeps
    the figure comparable across strategies. The assumption is stated here so the number
    is not mistaken for a conventional daily Sharpe.
    """
    if len(pnls) < 2 or starting_equity <= 0:
        return 0.0, 0.0
    returns = [p / starting_equity for p in pnls]
    mean = math.fsum(returns) / len(returns)
    variance = math.fsum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    std = math.sqrt(max(0.0, variance))
    downside = [r for r in returns if r < 0]
    downside_std = (
        math.sqrt(math.fsum(r * r for r in downside) / len(downside)) if downside else 0.0
    )
    scale = math.sqrt(_TRADING_DAYS_PER_YEAR)
    sharpe = (mean / std) * scale if std > 0 else 0.0
    sortino = (mean / downside_std) * scale if downside_std > 0 else 0.0
    return sharpe, sortino


def _drawdown_from(
    curve: Sequence[EquityPoint], starting_equity: float
) -> tuple[float, float]:
    if not curve:
        return 0.0, 0.0
    peak = starting_equity
    max_dd = 0.0
    max_dd_pct = 0.0
    for point in curve:
        peak = max(peak, point.equity)
        drawdown = peak - point.equity
        if drawdown > max_dd:
            max_dd = drawdown
            max_dd_pct = drawdown / peak if peak > 0 else 0.0
    return max_dd, max_dd_pct


def _years_spanned(curve: Sequence[EquityPoint]) -> float:
    if len(curve) < 2:
        return 0.0
    span_ns = curve[-1].ts - curve[0].ts
    return span_ns / (NS_PER_DAY * 365.25) if span_ns > 0 else 0.0


def _drawdown_duration(curve: Sequence[EquityPoint]) -> tuple[int, float]:
    """Longest time underwater, and the average drawdown depth."""
    if not curve:
        return 0, 0.0
    peak = curve[0].equity
    peak_ts = curve[0].ts
    longest = 0
    depths: list[float] = []
    for point in curve:
        if point.equity >= peak:
            longest = max(longest, point.ts - peak_ts)
            peak, peak_ts = point.equity, point.ts
        elif peak > 0:
            depths.append((peak - point.equity) / peak)
    longest = max(longest, curve[-1].ts - peak_ts)
    average = math.fsum(depths) / len(depths) if depths else 0.0
    return longest, average


def compute_metrics(
    trades: Sequence[RealizedTrade],
    equity_curve: Sequence[EquityPoint],
    starting_equity: float,
    ending_equity: float,
    *,
    regime_by_trade: dict[int, str] | None = None,
    session_dates: dict[int, date] | None = None,
    execution_stats: dict[str, float] | None = None,
) -> PerformanceReport:
    """Build the full report.

    Args:
        trades: closed round trips.
        equity_curve: the marked equity series.
        starting_equity / ending_equity: account bounds.
        regime_by_trade: optional regime label per trade index, for regime attribution.
        session_dates: optional trading date per trade index.
        execution_stats: fill rate, reject rate, latency and slippage aggregates.
    """
    gross_pnls = [t.gross_pnl for t in trades]
    net_pnls = [t.net_pnl for t in trades]

    gross = _metrics_from("before costs", gross_pnls, equity_curve, starting_equity)
    net = _metrics_from("after costs", net_pnls, equity_curve, starting_equity)

    commission = math.fsum(t.fees for t in trades)
    holding = (
        math.fsum(t.holding_ns for t in trades) / len(trades) / NS_PER_SEC if trades else 0.0
    )
    span_days = _years_spanned(equity_curve) * 365.25
    trades_per_day = len(trades) / span_days if span_days > 0 else 0.0
    dd_duration, average_dd = _drawdown_duration(equity_curve)

    by_instrument: dict[str, float] = {}
    by_strategy: dict[str, float] = {}
    by_regime: dict[str, float] = {}
    by_hour: dict[int, float] = {}
    by_session: dict[str, float] = {}

    for index, trade in enumerate(trades):
        by_instrument[trade.instrument_id] = (
            by_instrument.get(trade.instrument_id, 0.0) + trade.net_pnl
        )
        by_strategy[trade.strategy_id] = by_strategy.get(trade.strategy_id, 0.0) + trade.net_pnl
        if regime_by_trade and index in regime_by_trade:
            regime = regime_by_trade[index]
            by_regime[regime] = by_regime.get(regime, 0.0) + trade.net_pnl
        hour = int((trade.exit_ts // 3_600_000_000_000) % 24)
        by_hour[hour] = by_hour.get(hour, 0.0) + trade.net_pnl
        if session_dates and index in session_dates:
            key = session_dates[index].isoformat()
            by_session[key] = by_session.get(key, 0.0) + trade.net_pnl

    return PerformanceReport(
        gross=gross,
        net=net,
        starting_equity=starting_equity,
        ending_equity=ending_equity,
        commission_cost=commission,
        exchange_fee_cost=0.0,
        total_cost=commission,
        average_holding_seconds=holding,
        trades_per_day=trades_per_day,
        average_mae=math.fsum(t.mae for t in trades) / len(trades) if trades else 0.0,
        average_mfe=math.fsum(t.mfe for t in trades) / len(trades) if trades else 0.0,
        max_drawdown_duration_ns=dd_duration,
        average_drawdown_pct=average_dd,
        by_instrument=by_instrument,
        by_strategy=by_strategy,
        by_regime=by_regime,
        by_hour=by_hour,
        by_session_date=by_session,
        execution=execution_stats or {},
    )
