#!/usr/bin/env python3
"""Run the reference backtest from configuration.

Usage:
    python scripts/run_backtest.py [--config configs] [--output runs] [--log-level INFO]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.backtest.runner import run_backtest  # noqa: E402
from core.util.logging import configure_logging  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a VYRA backtest")
    parser.add_argument("--config", default=str(REPO_ROOT / "configs"))
    parser.add_argument("--output", default=None, help="output root (default: from config)")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--log-level", default="WARNING")
    parser.add_argument("--quiet", action="store_true", help="print only the summary line")
    args = parser.parse_args()

    configure_logging(args.log_level)
    run = run_backtest(
        config_dir=args.config, output_root=args.output, run_id=args.run_id
    )

    summary = run.summary
    if args.quiet:
        print(json.dumps(summary))
        return 0

    print(f"\nRun {run.run_id}  ->  {run.output_directory}")
    if summary["warnings"]:
        print("\nWarnings:")
        for warning in summary["warnings"]:
            print(f"  ! {warning}")

    report = run.report
    print("\n  Metric                    Before costs      After costs")
    print("  " + "-" * 55)
    rows = [
        ("Total PnL", report.gross.total_pnl, report.net.total_pnl),
        ("Expectancy / trade", report.gross.expectancy, report.net.expectancy),
        ("Profit factor", report.gross.profit_factor, report.net.profit_factor),
        ("Sharpe", report.gross.sharpe, report.net.sharpe),
        ("Max drawdown", report.gross.max_drawdown, report.net.max_drawdown),
    ]
    for label, gross, net in rows:
        print(f"  {label:<24} {gross:>14,.4f} {net:>16,.4f}")

    print(f"\n  Cost drag: {report.cost_drag:,.2f}", end="")
    if report.cost_drag_pct_of_gross is not None:
        print(f" ({report.cost_drag_pct_of_gross:.1%} of gross)")
    else:
        print()
    print(f"  Trades: {report.net.trade_count}   Survives costs: {report.survives_costs}")
    headroom = report.cost_headroom
    print(f"  Cost headroom: {headroom:.2f}x" if headroom else "  Cost headroom: n/a")
    print(f"  Halted: {run.result.halted}")
    print(f"\n  Result hash: {run.manifest.result_hash}")
    print(f"  Reproducible: {run.manifest.is_reproducible}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
