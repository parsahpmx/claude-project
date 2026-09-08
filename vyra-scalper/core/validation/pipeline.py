"""The validation pipeline.

Runs the eight stages of ``BACKTEST_SPEC.md`` §8 in order and hands the evidence to the
promotion gate. The order is not decorative: the out-of-sample window is not touched until
the in-sample and validation stages are complete, because a window looked at earlier is no
longer out of sample.

Each stage runs a real backtest through :func:`core.backtest.runner.run_backtest`, so the
pipeline validates the production engine rather than a model of it.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from core.analytics.metrics import PerformanceReport
from core.events import FillModel
from core.portfolio.position import RealizedTrade
from core.util.clock import Nanos, format_duration, from_iso, monotonic_ns, to_iso
from core.util.logging import get_logger
from core.validation.monte_carlo import MonteCarloResult, ResampleMethod, run_monte_carlo
from core.validation.promotion import PromotionCriteria, PromotionDecision, PromotionGate
from core.validation.sensitivity import (
    ParameterSweep,
    PlateauResult,
    SweepPoint,
    find_plateau,
)
from core.validation.stress import StressResult, run_cost_stress
from core.validation.windows import (
    Split,
    WalkForwardMode,
    WindowSplitter,
    walk_forward_windows,
)

__all__ = ["PipelineConfig", "ValidationPipeline", "ValidationReport"]

_log = get_logger("validation.pipeline")


@dataclass(frozen=True, slots=True)
class PipelineConfig:
    """How the pipeline is run. Everything is configuration."""

    in_sample_fraction: float = 0.5
    validation_fraction: float = 0.2
    walk_forward_train_days: float = 3.0
    walk_forward_test_days: float = 1.0
    walk_forward_mode: WalkForwardMode = WalkForwardMode.ANCHORED
    monte_carlo_iterations: int = 1_000
    monte_carlo_method: ResampleMethod = ResampleMethod.BOOTSTRAP
    ruin_threshold_pct: float = 0.20
    cost_multiples: tuple[float, ...] = (1.0, 1.5, 2.0, 3.0, 5.0)
    sweep_parameters: dict[str, tuple[float, ...]] = field(default_factory=dict)
    seed: int = 0

    @classmethod
    def from_config(cls, section: Any) -> PipelineConfig:
        windows = section.section("windows", required=False)
        walk = section.section("walk_forward", required=False)
        monte = section.section("monte_carlo", required=False)
        stress = section.section("stress", required=False)
        sweeps_raw = section.get("sweeps") or {}
        if not isinstance(sweeps_raw, dict):
            raise ValueError("validation.sweeps must be a mapping of parameter to values")
        return cls(
            in_sample_fraction=windows.float_("in_sample_fraction", 0.5),
            validation_fraction=windows.float_("validation_fraction", 0.2),
            walk_forward_train_days=walk.float_("train_days", 3.0),
            walk_forward_test_days=walk.float_("test_days", 1.0),
            walk_forward_mode=WalkForwardMode(walk.str_("mode", "ANCHORED")),
            monte_carlo_iterations=monte.int_("iterations", 1_000),
            monte_carlo_method=ResampleMethod(monte.str_("method", "BOOTSTRAP")),
            ruin_threshold_pct=monte.float_("ruin_threshold_pct", 0.20),
            cost_multiples=tuple(
                float(x) for x in stress.list_("cost_multiples", [1.0, 1.5, 2.0, 3.0, 5.0])
            ),
            sweep_parameters={
                str(k): tuple(float(x) for x in v) for k, v in sweeps_raw.items()
            },
            seed=section.int_("seed", 0),
        )


@dataclass(slots=True)
class ValidationReport:
    """Everything the pipeline measured, and the verdict."""

    strategy_id: str
    in_sample: PerformanceReport | None = None
    validation: PerformanceReport | None = None
    out_of_sample: PerformanceReport | None = None
    walk_forward: list[PerformanceReport] = field(default_factory=list)
    walk_forward_splits: list[Split] = field(default_factory=list)
    monte_carlo: MonteCarloResult | None = None
    plateaus: list[PlateauResult] = field(default_factory=list)
    stress: StressResult | None = None
    decision: PromotionDecision | None = None
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "in_sample": self.in_sample.to_dict() if self.in_sample else None,
            "validation": self.validation.to_dict() if self.validation else None,
            "out_of_sample": self.out_of_sample.to_dict() if self.out_of_sample else None,
            "walk_forward": [r.to_dict() for r in self.walk_forward],
            "walk_forward_splits": [s.to_dict() for s in self.walk_forward_splits],
            "monte_carlo": self.monte_carlo.to_dict() if self.monte_carlo else None,
            "plateaus": [p.to_dict() for p in self.plateaus],
            "stress": self.stress.to_dict() if self.stress else None,
            "decision": self.decision.to_dict() if self.decision else None,
            "errors": list(self.errors),
        }

    def render(self) -> str:
        lines = [f"# Validation report — {self.strategy_id}", ""]
        if self.decision is not None:
            lines.extend([self.decision.render(), ""])
        if self.errors:
            lines.append("## Errors")
            lines.extend(f"* {e}" for e in self.errors)
            lines.append("")
        for label, report in (
            ("In-sample", self.in_sample),
            ("Validation", self.validation),
            ("Out-of-sample", self.out_of_sample),
        ):
            if report is None:
                continue
            lines.append(
                f"* {label}: net {report.net.total_pnl:,.2f} over "
                f"{report.net.trade_count} trades "
                f"(gross {report.gross.total_pnl:,.2f}, drag {report.cost_drag:,.2f})"
            )
        if self.walk_forward:
            profitable = sum(1 for r in self.walk_forward if r.net.total_pnl > 0)
            lines.append(
                f"* Walk-forward: profitable in {profitable} of "
                f"{len(self.walk_forward)} windows"
            )
        return "\n".join(lines)


class ValidationPipeline:
    """Runs the full validation sequence for one strategy.

    Args:
        config_dir: the shipped configuration. It is copied per stage so that narrowing a
            date range for one window cannot mutate the operator's files.
        strategy_id: which strategy to validate.
        config: pipeline settings.
        criteria: the promotion bar.
        work_dir: scratch space for the per-stage configs and run outputs.
    """

    __slots__ = (
        "_config",
        "_config_dir",
        "_criteria",
        "_fill_model",
        "_oos_trades",
        "_strategy_id",
        "_work_dir",
    )

    def __init__(
        self,
        config_dir: str | Path,
        strategy_id: str,
        config: PipelineConfig | None = None,
        criteria: PromotionCriteria | None = None,
        work_dir: str | Path | None = None,
    ) -> None:
        self._config_dir = Path(config_dir)
        self._strategy_id = strategy_id
        self._config = config or PipelineConfig()
        self._criteria = criteria or PromotionCriteria()
        self._work_dir = Path(work_dir) if work_dir else Path("runs") / "validation"
        # Per-instance, not class-level: two pipelines validating different strategies
        # must not share the ledger the resampling and stress stages read.
        self._oos_trades: list[RealizedTrade] = []
        self._fill_model: FillModel | None = None

    def run(self) -> ValidationReport:
        """Execute every stage in order and return the verdict."""
        report = ValidationReport(strategy_id=self._strategy_id)
        start, end = self._range()
        splitter = WindowSplitter(
            self._config.in_sample_fraction, self._config.validation_fraction
        )
        is_validation, oos_start, oos_end = splitter.split(start, end)

        _log.info(
            "validation_started",
            strategy_id=self._strategy_id,
            in_sample=f"{to_iso(is_validation.train_start)}..{to_iso(is_validation.train_end)}",
            out_of_sample=f"{to_iso(oos_start)}..{to_iso(oos_end)}",
        )

        # 1-2. In-sample and validation. These may be looked at freely.
        report.in_sample = self._run_window(
            "in_sample", is_validation.train_start, is_validation.train_end, report
        )
        report.validation = self._run_window(
            "validation", is_validation.test_start, is_validation.test_end, report
        )

        # 6. Parameter sensitivity, swept on the IN-SAMPLE window only. Sweeping on
        #    out-of-sample data would consume the one unbiased measurement available.
        report.plateaus = self._run_sweeps(
            is_validation.train_start, is_validation.train_end, report
        )

        # 3. Out-of-sample. One shot, and only now.
        report.out_of_sample = self._run_window("out_of_sample", oos_start, oos_end, report)

        # 4. Walk-forward over the whole range.
        report.walk_forward, report.walk_forward_splits = self._run_walk_forward(
            start, end, report
        )

        # 5, 8. Monte Carlo and cost stress, both on the out-of-sample trades.
        trades = self._oos_trades
        if trades:
            try:
                report.monte_carlo = run_monte_carlo(
                    trades,
                    starting_equity=report.out_of_sample.starting_equity
                    if report.out_of_sample
                    else 100_000.0,
                    iterations=self._config.monte_carlo_iterations,
                    method=self._config.monte_carlo_method,
                    ruin_threshold_pct=self._config.ruin_threshold_pct,
                    seed=self._config.seed,
                )
                report.stress = run_cost_stress(trades, self._config.cost_multiples)
            except ValueError as exc:
                report.errors.append(f"resampling/stress: {exc}")

        # The gate. Missing evidence is a failure, not a pass.
        report.decision = PromotionGate(self._criteria).evaluate(
            self._strategy_id,
            out_of_sample=report.out_of_sample,
            fill_model=self._fill_model,
            walk_forward=report.walk_forward or None,
            monte_carlo=report.monte_carlo,
            plateaus=report.plateaus or None,
        )
        _log.info(
            "validation_complete",
            strategy_id=self._strategy_id,
            approved=report.decision.approved,
            failure_count=len(report.decision.failures),
        )
        return report

    # -- stage helpers -------------------------------------------------------------------

    def _range(self) -> tuple[Nanos, Nanos]:
        data = yaml.safe_load((self._config_dir / "backtest.yaml").read_text())["data"]
        return from_iso(str(data["start"])), from_iso(str(data["end"]))

    def _stage_config(
        self, name: str, start: Nanos, end: Nanos, overrides: dict[str, Any] | None = None
    ) -> Path:
        """A private copy of the configuration for one stage.

        Copied rather than mutated so a validation run can never alter the configuration
        an operator is about to trade.
        """
        target = self._work_dir / name / "configs"
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self._config_dir, target)

        backtest = yaml.safe_load((target / "backtest.yaml").read_text())
        backtest["data"]["start"] = to_iso(start)
        backtest["data"]["end"] = to_iso(end)
        backtest["strategies"] = [self._strategy_id]
        backtest["run"]["name"] = f"validate_{self._strategy_id}_{name}"
        (target / "backtest.yaml").write_text(yaml.safe_dump(backtest))

        if overrides:
            strategies = yaml.safe_load((target / "strategies.yaml").read_text())
            params = strategies["strategies"][self._strategy_id]["params"]
            params.update(overrides)
            strategies["strategies"][self._strategy_id]["enabled"] = True
            (target / "strategies.yaml").write_text(yaml.safe_dump(strategies))
        else:
            strategies = yaml.safe_load((target / "strategies.yaml").read_text())
            strategies["strategies"][self._strategy_id]["enabled"] = True
            (target / "strategies.yaml").write_text(yaml.safe_dump(strategies))
        return target

    def _run_window(
        self,
        name: str,
        start: Nanos,
        end: Nanos,
        report: ValidationReport,
        overrides: dict[str, Any] | None = None,
    ) -> PerformanceReport | None:
        """Run one backtest window, recording rather than raising on failure.

        Each stage logs as it starts and finishes. A full validation is a long job — a
        dozen backtests over the whole history — and one that prints nothing until the end
        is indistinguishable from one that has hung.
        """
        from core.backtest.runner import run_backtest

        _log.info(
            "validation_stage_started",
            strategy_id=self._strategy_id,
            stage=name,
            window=f"{to_iso(start)}..{to_iso(end)}",
            overrides=overrides or {},
        )
        started = monotonic_ns()
        try:
            config_dir = self._stage_config(name, start, end, overrides)
            run = run_backtest(
                config_dir,
                output_root=self._work_dir / name / "runs",
                run_id=f"{self._strategy_id}-{name}",
                write_outputs=False,
            )
        except Exception as exc:  # a stage failure must not discard the other stages
            _log.exception("validation_stage_failed", stage=name, error=str(exc))
            report.errors.append(f"{name}: {type(exc).__name__}: {exc}")
            return None

        _log.info(
            "validation_stage_complete",
            strategy_id=self._strategy_id,
            stage=name,
            elapsed=format_duration(monotonic_ns() - started),
            trades=run.report.net.trade_count,
            net_pnl=round(run.report.net.total_pnl, 2),
        )
        if name == "out_of_sample":
            # Retained for resampling and stress, which operate on the realised ledger.
            self._oos_trades = list(run.result.portfolio.realized_trades)
            self._fill_model = FillModel(run.manifest.fill_model)
        return run.report

    def _run_sweeps(
        self, start: Nanos, end: Nanos, report: ValidationReport
    ) -> list[PlateauResult]:
        """Sweep each configured parameter on the in-sample window."""
        plateaus: list[PlateauResult] = []
        for parameter, values in self._config.sweep_parameters.items():
            points: list[SweepPoint] = []
            for value in values:
                result = self._run_window(
                    f"sweep_{parameter}_{value}", start, end, report,
                    overrides={parameter: value},
                )
                if result is None:
                    continue
                points.append(
                    SweepPoint(value, result.net.expectancy, result.net.trade_count)
                )
            if len(points) < 3:
                report.errors.append(
                    f"sweep[{parameter}]: only {len(points)} of {len(values)} points "
                    "completed; a plateau cannot be distinguished from a peak"
                )
                continue
            plateaus.append(find_plateau(ParameterSweep(parameter, tuple(points))))
        return plateaus

    def _run_walk_forward(
        self, start: Nanos, end: Nanos, report: ValidationReport
    ) -> tuple[list[PerformanceReport], list[Split]]:
        try:
            splits = walk_forward_windows(
                start, end,
                self._config.walk_forward_train_days,
                self._config.walk_forward_test_days,
                self._config.walk_forward_mode,
            )
        except ValueError as exc:
            report.errors.append(f"walk_forward: {exc}")
            return [], []

        results: list[PerformanceReport] = []
        used: list[Split] = []
        for split in splits:
            # Only the TEST window is measured. The training window exists to define what
            # the strategy would have known, and measuring it would be in-sample again.
            result = self._run_window(
                f"wf_{split.index}", split.test_start, split.test_end, report
            )
            if result is not None:
                results.append(result)
                used.append(split)
        return results, used
