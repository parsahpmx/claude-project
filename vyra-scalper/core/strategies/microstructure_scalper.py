"""Microstructure scalper.

Thesis: when the size-weighted mid (microprice) diverges from the arithmetic mid, the book
is telling you which way the next tick is more likely to go, because the thin side is the
side about to be consumed.

This is the strategy most exposed to costs: it targets a few ticks, so the spread and the
commission are a large fraction of the edge. It therefore refuses to trade unless the
spread is at its tightest, and its target must exceed its round-trip cost — a condition
checked explicitly rather than assumed.

**Requires exchange depth.** A CFD microprice is one dealer's quoting.
"""

from __future__ import annotations

from typing import Any

from core.events import QuoteEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext
from core.util.clock import NS_PER_SEC

__all__ = ["MicrostructureScalperStrategy"]

_REQUIRED_PARAMS = (
    "microprice_deviation_ticks",
    "min_imbalance",
    "max_spread_ticks",
    "target_ticks",
    "stop_ticks",
    "max_holding_seconds",
    "min_edge_ticks_over_cost",
)

_EXCH = "exch"


class MicrostructureScalperStrategy(BaseStrategy):
    """Take a few ticks in the direction the book is leaning.

    Entry (long): the microprice sits at least ``microprice_deviation_ticks`` above the
    mid, the book imbalance agrees and exceeds ``min_imbalance``, the spread is at or
    inside ``max_spread_ticks``, and the target clears the round-trip cost by
    ``min_edge_ticks_over_cost``.

    Driven by quotes rather than bars: at this horizon a one-minute bar has already
    happened.
    """

    def __init__(
        self,
        config: StrategyConfig,
        instruments: dict[str, Instrument],
        confidence_scorer: ConfidenceScorer | None = None,
    ) -> None:
        super().__init__(config, instruments, confidence_scorer)
        self._entry_ts: dict[str, int] = {}

    def validate_params(self, params: dict[str, Any]) -> None:
        missing = [p for p in _REQUIRED_PARAMS if p not in params]
        if missing:
            raise ValueError(
                f"{self.config.strategy_id}: missing required params: {', '.join(missing)}"
            )
        if not 0 < params["min_imbalance"] < 1:
            raise ValueError(
                f"{self.config.strategy_id}: min_imbalance must be in (0, 1), got "
                f"{params['min_imbalance']}"
            )
        for name in ("target_ticks", "stop_ticks", "max_spread_ticks"):
            if params[name] <= 0:
                raise ValueError(f"{self.config.strategy_id}: {name} must be positive")
        if not self.config.requires_exchange_depth:
            raise ValueError(
                f"{self.config.strategy_id}: requires_exchange_depth must be true. A CFD "
                "microprice is one dealer's quoting, not market liquidity."
            )

    def reset(self) -> None:
        super().reset()
        self._entry_ts.clear()

    def on_quote(self, event: QuoteEvent, ctx: StrategyContext) -> list[Signal]:
        return self.generate_signal(ctx)

    def generate_signal(self, ctx: StrategyContext) -> list[Signal]:
        if not ctx.is_session_open or not self.config.allows(ctx.regime):
            return []
        instrument_id = ctx.instrument.instrument_id

        if not ctx.position.is_flat:
            entered = self._entry_ts.get(instrument_id, ctx.position.entry_ts)
            if entered and (ctx.ts - entered) >= int(
                float(self.param("max_holding_seconds")) * NS_PER_SEC
            ):
                self._entry_ts.pop(instrument_id, None)
                return [self.make_exit_signal(ctx, reason_codes=("MAX_HOLDING_SECONDS",))]
            return []

        deviation = ctx.feature(f"{_EXCH}.microprice_deviation_ticks")
        imbalance = ctx.feature(f"{_EXCH}.book_imbalance")
        spread_ticks = ctx.feature(f"{_EXCH}.spread_ticks")
        mid = ctx.feature(f"{_EXCH}.mid")
        if None in (deviation, imbalance, spread_ticks, mid):
            return []
        assert deviation is not None and imbalance is not None
        assert spread_ticks is not None and mid is not None

        if spread_ticks > float(self.param("max_spread_ticks")):
            return []
        if not self._edge_clears_cost(spread_ticks):
            return []

        threshold = float(self.param("microprice_deviation_ticks"))
        min_imbalance = float(self.param("min_imbalance"))

        if deviation >= threshold and imbalance >= min_imbalance:
            return [self._build(ctx, Side.BUY, mid, deviation, imbalance)]
        if deviation <= -threshold and imbalance <= -min_imbalance:
            return [self._build(ctx, Side.SELL, mid, deviation, imbalance)]
        return []

    def _edge_clears_cost(self, spread_ticks: float) -> bool:
        """Whether the target survives the round trip.

        A two-tick target on a two-tick spread is not an edge; it is a fee. Checked
        explicitly because at this horizon the cost is the same order of magnitude as the
        move being targeted, and no other component knows the strategy's intended target.
        """
        target = float(self.param("target_ticks"))
        # Crossing on entry and exit costs roughly one full spread in total.
        round_trip_cost_ticks = spread_ticks
        return target - round_trip_cost_ticks >= float(
            self.param("min_edge_ticks_over_cost")
        )

    def _build(
        self, ctx: StrategyContext, side: Side, mid: float, deviation: float,
        imbalance: float,
    ) -> Signal:
        tick = ctx.instrument.tick_size
        sign = side.sign
        self._entry_ts[ctx.instrument.instrument_id] = ctx.ts
        return self.make_signal(
            ctx=ctx,
            direction=side,
            intent=SignalIntent.ENTER,
            entry=mid,
            stop=mid - sign * float(self.param("stop_ticks")) * tick,
            target=mid + sign * float(self.param("target_ticks")) * tick,
            entry_type=EntryType.MARKETABLE_LIMIT,
            confidence=self.score_confidence(
                {
                    "order_flow_confirmation": min(1.0, abs(imbalance)),
                    "market_structure": min(
                        1.0, abs(deviation) / float(self.param("microprice_deviation_ticks"))
                    ),
                    "spread_condition": max(
                        0.0,
                        min(1.0, 1.0 - (ctx.feature(f"{_EXCH}.spread_ticks") or 0.0)
                            / ctx.instrument.max_spread_ticks),
                    ) if ctx.instrument.max_spread_ticks > 0 else None,
                }
            ),
            reason_codes=(
                "MICROPRICE_DEVIATION",
                "BOOK_LEANS_BID" if side is Side.BUY else "BOOK_LEANS_ASK",
            ),
        )
