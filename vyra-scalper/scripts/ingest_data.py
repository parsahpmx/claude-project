#!/usr/bin/env python3
"""Ingest raw market data into the normalised Parquet layer.

Usage:
    # From vendor CSV files
    python scripts/ingest_data.py CME:MES --from csv --files data/raw/mes_*.csv \
        --start 2024-01-01T00:00:00Z --end 2024-04-01T00:00:00Z --out data_store/mes_q1

    # From the synthetic generator (plumbing only; the dataset is watermarked)
    python scripts/ingest_data.py CME:MES --from synthetic \
        --start 2024-03-04T00:00:00Z --end 2024-03-09T00:00:00Z --out data_store/mes_synth

The output directory carries a ``_manifest.json`` recording provenance, the rejection
counters, the gaps, and a content hash. A backtest that reads the dataset references that
hash, so a result cannot be silently re-attributed to changed data.
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.config.loader import load_bundle  # noqa: E402
from core.instruments.registry import InstrumentRegistry  # noqa: E402
from core.util.clock import from_iso  # noqa: E402
from core.util.logging import configure_logging  # noqa: E402
from data.collectors.csv_source import CsvColumnMap, CsvTickSource  # noqa: E402
from data.collectors.synthetic import SyntheticConfig, SyntheticTickSource  # noqa: E402
from data.normalization.pipeline import IngestionConfig, IngestionPipeline  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest market data into Parquet")
    parser.add_argument("instrument", help="canonical id, e.g. CME:MES")
    parser.add_argument("--from", dest="kind", choices=["csv", "synthetic"], required=True)
    parser.add_argument("--files", nargs="*", default=[], help="CSV paths or globs")
    parser.add_argument("--start", required=True, help="ISO-8601 with offset")
    parser.add_argument("--end", required=True, help="ISO-8601 with offset")
    parser.add_argument("--out", required=True, help="dataset output directory")
    parser.add_argument("--dataset-id", default=None)
    parser.add_argument("--config", default=str(REPO_ROOT / "configs"))
    parser.add_argument("--seed", type=int, default=0, help="synthetic generator seed")
    parser.add_argument("--timestamp-column", default="timestamp")
    parser.add_argument(
        "--timestamp-format", default="iso",
        choices=["iso", "epoch_ns", "epoch_us", "epoch_ms", "epoch_s"],
        help="stated explicitly: reading milliseconds as seconds runs the backtest in 1970",
    )
    parser.add_argument(
        "--strict-ordering", action="store_true",
        help="drop out-of-order events instead of flagging them",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    configure_logging(args.log_level)
    bundle = load_bundle(args.config)
    registry = InstrumentRegistry.from_config(bundle["markets"], bundle["sessions"])
    instrument = registry.get(args.instrument)
    calendar = registry.calendar(args.instrument)
    start, end = from_iso(args.start), from_iso(args.end)

    if args.kind == "csv":
        paths: list[str] = []
        for pattern in args.files:
            matched = sorted(glob.glob(pattern))
            paths.extend(matched or [pattern])
        if not paths:
            print("no CSV files given; pass --files", file=sys.stderr)
            return 2
        source = CsvTickSource(
            instrument,
            paths,
            CsvColumnMap(
                timestamp=args.timestamp_column,
                timestamp_format=args.timestamp_format,
            ),
        )
    else:
        source = SyntheticTickSource(
            instrument, SyntheticConfig(seed=args.seed), calendar
        )

    pipeline = IngestionPipeline(
        instrument=instrument,
        output_root=args.out,
        calendar=calendar,
        config=IngestionConfig(strict_ordering=args.strict_ordering),
    )
    result = pipeline.ingest(source, start, end, args.dataset_id)

    print()
    print(result.summary())
    print(f"  directory   : {result.directory}")
    print(f"  fingerprint : {result.manifest.fingerprint}")
    if result.manifest.notes:
        print("  notes:")
        for note in result.manifest.notes:
            print(f"    ! {note}")
    print()
    print("  To use it, set in backtest.yaml:")
    print("    data:")
    print("      source: PARQUET")
    print("      parquet:")
    print(f"        root: {result.directory}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
