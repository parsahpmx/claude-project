#!/usr/bin/env python3
"""Run the validation pipeline for a strategy and print the promotion verdict.

Usage:
    python scripts/validate_strategy.py vwap_mean_reversion [--config configs]

Exit code 0 means approved for promotion, 1 means not. That makes the gate usable from CI:
a strategy cannot be deployed by a pipeline that never asked.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.config.loader import load_bundle  # noqa: E402
from core.util.logging import configure_logging  # noqa: E402
from core.validation.pipeline import PipelineConfig, ValidationPipeline  # noqa: E402
from core.validation.promotion import PromotionCriteria  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a VYRA strategy")
    parser.add_argument("strategy", help="strategy id from strategies.yaml")
    parser.add_argument("--config", default=str(REPO_ROOT / "configs"))
    parser.add_argument("--work-dir", default=None)
    # INFO by default: the pipeline runs a dozen backtests and a silent one looks hung.
    parser.add_argument("--log-level", default="INFO")
    parser.add_argument("--json", action="store_true", help="emit the full report as JSON")
    args = parser.parse_args()

    configure_logging(args.log_level)
    bundle = load_bundle(args.config, ["validation", "strategies"])
    validation = bundle["validation"]

    pipeline = ValidationPipeline(
        config_dir=args.config,
        strategy_id=args.strategy,
        config=PipelineConfig.from_config(validation),
        criteria=PromotionCriteria.from_config(validation.section("promotion")),
        work_dir=args.work_dir or (REPO_ROOT / "runs" / "validation"),
    )
    report = pipeline.run()

    if args.json:
        print(json.dumps(report.to_dict(), indent=2, default=str))
    else:
        print()
        print(report.render())
        print()

    decision = report.decision
    return 0 if decision is not None and decision.approved else 1


if __name__ == "__main__":
    raise SystemExit(main())
