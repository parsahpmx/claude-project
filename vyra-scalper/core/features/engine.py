"""The feature engine.

Holds one bundle of streaming indicators per instrument, advances them as events arrive,
and publishes an immutable :class:`FeatureSnapshot`.

Two properties are enforced structurally rather than by review:

* **Causality** — every snapshot carries ``computed_at``, the timestamp of the last event
  folded in.  :meth:`FeatureSnapshot.require_causal` raises when a snapshot is used
  against an earlier event, which is the timestamp-leakage check of
  ``BACKTEST_SPEC.md`` §3.
* **Readiness** — a feature that has not warmed up is absent from the snapshot rather than
  present with a partial value.  A strategy reading ``atr`` gets a real ATR or nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.events import BarEvent, Event, QuoteEvent, SessionEvent, Timeframe, TradeEvent
from core.features.indicators import (
    ATR,
    ROC,
    RSI,
    AnchoredVWAP,
    OpeningRange,
    OrderFlowTracker,
    ParkinsonVolatility,
    RealizedVolatility,
    SessionRange,
    SwingStructure,
)
from core.features.rolling import EMA, SMA, NotReady, RollingMax, RollingMin, RollingStd
from core.instruments.instrument import Instrument
from core.instruments.sessions import SessionCalendar
from core.util.clock import Nanos
from core.util.logging import get_logger

__all__ = ["FeatureConfig", "FeatureEngine", "FeatureSnapshot"]

_log = get_logger("features.engine")


@dataclass(frozen=True, slots=True)
class FeatureConfig:
    """Feature periods.  Every value comes from configuration, never from source."""

    timeframe: Timeframe = Timeframe.M1
    atr_period: int = 14
    rsi_period: int = 14
    roc_period: int = 10
    fast_ema: int = 20
    slow_ema: int = 50
    realized_vol_period: int = 20
    parkinson_period: int = 20
    swing_strength: int = 2
    range_lookback: int = 20
    opening_range_minutes: float = 15.0
    order_flow_window: int = 100
    bars_per_year: float = 252 * 390

    @classmethod
    def from_params(cls, params: dict[str, Any], timeframe: Timeframe) -> FeatureConfig:
        """Build from a strategy's ``params`` block, keeping unrecognised keys out."""
        known = {f for f in cls.__dataclass_fields__ if f != "timeframe"}
        kwargs = {k: v for k, v in params.items() if k in known}
        return cls(timeframe=timeframe, **kwargs)


@dataclass(frozen=True, slots=True)
class FeatureSnapshot:
    """An immutable view of every ready feature at one instant.

    ``values`` holds only features that are warmed up.  Absence means "not ready", which a
    strategy must handle; there is no sentinel value that could be mistaken for data.
    """

    instrument_id: str
    computed_at: Nanos
    timeframe: Timeframe
    bar_count: int
    values: dict[str, float] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)

    def get(self, name: str, default: float | None = None) -> float | None:
        return self.values.get(name, default)

    def require(self, *names: str) -> tuple[float, ...]:
        """Return several features, raising if any is not ready.

        Raises:
            NotReady: naming every missing feature at once, so a strategy's warm-up
                requirements are diagnosable from one message.
        """
        missing = [n for n in names if n not in self.values]
        if missing:
            raise NotReady(
                f"{self.instrument_id}: features not ready: {', '.join(missing)} "
                f"(available: {', '.join(sorted(self.values)) or 'none'})"
            )
        return tuple(self.values[n] for n in names)

    def has(self, *names: str) -> bool:
        return all(n in self.values for n in names)

    def require_causal(self, event_ts: Nanos) -> FeatureSnapshot:
        """Assert that this snapshot does not contain information from after ``event_ts``.

        Raises:
            ValueError: if ``computed_at > event_ts``.  That would mean a decision is
                being made with features built from later data — the timestamp-leakage
                failure this check exists to catch.
        """
        if self.computed_at > event_ts:
            raise ValueError(
                f"feature snapshot for {self.instrument_id} was computed at "
                f"{self.computed_at} but is being used at {event_ts}: this is "
                "timestamp leakage (BACKTEST_SPEC.md §3)"
            )
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "instrument_id": self.instrument_id,
            "computed_at": self.computed_at,
            "timeframe": self.timeframe.value,
            "bar_count": self.bar_count,
            **{k: round(v, 10) for k, v in sorted(self.values.items())},
            **dict(sorted(self.labels.items())),
        }


