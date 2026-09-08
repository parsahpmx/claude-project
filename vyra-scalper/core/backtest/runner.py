"""Assembles a complete backtest from configuration.

This is the single place that knows how to build every component from ``configs/``.  The
live trader will use the same builder with a different event source and broker adapter,
which is what keeps the two paths from drifting apart.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.analytics.ledger import RunWriter
from core.analytics.metrics import PerformanceReport, compute_metrics
from core.backtest.engine import BacktestEngine, BacktestResult
from core.backtest.manifest import RunManifest, git_state
from core.brokers.simulated import SimulatedBrokerAdapter
from core.config.loader import ConfigBundle, ConfigError, load_bundle
from core.events import FillModel, Regime, Timeframe
from core.execution.costs import CostModel, LatencyModel
from core.execution.engine import ExecutionConfig, ExecutionEngine
from core.execution.fills import FillSimulator
from core.execution.order_manager import OrderManager
from core.features.engine import FeatureConfig, FeatureEngine
from core.instruments.registry import InstrumentRegistry
from core.market_data.normalization import Normalizer
from core.market_data.staleness import StalenessGate, StalenessThresholds
from core.portfolio.portfolio import Portfolio
from core.regime.engine import MarketRegimeEngine, RegimeConfig
from core.risk.engine import RiskEngine
from core.risk.kill_switch import EmergencyPolicy, KillSwitch
from core.risk.limits import RiskLimits
from core.signals.confidence import ConfidenceScorer
from core.strategies.base import BaseStrategy, StrategyConfig
from core.util.clock import from_iso
from core.util.ids import derive_seed
from core.util.ids import run_id as make_run_id
from core.util.logging import get_logger
from data.collectors.base import DataSource
from data.collectors.synthetic import SyntheticConfig, SyntheticTickSource

__all__ = ["BacktestRun", "run_backtest"]

_log = get_logger("backtest.runner")

ENGINE_VERSION = "0.1.0"


@dataclass(slots=True)
class BacktestRun:
    """The complete outcome of a run."""

    run_id: str
    result: BacktestResult
    report: PerformanceReport
    manifest: RunManifest
    output_directory: Path

    @property
    def warnings(self) -> list[str]:
        """Provenance warnings and result-shape warnings, together.

        The manifest knows about the data and the build; the report knows whether the
        numbers look like an artefact.  A caller that sees only one of the two can be
        misled by the other, so every surface shows both.
        """
        return [*self.manifest.warnings, *self.report.implausibility_warnings]

    @property
    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "net_pnl": self.report.net.total_pnl,
            "gross_pnl": self.report.gross.total_pnl,
            "cost_drag": self.report.cost_drag,
            "trades": self.report.net.trade_count,
            "survives_costs": self.report.survives_costs,
            "halted": self.result.halted,
            "result_hash": self.manifest.result_hash,
            "warnings": self.warnings,
        }


def _load_strategy_class(path: str) -> type[BaseStrategy]:
    """Import a strategy class from its dotted path.

    Raises:
        ConfigError: with the configured path in the message.  A typo here would
            otherwise surface as a bare ImportError with no indication of which config
            entry caused it.
    """
    module_name, _, class_name = path.rpartition(".")
    if not module_name:
        raise ConfigError(f"strategy class {path!r} is not a dotted path")
    try:
        module = importlib.import_module(module_name)
        cls = getattr(module, class_name)
    except (ImportError, AttributeError) as exc:
        raise ConfigError(f"cannot load strategy class {path!r}: {exc}") from exc
    if not isinstance(cls, type) or not issubclass(cls, BaseStrategy):
        raise ConfigError(f"{path!r} is not a BaseStrategy subclass")
    return cls


def _build_strategies(
    bundle: ConfigBundle,
    registry: InstrumentRegistry,
    names: list[str],
) -> tuple[list[BaseStrategy], Timeframe]:
    """Instantiate the named strategies and return their shared timeframe.

    Raises:
        ConfigError: when strategies disagree about the timeframe.  Building bars for
            multiple timeframes is supported by the bar engine, but a single feature
            engine has one configured timeframe, and quietly using one strategy's
            timeframe for another's features would produce signals from the wrong series.
    """
    section = bundle["strategies"].section("strategies")
    scorer = ConfidenceScorer.from_config(bundle["strategies"].section("confidence").data)
    instruments = {iid: registry.get(iid) for iid in registry.ids()}

    strategies: list[BaseStrategy] = []
    timeframes: set[Timeframe] = set()
    for name in names:
        spec = section.section(name)
        timeframe = Timeframe.parse(spec.str_("timeframe"))
        timeframes.add(timeframe)
        config = StrategyConfig(
            strategy_id=name,
            version=spec.str_("version", "0.0.0"),
            instruments=tuple(str(i) for i in spec.list_("instruments")),
            timeframe=timeframe,
            allowed_regimes=tuple(Regime(r) for r in spec.list_("allowed_regimes")),
            params=spec.section("params", required=False).data,
            requires_exchange_depth=spec.bool_("requires_exchange_depth", False),
            enabled=spec.bool_("enabled", True),
        )
        cls = _load_strategy_class(spec.str_("class"))
        strategies.append(cls(config, instruments, scorer))

    if len(timeframes) > 1:
        raise ConfigError(
            "strategies in one run must share a timeframe; got "
            f"{sorted(tf.value for tf in timeframes)}. Run them as separate backtests."
        )
    return strategies, next(iter(timeframes)) if timeframes else Timeframe.M1


def _build_data_source(
    bundle: ConfigBundle, registry: InstrumentRegistry, instrument_id: str, seed: int
) -> DataSource:
    """Build the configured data source for one instrument.

    ``seed`` is derived from the run's master seed, not read from the data block: one
    number must determine the whole run (see :func:`core.util.ids.derive_seed`).
    """
    data = bundle["backtest"].section("data")
    kind = data.str_("source", "SYNTHETIC").upper()
    instrument = registry.get(instrument_id)

    if kind == "SYNTHETIC":
        spec = data.section("synthetic", required=False)
        config = SyntheticConfig(
            seed=seed,
            start_price=spec.float_("start_price", 5100.0),
            annual_volatility=spec.float_("annual_volatility", 0.18),
            trade_arrival_per_second=spec.float_("trade_arrival_per_second", 1.5),
            spread_ticks_mean=spec.float_("spread_ticks_mean", 1.0),
            spread_ticks_wide_prob=spec.float_("spread_ticks_wide_prob", 0.05),
            mean_reversion_strength=spec.float_("mean_reversion_strength", 0.02),
            tick_interval_ms=spec.float_("tick_interval_ms", 250.0),
        )
        return SyntheticTickSource(instrument, config, registry.calendar(instrument_id))

    if kind in ("CSV", "PARQUET"):
        raise ConfigError(
            f"data source {kind} is specified but not yet implemented; see ROADMAP.md. "
            "Use SYNTHETIC, or supply a source object to run_backtest()."
        )
    raise ConfigError(f"unknown data source {kind!r}; expected SYNTHETIC, CSV or PARQUET")


def run_backtest(
    config_dir: str | Path = "configs",
    *,
    output_root: str | Path | None = None,
    run_id: str | None = None,
    data_source: DataSource | None = None,
    write_outputs: bool = True,
) -> BacktestRun:
    """Build and execute a backtest from configuration.

    Args:
        config_dir: directory containing the YAML configuration.
        output_root: where to write run artefacts; defaults to the configured directory.
        run_id: identifier for the run.  Defaults to a deterministic id derived from the
            config hash and seed, so re-running the same configuration reuses the id and
            the reproduction is directly comparable.
        data_source: override the configured source (used by tests and replay).
        write_outputs: set ``False`` to compute without writing artefacts.

    Returns:
        A :class:`BacktestRun` with the result, metrics and manifest.
    """
    bundle = load_bundle(config_dir)
    registry = InstrumentRegistry.from_config(bundle["markets"], bundle["sessions"])
    instruments = {iid: registry.get(iid) for iid in registry.ids()}
    calendars = {iid: registry.calendar(iid) for iid in registry.ids()}

    backtest_cfg = bundle["backtest"]
    run_cfg = backtest_cfg.section("run")
    data_cfg = backtest_cfg.section("data")
    exec_cfg = backtest_cfg.section("execution", required=False)
    output_cfg = backtest_cfg.section("output", required=False)

    # One master seed determines the entire run; components get decorrelated derivatives.
    seed = run_cfg.int_("random_seed", 0)
    data_seed = derive_seed(seed, "data")
    fill_seed = derive_seed(seed, "fills")
    broker_seed = derive_seed(seed, "broker")
    instrument_ids = [str(i) for i in data_cfg.list_("instruments")]
    if not instrument_ids:
        raise ConfigError("backtest.data.instruments is empty; nothing to run")
    start_ts = from_iso(data_cfg.str_("start"))
    end_ts = from_iso(data_cfg.str_("end"))
    if end_ts <= start_ts:
        raise ConfigError(f"backtest data range is empty: {start_ts} -> {end_ts}")

    resolved_run_id = run_id or make_run_id(f"{bundle.hash}|{seed}|{run_cfg.str_('name', 'run')}")

    strategy_names = [str(s) for s in backtest_cfg.list_("strategies")]
    strategies, timeframe = _build_strategies(bundle, registry, strategy_names)

    limits = RiskLimits.from_config(bundle["risk"])
    starting_equity = bundle["risk"].section("account").float_("starting_equity", 100_000.0)
    kill_cfg = bundle["risk"].section("kill_switch", required=False)

    portfolio = Portfolio(starting_equity, instruments, calendars)
    kill_switch = KillSwitch(
        emergency_policy=EmergencyPolicy(kill_cfg.str_("emergency_policy", "HOLD")),
        min_trip_seconds=kill_cfg.float_("min_trip_seconds", 60.0),
        state_file=None,  # a backtest's switch is per-run and must not persist to disk
    )
    risk_engine = RiskEngine(limits, portfolio, registry, kill_switch)

    cost_model = CostModel.from_config(bundle["execution"])
    latency_cfg = bundle["execution"].section("latency", required=False)
    latency = LatencyModel(
        market_data_latency_us=latency_cfg.float_("market_data_latency_us", 800.0),
        order_latency_us=latency_cfg.float_("order_latency_us", 1500.0),
        cancel_latency_us=latency_cfg.float_("cancel_latency_us", 1500.0),
        ack_latency_us=latency_cfg.float_("ack_latency_us", 1200.0),
        jitter_us=latency_cfg.float_("jitter_us", 300.0),
    )

    fill_model = FillModel(exec_cfg.str_("fill_model", "REALISTIC"))
    fill_simulator = FillSimulator(
        model=fill_model,
        queue_ratio=exec_cfg.float_("queue_ratio", 1.0),
        reject_rate=exec_cfg.float_("reject_rate", 0.0),
        partial_fill_probability=exec_cfg.float_("partial_fill_probability", 0.0),
        seed=fill_seed,
    )

    broker = SimulatedBrokerAdapter(
        instruments=instruments,
        cost_model=cost_model,
        fill_simulator=fill_simulator,
        starting_equity=starting_equity,
        order_latency_ns=latency.order_ns(),
        cancel_latency_ns=latency.cancel_ns(),
        seed=broker_seed,
    )
    order_manager = OrderManager(resolved_run_id, allow_stacking=False)
    execution_engine = ExecutionEngine(
        broker=broker,
        order_manager=order_manager,
        instruments=instruments,
        kill_switch=kill_switch,
        config=ExecutionConfig.from_config(bundle["execution"]),
    )

    primary_params = (
        bundle["strategies"].section("strategies").section(strategy_names[0]).section(
            "params", required=False
        ).data
        if strategy_names
        else {}
    )
    feature_engine = FeatureEngine(
        instruments=instruments,
        config=FeatureConfig.from_params(primary_params, timeframe),
        calendars=calendars,
    )

    regime_section = bundle.get("regime")
    regime_engine = MarketRegimeEngine(
        RegimeConfig.from_config(regime_section.section("classification"))
        if regime_section is not None
        else RegimeConfig()
    )

    normalizer = Normalizer(instruments)
    staleness = StalenessGate(
        default=StalenessThresholds(
            warn_ms=500.0,
            stale_ms=limits.max_quote_age_ms,
            dead_ms=kill_cfg.float_("max_data_staleness_ms", 10_000.0),
        ),
        calendars=calendars,
    )

    engine = BacktestEngine(
        run_id=resolved_run_id,
        registry=registry,
        strategies=strategies,
        feature_engine=feature_engine,
        risk_engine=risk_engine,
        execution_engine=execution_engine,
        portfolio=portfolio,
        broker=broker,
        order_manager=order_manager,
        normalizer=normalizer,
        staleness=staleness,
        regime_engine=regime_engine,
        timeframes=[timeframe],
        market_data_latency_ns=latency.market_data_ns(),
        seed=derive_seed(seed, "engine"),
    )

    source = data_source or _build_data_source(bundle, registry, instrument_ids[0], data_seed)
    result = engine.run(source.events(start_ts, end_ts))

    report = compute_metrics(
        trades=portfolio.realized_trades,
        equity_curve=portfolio.equity_curve,
        starting_equity=starting_equity,
        ending_equity=portfolio.equity,
        regime_by_trade=result.regime_by_trade,
        session_dates=result.session_dates,
        execution_stats={
            **{k: float(v) for k, v in order_manager.stats().items()},
            "recent_reject_rate": execution_engine.recent_reject_rate,
        },
    )

    commit, dirty = git_state()
    manifest = RunManifest(
        run_id=resolved_run_id,
        engine_version=ENGINE_VERSION,
        mode=run_cfg.str_("mode", "BACKTEST"),
        git_commit=commit,
        git_dirty=dirty,
        config_hash=bundle.hash,
        configs=dict(bundle.file_hashes),
        strategies=[
            {"id": s.config.strategy_id, "version": s.config.version} for s in strategies
        ],
        dataset_id=source.source_id,
        dataset_fingerprint=source.content_fingerprint(),
        instruments=instrument_ids,
        start_ts=start_ts,
        end_ts=end_ts,
        fill_model=fill_model.value,
        slippage_model={
            "model": cost_model.slippage_model.slippage_type.value,
            "spread_fraction": cost_model.slippage_model.spread_fraction,
            "fixed_ticks": cost_model.slippage_model.fixed_ticks,
        },
        latency_model=latency.to_dict(),
        commission_model={"source": "execution.yaml"},
        random_seed=seed,
        data_quality=result.data_quality,
    )
    manifest.finalise(result.result_payload())

    if result.halted:
        manifest.add_warning(f"HALTED: {result.halt_reason}")

    root = Path(output_root or output_cfg.str_("directory", "runs"))
    writer = RunWriter(root, resolved_run_id)
    if write_outputs:
        writer.write_trades(portfolio.realized_trades)
        writer.write_equity(portfolio.equity_curve)
        writer.write_orders(result.orders)
        writer.write_fills(result.fills)
        writer.write_risk_events(result.risk_events)
        writer.write_metrics(report)
        manifest.write(writer.directory)
        writer.write_report(report, manifest.to_dict())

    _log.info("backtest_run_complete", run_id=resolved_run_id, **{
        "net_pnl": report.net.total_pnl,
        "gross_pnl": report.gross.total_pnl,
        "trades": report.net.trade_count,
        "survives_costs": report.survives_costs,
    })

    return BacktestRun(
        run_id=resolved_run_id,
        result=result,
        report=report,
        manifest=manifest,
        output_directory=writer.directory,
    )
