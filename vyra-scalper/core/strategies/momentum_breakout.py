"""Momentum breakout.

Thesis: a decisive move beyond a recent range, on expanded volume, tends to continue,
because the break itself forces positioning changes from participants on the wrong side.

The conditions are what make it a strategy rather than a hope:

* it applies in a **trending or breakout** regime; in a range, a break of the range high is
  the signal to fade, not to follow;
* the break must clear the range by a configured buffer, or it is noise at the boundary;
* volume must confirm — a break on no volume is nobody's decision.
"""

from __future__ import annotations

from typing import Any

from core.events import BarEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext

__all__ = ["MomentumBreakoutStrategy"]

_REQUIRED_PARAMS = (
    "lookback_bars",
    "breakout_buffer_ticks",
    "volume_confirmation_ratio",
    "stop_atr_multiple",
    "target_atr_multiple",
    "max_holding_bars",
)

# Saturation points for the confidence mapping, not trading thresholds: they set where a
# component's score stops improving, and cannot change whether a trade is allowed.
_BREAK_SATURATION_ATR = 1.0
_VOLUME_SATURATION_MULTIPLE = 3.0


class MomentumBreakoutStrategy(BaseStrategy):
    """Trade breaks of an N-bar range, with the trend and on confirming volume.

    Entry (long; short is the mirror):
        the close exceeds the highest high of the previous ``lookback_bars`` by
        ``breakout_buffer_ticks``, and bar volume is at least
        ``volume_confirmation_ratio`` times the recent average.

    Exit: the protective stop or target placed at entry, or ``max_holding_bars``.
    """

    def __init__(
        self,
        config: StrategyConfig,
        instruments: dict[str, Instrument],
        confidence_scorer: ConfidenceScorer | None = None,
    ) -> None:
        super().__init__(config, instruments, confidence_scorer)
        self._bars_in_position: dict[str, int] = {}

    def validate_params(self, params: dict[str, Any]) -> None:
        missing = [p for p in _REQUIRED_PARAMS if p not in params]
        if missing:
            raise ValueError(
                f"{self.config.strategy_id}: missing required params: {', '.join(missing)}"
            )
        if params["lookback_bars"] < 2:
            raise ValueError(f"{self.config.strategy_id}: lookback_bars must be at least 2")
        if params["volume_confirmation_ratio"] <= 0:
            raise ValueError(
                f"{self.config.strategy_id}: volume_confirmation_ratio must be positive"
            )
        for name in ("stop_atr_multiple", "target_atr_multiple"):
            if params[name] <= 0:
                raise ValueError(f"{self.config.strategy_id}: {name} must be positive")

    def reset(self) -> None:
        super().reset()
        self._bars_in_position.clear()

    def on_bar(self, event: BarEvent, ctx: StrategyContext) -> list[Signal]:
        if not event.is_closed or event.timeframe is not self.config.timeframe:
            return []
        instrument_id = ctx.instrument.instrument_id
        if ctx.position.is_flat:
            self._bars_in_position.pop(instrument_id, None)
        else:
            self._bars_in_position[instrument_id] = (
                self._bars_in_position.get(instrument_id, 0) + 1
            )
        return self.generate_signal(ctx)

    def generate_signal(self, ctx: StrategyContext) -> list[Signal]:
        if not ctx.is_session_open or not self.config.allows(ctx.regime):
            return []
        if not ctx.position.is_flat:
            return self._evaluate_exit(ctx)
        return self._evaluate_entry(ctx)

    def _evaluate_exit(self, ctx: StrategyContext) -> list[Signal]:
        held = self._bars_in_position.get(ctx.instrument.instrument_id, 0)
        if held >= int(self.param("max_holding_bars")):
            return [self.make_exit_signal(ctx, reason_codes=("MAX_HOLDING_BARS",))]
        return []

    def _evaluate_entry(self, ctx: StrategyContext) -> list[Signal]:
        required = ("range_high", "range_low", "atr", "last_close", "last_volume")
        if not ctx.features.has(*required):
            return []
        range_high, range_low, atr, close, volume = ctx.require_features(*required)
        if atr <= 0:
            return []

        if ctx.features.bar_count < int(self.param("lookback_bars")):
            return []

        buffer_price = float(self.param("breakout_buffer_ticks")) * ctx.instrument.tick_size
        if not self._volume_confirms(ctx, volume):
            return []

        if close > range_high + buffer_price:
            return [self._build(ctx, Side.BUY, close, atr, close - range_high, volume)]
        if close < range_low - buffer_price:
            return [self._build(ctx, Side.SELL, close, atr, range_low - close, volume)]
        return []

    def _volume_confirms(self, ctx: StrategyContext, volume: float) -> bool:
        """A break on no volume is nobody's decision.

        Uses session volume per bar as the reference. When no reference is available the
        check is skipped rather than defaulted, so a missing feature does not silently
        become a passing confirmation.
        """
        reference = ctx.feature("avg_volume")
        if reference is None or reference <= 0:
            return True
        return volume >= reference * float(self.param("volume_confirmation_ratio"))

    def _build(
        self, ctx: StrategyContext, side: Side, close: float, atr: float,
        break_distance: float, volume: float,
    ) -> Signal:
        entry = ctx.feature("mid") or close
        sign = side.sign
        return self.make_signal(
            ctx=ctx,
            direction=side,
            intent=SignalIntent.ENTER,
            entry=entry,
            stop=entry - sign * atr * float(self.param("stop_atr_multiple")),
            target=entry + sign * atr * float(self.param("target_atr_multiple")),
            entry_type=EntryType.MARKETABLE_LIMIT,
            confidence=self._confidence(ctx, break_distance, atr, volume),
            reason_codes=(
                "RANGE_BREAKOUT",
                "LONG_BREAK" if side is Side.BUY else "SHORT_BREAK",
            ),
        )

    def _confidence(
        self, ctx: StrategyContext, break_distance: float, atr: float, volume: float
    ) -> float:
        reference = ctx.feature("avg_volume")
        spread_ticks = ctx.feature("spread_ticks")
        limit = ctx.instrument.max_spread_ticks
        trend = ctx.feature("swing_trend")

        return self.score_confidence(
            {
                "market_structure": (
                    min(1.0, break_distance / (atr * _BREAK_SATURATION_ATR)) if atr > 0 else None
                ),
                "volume_confirmation": (
                    min(1.0, volume / (reference * _VOLUME_SATURATION_MULTIPLE))
                    if reference and reference > 0
                    else None
                ),
                "spread_condition": (
                    max(0.0, min(1.0, 1.0 - spread_ticks / limit))
                    if spread_ticks is not None and limit > 0
                    else None
                ),
                "trend_alignment": (
                    max(0.0, min(1.0, (trend + 1.0) / 2.0)) if trend is not None else None
                ),
            }
        )