class _InstrumentFeatures:
    """The indicator bundle for one instrument."""

    __slots__ = (
        "atr", "bar_count", "cfg", "close_max", "close_min", "close_std", "computed_at",
        "fast_ema", "last_bar", "last_quote", "opening_range", "order_flow", "parkinson",
        "realized_vol", "roc", "rsi", "session_range", "slow_ema", "swing", "volume_sma",
        "vwap",
    )

    def __init__(self, cfg: FeatureConfig) -> None:
        self.cfg = cfg
        self.atr = ATR(cfg.atr_period)
        self.rsi = RSI(cfg.rsi_period)
        self.roc = ROC(cfg.roc_period)
        self.fast_ema = EMA(cfg.fast_ema)
        self.slow_ema = EMA(cfg.slow_ema)
        self.realized_vol = RealizedVolatility(cfg.realized_vol_period, cfg.bars_per_year)
        self.parkinson = ParkinsonVolatility(cfg.parkinson_period, cfg.bars_per_year)
        self.swing = SwingStructure(cfg.swing_strength)
        self.session_range = SessionRange()
        self.opening_range = OpeningRange(cfg.opening_range_minutes)
        self.order_flow = OrderFlowTracker(cfg.order_flow_window)
        self.vwap = AnchoredVWAP()
        self.close_max = RollingMax(cfg.range_lookback)
        self.close_min = RollingMin(cfg.range_lookback)
        self.close_std = RollingStd(max(2, cfg.range_lookback))
        self.volume_sma = SMA(cfg.range_lookback)
        self.bar_count = 0
        self.computed_at: Nanos = 0
        self.last_quote: QuoteEvent | None = None
        self.last_bar: BarEvent | None = None


