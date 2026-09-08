"""Order-flow imbalance.

Thesis: sustained one-sided aggression, against a book that is not deep enough to absorb
it, precedes a short move in the direction of the aggression.

This strategy **requires exchange depth**. Broker CFD quoting is one dealer's spread
policy, not centralised liquidity, so the loader refuses to attach it to a CFD instrument
(``DATA_SPEC.md`` §6) and it reads only ``exch.*`` features.
"""

from __future__ import annotations

from typing import Any

from core.events import BarEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext

__all__ = ["OrderFlowImbalanceStrategy"]

_REQUIRED_PARAMS = (
    "imbalance_threshold",
    "min_book_size",
    "stop_atr_multiple",
    "target_atr_multiple",
    "max_holding_bars",
    "max_spread_ticks",
)

_EXCH = "exch"


class OrderFlowImbalanceStrategy(BaseStrategy):
    """Follow sustained aggression against a thin book.

    Entry (long): trade imbalance exceeds ``imbalance_threshold`` to the buy side, the
    book's depth imbalance agrees, top-of-book size on the offer is at least
    ``min_book_size`` (so there is something to trade against), and the spread is tight.
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
        threshold = params["imbalance_threshold"]
        if not 0 < threshold < 1:
            raise ValueError(
                f"{self.config.strategy_id}: imbalance_threshold must be in (0, 1), got "
                f"{threshold}. It is compared against a signed imbalance in [-1, 1]."
            )
        for name in ("stop_atr_multiple", "target_atr_multiple"):
            if params[name] <= 0:
                raise ValueError(f"{self.config.strategy_id}: {name} must be positive")
        if not self.config.requires_exchange_depth:
            raise ValueError(
                f"{self.config.strategy_id}: requires_exchange_depth must be true. This "
                "strategy reads centralised book microstructure, which a broker CFD feed "
                "does not provide (DATA_SPEC.md §6)."
            )

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

        # Exchange-namespaced features only. A missing one means no depth is available,
        # and this strategy has nothing to say without it.
        imbalance = ctx.feature(f"{_EXCH}.trade_imbalance")
        depth_imbalance = ctx.feature(f"{_EXCH}.depth_imbalance")
        spread_ticks = ctx.feature(f"{_EXCH}.spread_ticks")
        bid_liquidity = ctx.feature(f"{_EXCH}.bid_liquidity")
        ask_liquidity = ctx.feature(f"{_EXCH}.ask_liquidity")
        if None in (imbalance, depth_imbalance, spread_ticks, bid_liquidity, ask_liquidity):
            return []
        if not ctx.features.has("atr", "last_close"):
            return []
        atr, close = ctx.require_features("atr", "last_close")
        if atr <= 0:
            return []

        assert imbalance is not None and depth_imbalance is not None
        assert spread_ticks is not None and bid_liquidity is not None
        assert ask_liquidity is not None

        if spread_ticks > float(self.param("max_spread_ticks")):
            return []

        threshold = float(self.param("imbalance_threshold"))
        min_size = float(self.param("min_book_size"))

        # Aggression and resting depth must agree. Aggression into a wall is absorption,
        # which is the opposite setup.
        if imbalance >= threshold and depth_imbalance > 0 and ask_liquidity >= min_size:
            return [self._build(ctx, Side.BUY, close, atr, imbalance, depth_imbalance)]
        if imbalance <= -threshold and depth_imbalance < 0 and bid_liquidity >= min_size:
            return [self._build(ctx, Side.SELL, close, atr, imbalance, depth_imbalance)]
        return []

    def _build(
        self, ctx: StrategyContext, side: Side, close: float, atr: float,
        imbalance: float, depth_imbalance: float,
    ) -> Signal:
        entry = ctx.feature(f"{_EXCH}.mid") or ctx.feature("mid") or close
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
                    "order_flow_confirmation": min(1.0, abs(imbalance)),
                    "liquidity_event": min(1.0, abs(depth_imbalance)),
                    "spread_condition": self._spread_score(ctx),
                }
            ),
            reason_codes=(
                "ORDER_FLOW_IMBALANCE",
                "BUY_AGGRESSION" if side is Side.BUY else "SELL_AGGRESSION",
            ),
        )

    def _spread_score(self, ctx: StrategyContext) -> float | None:
        spread_ticks = ctx.feature(f"{_EXCH}.spread_ticks")
        limit = ctx.instrument.max_spread_ticks
        if spread_ticks is None or limit <= 0:
            return None
        return max(0.0, min(1.0, 1.0 - spread_ticks / limit))
