"""Liquidity sweep.

Thesis: price is drawn to clusters of resting stops — equal highs and lows — and a move
that takes them and immediately reverses was a sweep, not a breakout. The reversal is the
trade.

The distinction between a sweep and a genuine break is *reclaim*: price must return inside
the level within ``reclaim_bars``. Without that condition this is a breakout strategy
positioned backwards, which is why the reclaim is required rather than assumed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.events import BarEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext
from core.util.clock import Nanos

__all__ = ["LiquiditySweepStrategy"]

_REQUIRED_PARAMS = (
    "equal_level_tolerance_ticks",
    "reclaim_bars",
    "stop_atr_multiple",
    "target_atr_multiple",
    "max_holding_bars",
)

_PENETRATION_SATURATION_ATR = 0.5


@dataclass(slots=True)
class _PendingSweep:
    """A level that has been taken, awaiting a reclaim."""

    level: float
    is_high: bool
    swept_at: Nanos
    bars_since: int = 0
    extreme: float = 0.0


class LiquiditySweepStrategy(BaseStrategy):
    """Fade a level that was taken and immediately reclaimed.

    Entry (long): price traded below a known low (session, previous session, or swing) and
    closed back above it within ``reclaim_bars``.
    """

    def __init__(
        self,
        config: StrategyConfig,
        instruments: dict[str, Instrument],
        confidence_scorer: ConfidenceScorer | None = None,
    ) -> None:
        super().__init__(config, instruments, confidence_scorer)
        self._pending: dict[str, _PendingSweep] = {}
        self._bars_in_position: dict[str, int] = {}

    def validate_params(self, params: dict[str, Any]) -> None:
        missing = [p for p in _REQUIRED_PARAMS if p not in params]
        if missing:
            raise ValueError(
                f"{self.config.strategy_id}: missing required params: {', '.join(missing)}"
            )
        if params["reclaim_bars"] < 1:
            raise ValueError(f"{self.config.strategy_id}: reclaim_bars must be at least 1")
        for name in ("stop_atr_multiple", "target_atr_multiple"):
            if params[name] <= 0:
                raise ValueError(f"{self.config.strategy_id}: {name} must be positive")

    def reset(self) -> None:
        super().reset()
        self._pending.clear()
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

        self._age_pending(instrument_id)
        self._detect_sweep(event, ctx)
        return self.generate_signal(ctx)

    def _age_pending(self, instrument_id: str) -> None:
        """Expire a sweep that was never reclaimed. It was a real break."""
        pending = self._pending.get(instrument_id)
        if pending is None:
            return
        pending.bars_since += 1
        if pending.bars_since > int(self.param("reclaim_bars")):
            del self._pending[instrument_id]

    def _detect_sweep(self, bar: BarEvent, ctx: StrategyContext) -> None:
        """Record a level this bar traded through.

        Registration depends on **penetration only**, not on where the bar closed. An
        earlier version also required the close back inside the level, which conflated
        "swept" with "already reclaimed": a sweep that closed beyond the level was never
        recorded, so the multi-bar reclaim path could never run and ``reclaim_bars`` was
        dead configuration.

        Whether the reclaim has happened is :meth:`generate_signal`'s question, and it may
        be answered on this same bar or on a later one within the window.
        """
        instrument_id = ctx.instrument.instrument_id
        if instrument_id in self._pending:
            return

        tolerance = float(self.param("equal_level_tolerance_ticks")) * ctx.instrument.tick_size
        for name, is_high in (
            ("prev_session_high", True),
            ("session_high", True),
            ("prev_session_low", False),
            ("session_low", False),
        ):
            level = ctx.feature(name)
            if level is None or level <= 0:
                continue
            if is_high and bar.high > level + tolerance:
                self._pending[instrument_id] = _PendingSweep(
                    level, True, bar.ts_close, extreme=bar.high
                )
                return
            if not is_high and bar.low < level - tolerance:
                self._pending[instrument_id] = _PendingSweep(
                    level, False, bar.ts_close, extreme=bar.low
                )
                return

    def generate_signal(self, ctx: StrategyContext) -> list[Signal]:
        if not ctx.is_session_open or not self.config.allows(ctx.regime):
            return []
        if not ctx.position.is_flat:
            held = self._bars_in_position.get(ctx.instrument.instrument_id, 0)
            if held >= int(self.param("max_holding_bars")):
                return [self.make_exit_signal(ctx, reason_codes=("MAX_HOLDING_BARS",))]
            return []

        instrument_id = ctx.instrument.instrument_id
        pending = self._pending.get(instrument_id)
        if pending is None:
            return []
        if not ctx.features.has("atr", "last_close"):
            return []
        atr, close = ctx.require_features("atr", "last_close")
        if atr <= 0:
            return []

        # The reclaim: price is back on the original side of the level.
        reclaimed = (close < pending.level) if pending.is_high else (close > pending.level)
        if not reclaimed:
            return []

        del self._pending[instrument_id]
        side = Side.SELL if pending.is_high else Side.BUY
        return [self._build(ctx, side, close, atr, pending)]

    def _build(
        self, ctx: StrategyContext, side: Side, close: float, atr: float,
        sweep: _PendingSweep,
    ) -> Signal:
        entry = ctx.feature("mid") or close
        sign = side.sign
        # The stop goes beyond the swept extreme: if price returns there the sweep thesis
        # was wrong, and an ATR stop that sits inside the wick would be taken out by noise
        # the setup itself created.
        beyond = ctx.instrument.tick_size
        atr_stop = entry - sign * atr * float(self.param("stop_atr_multiple"))
        wick_stop = sweep.extreme + (beyond if side is Side.SELL else -beyond)
        stop = min(atr_stop, wick_stop) if side is Side.BUY else max(atr_stop, wick_stop)

        penetration = abs(sweep.extreme - sweep.level)
        return self.make_signal(
            ctx=ctx,
            direction=side,
            intent=SignalIntent.ENTER,
            entry=entry,
            stop=stop,
            target=entry + sign * atr * float(self.param("target_atr_multiple")),
            entry_type=EntryType.MARKETABLE_LIMIT,
            confidence=self.score_confidence(
                {
                    "liquidity_event": min(
                        1.0, penetration / (atr * _PENETRATION_SATURATION_ATR)
                    ) if atr > 0 else None,
                    "market_structure": 1.0 if sweep.bars_since <= 1 else 0.0,
                    "order_flow_confirmation": self._flow_score(ctx, side),
                }
            ),
            reason_codes=(
                "LIQUIDITY_SWEEP",
                "HIGH_SWEPT" if sweep.is_high else "LOW_SWEPT",
            ),
        )

    def _flow_score(self, ctx: StrategyContext, side: Side) -> float | None:
        """Aggression should oppose the swept direction."""
        imbalance = ctx.feature("trade_imbalance")
        if imbalance is None:
            return None
        aligned = imbalance * side.sign
        return max(0.0, min(1.0, (aligned + 1.0) / 2.0))