class FeatureEngine:
    """Computes features for a set of instruments from the event stream.

    Args:
        instruments: instruments to track.
        config: feature periods.
        calendars: per-instrument session calendars.  Used to anchor session VWAP and to
            roll session extremes at the correct boundary — without one, "session VWAP"
            would silently mean "VWAP since the process started".
    """

    __slots__ = ("_calendars", "_config", "_features", "_instruments", "_session_anchor")

    def __init__(
        self,
        instruments: dict[str, Instrument],
        config: FeatureConfig | None = None,
        calendars: dict[str, SessionCalendar] | None = None,
    ) -> None:
        self._instruments = instruments
        self._config = config or FeatureConfig()
        self._calendars = calendars or {}
        self._features = {iid: _InstrumentFeatures(self._config) for iid in instruments}
        self._session_anchor: dict[str, Nanos] = {}

    @property
    def config(self) -> FeatureConfig:
        return self._config

    def _bundle(self, instrument_id: str) -> _InstrumentFeatures | None:
        return self._features.get(instrument_id)

    def on_event(self, event: Event) -> None:
        """Advance the feature state for ``event``'s instrument.

        Only *closed* bars advance bar-based indicators.  Quotes and trades update the
        book snapshot, session VWAP and order flow, which are legitimately tick-level.
        """
        bundle = self._bundle(event.instrument_id)
        if bundle is None:
            return

        self._maybe_roll_session(event, bundle)

        if isinstance(event, BarEvent):
            if not event.is_closed:
                # A forming bar never advances a historical indicator.  This is the
                # look-ahead guard at the engine level, complementing require_closed().
                return
            self._on_bar(event, bundle)
        elif isinstance(event, TradeEvent):
            bundle.vwap.update_trade(event.price, event.size)
            bundle.order_flow.update(event)
        elif isinstance(event, QuoteEvent):
            bundle.last_quote = event
        elif isinstance(event, SessionEvent):
            pass  # session transitions are handled by _maybe_roll_session

        bundle.computed_at = max(bundle.computed_at, event.ts)

    def _maybe_roll_session(self, event: Event, bundle: _InstrumentFeatures) -> None:
        """Re-anchor session-scoped features when the venue opens a new session."""
        calendar = self._calendars.get(event.instrument_id)
        if calendar is None:
            return
        session_open = calendar.session_open_ns(event.ts)
        if session_open is None:
            return
        if self._session_anchor.get(event.instrument_id) == session_open:
            return
        self._session_anchor[event.instrument_id] = session_open
        bundle.vwap.anchor(session_open)
        bundle.session_range.start_session(session_open, bundle.last_bar.close if bundle.last_bar else None)
        bundle.opening_range.start_session(session_open)
        bundle.order_flow.reset_session()
        _log.debug(
            "session_features_reanchored",
            instrument=event.instrument_id,
            session_open_ns=session_open,
        )

    def _on_bar(self, bar: BarEvent, bundle: _InstrumentFeatures) -> None:
        if bar.timeframe is not bundle.cfg.timeframe:
            return
        bundle.bar_count += 1
        bundle.last_bar = bar
        bundle.atr.update(bar)
        bundle.rsi.update(bar.close)
        bundle.roc.update(bar.close)
        bundle.fast_ema.update(bar.close)
        bundle.slow_ema.update(bar.close)
        bundle.realized_vol.update(bar.close)
        bundle.parkinson.update(bar)
        bundle.swing.update(bar)
        bundle.session_range.update(bar)
        bundle.opening_range.update(bar)
        bundle.close_max.update(bar.high)
        bundle.close_min.update(bar.low)
        bundle.close_std.update(bar.close)
        bundle.volume_sma.update(bar.volume)
        # When no tick data is available, the bar's own VWAP carries the session VWAP.
        if bundle.vwap.trade_count == 0 and bar.vwap is not None:
            bundle.vwap.update_bar(bar)

    def snapshot(self, instrument_id: str) -> FeatureSnapshot:
        """Publish every ready feature for ``instrument_id``.

        Not-ready features are omitted, never defaulted.  ``NotReady`` from an individual
        indicator is caught here and treated as absence — it is an expected warm-up
        condition, not an error, and it is the only exception this module swallows.
        """
        bundle = self._features.get(instrument_id)
        if bundle is None:
            raise KeyError(f"feature engine does not track {instrument_id!r}")

        values: dict[str, float] = {}
        labels: dict[str, str] = {}
        instrument = self._instruments[instrument_id]

        def put(name: str, getter: Any) -> None:
            try:
                value = getter()
            except NotReady:
                return
            if value is not None:
                values[name] = float(value)

        put("atr", lambda: bundle.atr.value)
        put("rsi", lambda: bundle.rsi.value)
        put("roc", lambda: bundle.roc.value)
        put("ema_fast", lambda: bundle.fast_ema.value)
        put("ema_slow", lambda: bundle.slow_ema.value)
        put("realized_vol", lambda: bundle.realized_vol.value)
        put("parkinson_vol", lambda: bundle.parkinson.value)
        put("range_high", lambda: bundle.close_max.value)
        put("range_low", lambda: bundle.close_min.value)
        put("close_std", lambda: bundle.close_std.value)
        put("avg_volume", lambda: bundle.volume_sma.value)
        put("vwap", lambda: bundle.vwap.value)
        put("vwap_std", lambda: bundle.vwap.std)
        put("session_high", lambda: bundle.session_range.session_high)
        put("session_low", lambda: bundle.session_range.session_low)
        put("prev_session_high", lambda: bundle.session_range.previous_high)
        put("prev_session_low", lambda: bundle.session_range.previous_low)
        put("opening_range_high", lambda: bundle.opening_range.high)
        put("opening_range_low", lambda: bundle.opening_range.low)
        put("cumulative_delta", lambda: bundle.order_flow.cumulative_delta)
        put("window_delta", lambda: bundle.order_flow.window_delta)
        put("trade_imbalance", lambda: bundle.order_flow.trade_imbalance)
        put("aggressive_buyer_ratio", lambda: bundle.order_flow.aggressive_buyer_ratio)
        put("swing_trend", lambda: float(bundle.swing.trend))

        quote = bundle.last_quote
        if quote is not None and quote.is_two_sided:
            values["bid"] = quote.bid
            values["ask"] = quote.ask
            values["mid"] = quote.mid
            values["microprice"] = quote.microprice
            values["spread"] = quote.spread
            values["spread_ticks"] = quote.spread / instrument.tick_size
            values["microprice_deviation_ticks"] = (
                quote.microprice - quote.mid
            ) / instrument.tick_size

        if bundle.last_bar is not None:
            values["last_close"] = bundle.last_bar.close
            values["last_volume"] = bundle.last_bar.volume

        if bundle.vwap.is_ready and bundle.last_bar is not None:
            deviation = bundle.vwap.deviation_sigma(bundle.last_bar.close)
            if deviation is not None:
                values["vwap_deviation_sigma"] = deviation

        if bundle.swing.last_break:
            labels["structure_break"] = bundle.swing.last_break

        return FeatureSnapshot(
            instrument_id=instrument_id,
            computed_at=bundle.computed_at,
            timeframe=self._config.timeframe,
            bar_count=bundle.bar_count,
            values=values,
            labels=labels,
        )

    def bar_count(self, instrument_id: str) -> int:
        bundle = self._features.get(instrument_id)
        return bundle.bar_count if bundle else 0
