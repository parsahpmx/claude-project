"""Trend pullback.

Thesis: in an established trend, a shallow retracement toward the moving average is an
entry at a better price in the direction the market is already going.

The discipline is in what it refuses: it will not buy a "pullback" in a range (that is
just noise), and it will not buy one that has gone deep enough to be a reversal.
"""

from __future__ import annotations

from typing import Any

from core.events import BarEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext

__all__ = ["TrendPullbackStrategy"]

_REQUIRED_PARAMS = (
    "pullback_atr_multiple",
    "stop_atr_multiple",
    "target_atr_multiple",
    "max_pullback_atr_multiple",
    "max_holding_bars",
)

_SEPARATION_SATURATION_ATR = 2.0


class TrendPullbackStrategy(BaseStrategy):
    """Buy shallow retracements in an uptrend; sell them in a downtrend.

    Entry (long):
        the fast EMA is above the slow EMA, structure agrees, and price has retraced to
        within ``pullback_atr_multiple`` ATR of the fast EMA — but not further than
        ``max_pullback_atr_multiple``, beyond which a pullback is a reversal.
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
        if params["max_pullback_atr_multiple"] <= params["pullback_atr_multiple"]:
            raise ValueError(
                f"{self.config.strategy_id}: max_pullback_atr_multiple "
                f"({params['max_pullback_atr_multiple']}) must exceed "
                f"pullback_atr_multiple ({params['pullback_atr_multiple']}), or no "
                "pullback can ever qualify"
            )
        for name in ("stop_atr_multiple", "target_atr_multiple", "pullback_atr_multiple"):
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
            held = self._bars_in_position.get(ctx.instrument.instrument_id, 0)
            if held >= int(self.param("max_holding_bars")):
                return [self.make_exit_signal(ctx, reason_codes=("MAX_HOLDING_BARS",))]
            return []

        required = ("ema_fast", "ema_slow", "atr", "last_close")
        if not ctx.features.has(*required):
            return []
        fast, slow, atr, close = ctx.require_features(*required)
        if atr <= 0:
            return []

        distance_atr = abs(close - fast) / atr
        shallow = float(self.param("pullback_atr_multiple"))
        deep = float(self.param("max_pullback_atr_multiple"))
        if distance_atr > deep:
            # Past this the retracement is a reversal, not an entry.
            return []

        structure = ctx.feature("swing_trend") or 0.0
        uptrend = fast > slow and structure >= 0
        downtrend = fast < slow and structure <= 0

        if uptrend and close <= fast + shallow * atr and close < fast + deep * atr:
            return [self._build(ctx, Side.BUY, close, atr, fast, slow)]
        if downtrend and close >= fast - shallow * atr and close > fast - deep * atr:
            return [self._build(ctx, Side.SELL, close, atr, fast, slow)]
        return []

    def _build(
        self, ctx: StrategyContext, side: Side, close: float, atr: float,
        fast: float, slow: float,
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
            confidence=self.score_confidence(
                {
                    "trend_alignment": min(
                        1.0, abs(fast - slow) / (atr * _SEPARATION_SATURATION_ATR)
                    ),
                    "market_structure": (
                        1.0 if (ctx.feature("swing_trend") or 0.0) * sign > 0 else 0.0
                    ),
                    "spread_condition": self._spread_score(ctx),
                }
            ),
            reason_codes=(
                "TREND_PULLBACK",
                "LONG_PULLBACK" if side is Side.BUY else "SHORT_PULLBACK",
            ),
        )

    def _spread_score(self, ctx: StrategyContext) -> float | None:
        spread_ticks = ctx.feature("spread_ticks")
        limit = ctx.instrument.max_spread_ticks
        if spread_ticks is None or limit <= 0:
            return None
        return max(0.0, min(1.0, 1.0 - spread_ticks / limit))
