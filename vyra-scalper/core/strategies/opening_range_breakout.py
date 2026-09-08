"""Opening range breakout.

Thesis: the first minutes of a session establish a range that reflects overnight
information being priced in. A break of that range, once it is complete, often sets the
session's direction.

The session-awareness is the whole strategy: an "opening range" computed from whatever
bars happened to load first is not an opening range at all.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from core.events import BarEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext
from core.util.clock import NS_PER_MIN

__all__ = ["OpeningRangeBreakoutStrategy"]

_REQUIRED_PARAMS = (
    "opening_range_minutes",
    "breakout_buffer_ticks",
    "stop_atr_multiple",
    "target_atr_multiple",
    "one_trade_per_session",
)

_RANGE_WIDTH_SATURATION_ATR = 2.0


class OpeningRangeBreakoutStrategy(BaseStrategy):
    """Trade the first clean break of the session's opening range.

    Entry: after the opening range is complete, a close beyond its high or low by
    ``breakout_buffer_ticks``.

    With ``one_trade_per_session`` set, only the first break is taken. Repeated breaks of
    the same level within one session are the range failing, not the thesis repeating.
    """

    def __init__(
        self,
        config: StrategyConfig,
        instruments: dict[str, Instrument],
        confidence_scorer: ConfidenceScorer | None = None,
    ) -> None:
        super().__init__(config, instruments, confidence_scorer)
        self._traded_sessions: dict[str, date | None] = {}
        self._session_open_ns: dict[str, int] = {}

    def validate_params(self, params: dict[str, Any]) -> None:
        missing = [p for p in _REQUIRED_PARAMS if p not in params]
        if missing:
            raise ValueError(
                f"{self.config.strategy_id}: missing required params: {', '.join(missing)}"
            )
        if params["opening_range_minutes"] <= 0:
            raise ValueError(
                f"{self.config.strategy_id}: opening_range_minutes must be positive"
            )
        for name in ("stop_atr_multiple", "target_atr_multiple"):
            if params[name] <= 0:
                raise ValueError(f"{self.config.strategy_id}: {name} must be positive")

    def reset(self) -> None:
        super().reset()
        self._traded_sessions.clear()
        self._session_open_ns.clear()

    def on_bar(self, event: BarEvent, ctx: StrategyContext) -> list[Signal]:
        if not event.is_closed or event.timeframe is not self.config.timeframe:
            return []
        return self.generate_signal(ctx)

    def generate_signal(self, ctx: StrategyContext) -> list[Signal]:
        if not ctx.is_session_open or not self.config.allows(ctx.regime):
            return []
        if not ctx.position.is_flat:
            return []

        instrument_id = ctx.instrument.instrument_id
        # A new session resets the once-per-session flag. Detected from the session open
        # timestamp rather than a wall-clock date, so an overnight session is one session.
        if self._session_open_ns.get(instrument_id) != ctx.session_open_ns:
            self._session_open_ns[instrument_id] = ctx.session_open_ns
            self._traded_sessions.pop(instrument_id, None)

        if bool(self.param("one_trade_per_session")) and instrument_id in self._traded_sessions:
            return []

        if not self._range_is_complete(ctx):
            return []

        required = ("opening_range_high", "opening_range_low", "atr", "last_close")
        if not ctx.features.has(*required):
            return []
        high, low, atr, close = ctx.require_features(*required)
        if atr <= 0 or high <= low:
            return []

        buffer_price = float(self.param("breakout_buffer_ticks")) * ctx.instrument.tick_size
        if close > high + buffer_price:
            self._traded_sessions[instrument_id] = None
            return [self._build(ctx, Side.BUY, close, atr, high - low)]
        if close < low - buffer_price:
            self._traded_sessions[instrument_id] = None
            return [self._build(ctx, Side.SELL, close, atr, high - low)]
        return []

    def _range_is_complete(self, ctx: StrategyContext) -> bool:
        """Whether enough of the session has elapsed for the range to be formed.

        Trading a break of a range that is still forming is a look-ahead error in
        disguise: the "range" would be redefined by the very bar being traded.
        """
        if ctx.session_open_ns <= 0:
            return False
        elapsed_minutes = (ctx.ts - ctx.session_open_ns) / NS_PER_MIN
        return elapsed_minutes >= float(self.param("opening_range_minutes"))

    def _build(
        self, ctx: StrategyContext, side: Side, close: float, atr: float, width: float
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
                    # A wider opening range is a more meaningful level to break.
                    "market_structure": min(
                        1.0, width / (atr * _RANGE_WIDTH_SATURATION_ATR)
                    ) if atr > 0 else None,
                    "volume_confirmation": self._volume_score(ctx),
                    "spread_condition": self._spread_score(ctx),
                }
            ),
            reason_codes=(
                "OPENING_RANGE_BREAKOUT",
                "LONG_BREAK" if side is Side.BUY else "SHORT_BREAK",
            ),
        )

    def _volume_score(self, ctx: StrategyContext) -> float | None:
        volume = ctx.feature("last_volume")
        average = ctx.feature("avg_volume")
        if volume is None or average is None or average <= 0:
            return None
        return max(0.0, min(1.0, volume / (average * _RANGE_WIDTH_SATURATION_ATR)))

    def _spread_score(self, ctx: StrategyContext) -> float | None:
        spread_ticks = ctx.feature("spread_ticks")
        limit = ctx.instrument.max_spread_ticks
        if spread_ticks is None or limit <= 0:
            return None
        return max(0.0, min(1.0, 1.0 - spread_ticks / limit))
