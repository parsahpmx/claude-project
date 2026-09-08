"""Trade ledger and run outputs.

Writes the artefacts every run produces: the trade ledger, the equity curve, orders,
fills, risk events and a human-readable report.

Losing runs are written with exactly the same fidelity as winning ones and are never
deleted.  That is a design requirement, not a convention: the value of a research archive
is in the experiments that failed.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from core.analytics.metrics import PerformanceReport
from core.portfolio.portfolio import EquityPoint
from core.portfolio.position import RealizedTrade
from core.util.logging import get_logger

__all__ = ["RunWriter", "write_jsonl"]

_log = get_logger("analytics.ledger")


def write_jsonl(path: Path, rows: Sequence[dict[str, Any]]) -> Path:
    """Write rows as newline-delimited JSON.

    JSONL rather than a columnar format so a partially written file from an interrupted
    run is still readable up to the last complete line.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        for row in rows:
            handle.write(json.dumps(row, default=str, sort_keys=True) + "\n")
    return path


class RunWriter:
    """Writes every artefact for one run into ``runs/<run_id>/``."""

    __slots__ = ("_directory",)

    def __init__(self, output_root: str | Path, run_id: str) -> None:
        self._directory = Path(output_root) / run_id
        self._directory.mkdir(parents=True, exist_ok=True)

    @property
    def directory(self) -> Path:
        return self._directory

    def write_trades(self, trades: Sequence[RealizedTrade]) -> Path:
        return write_jsonl(self._directory / "trades.jsonl", [t.to_dict() for t in trades])

    def write_equity(self, curve: Sequence[EquityPoint]) -> Path:
        return write_jsonl(self._directory / "equity.jsonl", [p.to_dict() for p in curve])

    def write_orders(self, orders: Sequence[dict[str, Any]]) -> Path:
        return write_jsonl(self._directory / "orders.jsonl", list(orders))

    def write_fills(self, fills: Sequence[dict[str, Any]]) -> Path:
        return write_jsonl(self._directory / "fills.jsonl", list(fills))

    def write_risk_events(self, events: Sequence[dict[str, Any]]) -> Path:
        return write_jsonl(self._directory / "risk_events.jsonl", list(events))

    def write_metrics(self, report: PerformanceReport) -> Path:
        path = self._directory / "metrics.json"
        path.write_text(json.dumps(report.to_dict(), indent=2, sort_keys=True))
        return path

    def write_report(
        self,
        report: PerformanceReport,
        manifest: dict[str, Any],
        extra_sections: dict[str, str] | None = None,
    ) -> Path:
        """Render the human-readable report.

        Warnings come first.  A reader who stops after the first screen must still know
        whether the numbers below can be trusted.
        """
        path = self._directory / "report.md"
        lines: list[str] = []
        gross, net = report.gross, report.net

        lines.append(f"# Backtest report — {manifest.get('run_id', 'unknown')}")
        lines.append("")

        warnings = list(manifest.get("warnings") or [])
        warnings.extend(report.implausibility_warnings)
        if warnings:
            lines.append("## ⚠ Read this first")
            lines.append("")
            for warning in warnings:
                lines.append(f"* **{warning}**")
            lines.append("")

        lines.append("## Result after costs")
        lines.append("")
        verdict = (
            "positive expectancy after costs"
            if report.survives_costs
            else "**does not survive transaction costs**"
        )
        lines.append(f"This configuration shows {verdict}.")
        lines.append("")
        headroom = report.cost_headroom
        if headroom is not None:
            lines.append(
                f"Cost headroom: **{headroom:.2f}x** — costs would have to rise by this "
                "multiple before expectancy reaches zero. The validation pipeline requires "
                "at least 1.5x."
            )
        else:
            lines.append("Cost headroom: not applicable — the strategy is not profitable after costs.")
        lines.append("")

        lines.append("## Before vs after costs")
        lines.append("")
        lines.append("| Metric | Before costs | After costs |")
        lines.append("|---|---:|---:|")
        for label, key in [
            ("Total PnL", "total_pnl"),
            ("Expectancy / trade", "expectancy"),
            ("Profit factor", "profit_factor"),
            ("Sharpe (per-trade, annualised)", "sharpe"),
            ("Sortino", "sortino"),
            ("Max drawdown", "max_drawdown"),
            ("Win rate", "win_rate"),
        ]:
            lines.append(
                f"| {label} | {getattr(gross, key):,.4f} | {getattr(net, key):,.4f} |"
            )
        lines.append("")
        if net.loss_count == 0 and net.trade_count > 0:
            lines.append(
                "*Profit factor is reported as 0 because there were no losing trades, so "
                "the ratio is undefined. That is itself a finding — see the warnings above.*"
            )
            lines.append("")
        lines.append(
            f"**Cost drag: {report.cost_drag:,.2f}** "
            + (
                f"({report.cost_drag_pct_of_gross:.1%} of gross PnL)"
                if report.cost_drag_pct_of_gross is not None
                else ""
            )
        )
        lines.append("")

        lines.append("## Trade statistics")
        lines.append("")
        lines.append(f"* Trades: {net.trade_count} ({net.win_count} wins, {net.loss_count} losses)")
        lines.append(f"* Average win: {net.average_win:,.2f} / average loss: {net.average_loss:,.2f}")
        lines.append(f"* Payoff ratio: {net.payoff_ratio:.3f}")
        lines.append(f"* Average MAE: {report.average_mae:,.2f} / MFE: {report.average_mfe:,.2f}")
        lines.append(f"* Average holding time: {report.average_holding_seconds:,.1f}s")
        lines.append(f"* Trades per day: {report.trades_per_day:,.2f}")
        lines.append("")

        if report.execution:
            lines.append("## Execution quality")
            lines.append("")
            for key, value in sorted(report.execution.items()):
                lines.append(f"* {key.replace('_', ' ')}: {value:,.4f}")
            lines.append("")

        if report.by_instrument:
            lines.append("## PnL attribution")
            lines.append("")
            for title, mapping in [
                ("By instrument", report.by_instrument),
                ("By strategy", report.by_strategy),
                ("By regime", report.by_regime),
                ("By session date", report.by_session_date),
            ]:
                if not mapping:
                    continue
                lines.append(f"**{title}**")
                lines.append("")
                for key, value in sorted(mapping.items()):
                    lines.append(f"* {key}: {value:,.2f}")
                lines.append("")

        quality = manifest.get("data_quality") or {}
        if quality:
            lines.append("## Data quality")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(quality, indent=2, sort_keys=True))
            lines.append("```")
            lines.append("")

        for title, body in (extra_sections or {}).items():
            lines.append(f"## {title}")
            lines.append("")
            lines.append(body)
            lines.append("")

        lines.append("## Reproducibility")
        lines.append("")
        lines.append(f"* Reproducible: **{manifest.get('is_reproducible')}**")
        lines.append(f"* Git commit: `{manifest.get('git_commit')}` (dirty: {manifest.get('git_dirty')})")
        lines.append(f"* Config hash: `{manifest.get('config_hash')}`")
        lines.append(f"* Dataset: `{manifest.get('dataset_id')}` `{manifest.get('dataset_fingerprint')}`")
        lines.append(f"* Fill model: `{manifest.get('fill_model')}` · seed `{manifest.get('random_seed')}`")
        lines.append(f"* Result hash: `{manifest.get('result_hash')}`")
        lines.append("")
        lines.append(
            f"Replay with: `python scripts/replay_run.py {self._directory / 'manifest.json'}`"
        )
        lines.append("")

        path.write_text("\n".join(lines))
        return path

    def summary_line(self, report: PerformanceReport) -> str:
        return (
            f"net={report.net.total_pnl:,.2f} gross={report.gross.total_pnl:,.2f} "
            f"drag={report.cost_drag:,.2f} trades={report.net.trade_count} "
            f"survives_costs={report.survives_costs}"
        )
