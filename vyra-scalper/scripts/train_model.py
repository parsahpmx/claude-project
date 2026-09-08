#!/usr/bin/env python3
"""Train a regime classifier and report what it finds.

Deliberately not a tuning loop. It builds a dataset from a data source, trains once,
evaluates out of sample, writes an artifact and prints the result — including when the
result is "no better than chance", which on a synthetic dataset is the expected answer and
would be a suspicious one to avoid printing.

The artifact records the dataset's content hash, the config hash, the git commit and the
derived seed. A model that cannot name all four cannot be reproduced, and the artifact says
so rather than implying otherwise.

    python3 scripts/train_model.py --output models/regime.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config.loader import load_bundle
from core.features.engine import FeatureConfig, FeatureEngine
from core.instruments.registry import InstrumentRegistry
from core.market_data.bars import BarEngine
from core.ml import build_dataset
from core.ml.model import train
from core.util.clock import from_iso
from core.util.ids import derive_seed
from core.util.logging import configure_logging

DEFAULT_FEATURES = (
    "atr", "rsi", "roc", "realized_vol", "parkinson_vol", "close_std",
    "trade_imbalance", "aggressive_buyer_ratio", "window_delta",
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a VYRA regime classifier")
    parser.add_argument("--config", default="configs")
    parser.add_argument("--instrument", default="CME:MES")
    parser.add_argument("--start", default="2024-03-04T00:00:00Z")
    parser.add_argument("--end", default="2024-03-09T00:00:00Z")
    parser.add_argument("--timeframe", default="1m")
    parser.add_argument("--horizon", type=int, default=5)
    parser.add_argument("--splits", type=int, default=5)
    parser.add_argument("--embargo", type=int, default=10)
    parser.add_argument("--master-seed", type=int, default=20240315)
    parser.add_argument("--model-id", default="regime_lr_v1")
    parser.add_argument("--output", default="models/regime_lr_v1.json")
    parser.add_argument("--log-level", default="WARNING")
    args = parser.parse_args()

    configure_logging(args.log_level)
    bundle = load_bundle(args.config)
    registry = InstrumentRegistry.from_config(bundle["markets"], bundle["sessions"])
    instrument = registry.get(args.instrument)

    from core.events import Timeframe
    from data.collectors.synthetic import SyntheticConfig, SyntheticTickSource

    timeframe = Timeframe(args.timeframe)
    source = SyntheticTickSource(
        instrument,
        SyntheticConfig(seed=derive_seed(args.master_seed, "synthetic")),
        registry.calendar(args.instrument),
    )
    # SYNTHETIC data supports no claim about a market. It exercises the pipeline, and the
    # result below is a statement about the pipeline, not about MES.
    bars = BarEngine(
        instrument_id=args.instrument,
        exchange=instrument.exchange,
        timeframes=[timeframe],
        calendar=registry.calendar(args.instrument),
    )
    engine = FeatureEngine(
        {args.instrument: instrument},
        FeatureConfig.from_params({}, timeframe),
        calendars={args.instrument: registry.calendar(args.instrument)},
    )

    def events():
        for event in source.events(from_iso(args.start), from_iso(args.end)):
            yield event
            yield from bars.on_event(event)

    dataset = build_dataset(
        events(),
        engine,
        instrument_id=args.instrument,
        feature_names=DEFAULT_FEATURES,
        label_horizon=args.horizon,
    )
    print(json.dumps({"dataset": dataset.summary()}, indent=2))
    if len(dataset) == 0:
        print("no usable rows; nothing to train on", file=sys.stderr)
        return 1

    result = train(
        dataset,
        model_id=args.model_id,
        # Synthetic data has no manifest hash. Recorded as absent rather than faked, and
        # the artifact carries the warning that follows from it.
        dataset_sha256="",
        dataset_id=f"SYNTHETIC:{args.instrument}",
        config_hash=bundle.hash,
        master_seed=args.master_seed,
        n_splits=args.splits,
        embargo=args.embargo,
    )
    result.artifact.write(args.output)

    print(json.dumps({
        "verdict": result.verdict,
        "usable": result.is_usable,
        "reasons": result.reasons,
        "out_of_sample": result.artifact.oos_metrics,
        "training_only_do_not_quote": result.artifact.train_metrics,
        "folds": result.fold_metrics,
        "reproducible": result.artifact.is_reproducible,
        "warnings": result.artifact.warnings,
    }, indent=2))
    # Exit non-zero when the model is not usable, so this is a gate rather than a report.
    return 0 if result.is_usable else 2


if __name__ == "__main__":
    raise SystemExit(main())
