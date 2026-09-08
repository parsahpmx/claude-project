"""VWAP mean-reversion strategy.

Thesis: within a balanced session, price that trades far from the volume-weighted average
tends to return toward it, because the VWAP is where the session's volume actually
transacted and is a reference for participants working large orders.

The thesis is *conditional*, and the conditions are enforced rather than assumed:

* it applies in a **range** or **low-volatility** regime; in a trend, distance from VWAP
  is the signal to go *with*, not against (``allowed_regimes`` in ``strategies.yaml``);
* the band must be wider than the spread, or the "edge" is smaller than the cost of
  crossing it (``min_sigma_ticks``);
* the VWAP must be built from enough of the session to mean anything
  (``min_bars_for_vwap``).

No numeric trading constant appears below: every threshold is read from configuration.
"""

from __future__ import annotations

from typing import Any

from core.events import BarEvent, Side
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyConfig, StrategyContext

__all__ = ["VWAPMeanReversionStrategy"]

# Shape constants for the confidence mapping, not trading thresholds: they define where
# each component's score saturates, and moving them cannot change whether a trade is
# allowed — only how far size may be scaled down inside an approved envelope.
_DEPTH_SATURATION_MULTIPLE = 2.0
_BAND_TO_SPREAD_SATURATION = 4.0

_REQUIRED_PARAMS = (
    "entry_deviation_sigma",
    "exit_deviation_sigma",
    "min_bars_for_vwap",
    "stop_atr_multiple",
    "target_atr_multiple",
    "max_holding_bars",
    "min_sigma_ticks",
    "cooldown_bars_after_exit",
    "trade_direction",
)


class VWAPMeanReversionStrategy(BaseStrategy):
    """Fade extensions from session VWAP, in range-like conditions only.

    Entry (long; short is the mirror):
        price is at least ``entry_deviation_sigma`` standard deviations **below** session
        VWAP, the session has at least ``min_bars_for_vwap`` bars, the VWAP dispersion is
        at least ``min_sigma_ticks`` ticks wide, and no cooldown is active.

    Exit, whichever comes first:
        price returns to within ``exit_deviation_sigma`` of VWAP; the position has been
        held ``max_holding_bars``; or the protective stop/target placed at entry is hit.

    Stops and targets are ATR multiples rather than fixed points, so the geometry adapts
    to volatility instead of being tuned to one instrument's typical range.
    """

    def __init__(
        self,
        config: StrategyConfig,
        instruments: dict[str, Instrument],
        confidence_scorer: ConfidenceScorer | None = None,
    ) -> None:
        super().__init__(config, instruments, confidence_scorer)
        self._cooldown_remaining: dict[str, int] = {}
        self._bars_in_position: dict[str, int] = {}

    def validate_params(self, params: dict[str, Any]) -> None:
        missing = [p for p in _REQUIRED_PARAMS if p not in params]
        if missing:
            raise ValueError(
                f"{self.config.strategy_id}: missing required params: {', '.join(missing)}. "
                "Add them under strategies.yaml -> params."
            )
        if params["entry_deviation_sigma"] <= params["exit_deviation_sigma"]:
            raise ValueError(
                f"{self.config.strategy_id}: entry_deviation_sigma "
                f"({params['entry_deviation_sigma']}) must exceed exit_deviation_sigma "
                f"({params['exit_deviation_sigma']}), otherwise every entry exits "
                "immediately"
            )
        for name in ("stop_atr_multiple", "target_atr_multiple", "min_sigma_ticks"):
            if params[name] <= 0:
                raise ValueError(f"{self.config.strategy_id}: {name} must be positive")
        if params["max_holding_bars"] < 1:
            raise ValueError(f"{self.config.strategy_id}: max_holding_bars must be >= 1")
        direction = str(params["trade_direction"]).upper()
        if direction not in ("LONG", "SHORT", "BOTH"):
            raise ValueError(
                f"{self.config.strategy_id}: trade_direction must be LONG, SHORT or BOTH, "
                f"got {direction!r}"
            )

    def reset(self) -> None:
        super().reset()
        self._cooldown_remaining.clear()
        self._bars_in_position.clear()

    def on_bar(self, event: BarEvent, ctx: StrategyContext) -> list[Signal]:
        """Bars drive this strategy; ticks are used only for the current mid.

        Only closed bars reach here — the feature engine drops partial bars, and
        ``require_closed`` would raise if one slipped through.
        """
        if not event.is_closed or event.timeframe is not self.config.timeframe:
            return []

        instrument_id = ctx.instrument.instrument_id
        if not ctx.position.is_flat:
            self._bars_in_position[instrument_id] = (
                self._bars_in_position.get(instrument_id, 0) + 1
            )
        else:
            self._bars_in_position.pop(instrument_id, None)
            remaining = self._cooldown_remaining.get(instrument_id, 0)
            if remaining > 0:
                self._cooldown_remaining[instrument_id] = remaining - 1

        return self.generate_signal(ctx)

    def generate_signal(self, ctx: StrategyContext) -> list[Signal]:
        if not ctx.is_session_open:
            return []
        if not self.config.allows(ctx.regime):
            # Not an error: the regime engine has determined this strategy's thesis does
            # not hold right now.  Being switched off is the control working.
            return []
        if not ctx.position.is_flat:
            return self._evaluate_exit(ctx)
        return self._evaluate_entry(ctx)

    # -- exits --------------------------------------------------------------------------

    def _evaluate_exit(self, ctx: StrategyContext) -> list[Signal]:
        instrument_id = ctx.instrument.instrument_id
        held = self._bars_in_position.get(instrument_id, 0)
        max_hold = int(self.param("max_holding_bars"))

        if held >= max_hold:
            self._start_cooldown(instrument_id)
            return [self.make_exit_signal(ctx, reason_codes=("MAX_HOLDING_BARS",))]

        if not ctx.features.has("vwap", "vwap_std", "last_close"):
            return []
        vwap, vwap_std, close = ctx.require_features("vwap", "vwap_std", "last_close")
        if vwap_std <= 0:
            return []

        deviation = (close - vwap) / vwap_std
        exit_sigma = float(self.param("exit_deviation_sigma"))

        # Reverted to the mean: the thesis has played out, so take it.
        reverted = (
            ctx.position.is_long and deviation >= -exit_sigma
        ) or (ctx.position.is_short and deviation <= exit_sigma)
        if reverted:
            self._start_cooldown(instrument_id)
            return [self.make_exit_signal(ctx, reason_codes=("VWAP_REVERSION_COMPLETE",))]
        return []

    def _start_cooldown(self, instrument_id: str) -> None:
        self._cooldown_remaining[instrument_id] = int(self.param("cooldown_bars_after_exit"))

    # -- entries ------------------------------------------------------------------------

    def _evaluate_entry(self, ctx: StrategyContext) -> list[Signal]:
        instrument_id = ctx.instrument.instrument_id
        if self._cooldown_remaining.get(instrument_id, 0) > 0:
            return []

        required = ("vwap", "vwap_std", "atr", "last_close")
        if not ctx.features.has(*required):
            return []  # still warming up; absence is not an error
        vwap, vwap_std, atr, close = ctx.require_features(*required)

        if ctx.features.bar_count < int(self.param("min_bars_for_vwap")):
            return []

        tick = ctx.instrument.tick_size
        if vwap_std / tick < float(self.param("min_sigma_ticks")):
            # The band is inside the noise floor: any "edge" here is smaller than the
            # cost of crossing the spread to capture it.
            return []
        if atr <= 0:
            return []

        deviation = (close - vwap) / vwap_std
        entry_sigma = float(self.param("entry_deviation_sigma"))
        direction_filter = str(self.param("trade_direction")).upper()

        if deviation <= -entry_sigma and direction_filter in ("LONG", "BOTH"):
            return [self._build_entry(ctx, Side.BUY, close, atr, deviation)]
        if deviation >= entry_sigma and direction_filter in ("SHORT", "BOTH"):
            return [self._build_entry(ctx, Side.SELL, close, atr, deviation)]
        return []

    def _build_entry(
        self, ctx: StrategyContext, side: Side, close: float, atr: float, deviation: float
    ) -> Signal:
        stop_distance = atr * float(self.param("stop_atr_multiple"))
        target_distance = atr * float(self.param("target_atr_multiple"))
        sign = side.sign
        entry = ctx.feature("mid") or close

        return self.make_signal(
            ctx=ctx,
            direction=side,
            intent=SignalIntent.ENTER,
            entry=entry,
            stop=entry - sign * stop_distance,
            target=entry + sign * target_distance,
            entry_type=EntryType.MARKETABLE_LIMIT,
            confidence=self._confidence(ctx, deviation),
            reason_codes=(
                "VWAP_DEVIATION",
                f"SIGMA_{abs(deviation):.1f}",
                "LONG_FADE" if side is Side.BUY else "SHORT_FADE",
            ),
        )

    def _confidence(self, ctx: StrategyContext, deviation: float) -> float:
        """Score the confirmations this strategy can observe.

        Each component is a number in [0, 1], or ``None`` when the evidence is absent.
        The weights that combine them are configured centrally under
        ``strategies.yaml -> confidence.weights``; nothing here is a tunable trading
        constant.
        """
        entry_sigma = float(self.param("entry_deviation_sigma"))
        max_depth_sigma = entry_sigma * _DEPTH_SATURATION_MULTIPLE

        observations: dict[str, float | None] = {
            # How far beyond the entry threshold the extension has gone, saturating at
            # twice the threshold.
            "vwap_alignment": (
                min(1.0, abs(deviation) / max_depth_sigma) if max_depth_sigma > 0 else None
            ),
            "spread_condition": self._spread_score(ctx),
            "order_flow_confirmation": self._flow_score(ctx, deviation),
            "volatility_regime": self._volatility_score(ctx),
        }
        return self.score_confidence(observations)

    def _spread_score(self, ctx: StrategyContext) -> float | None:
        """1 at a zero spread, 0 at the instrument's configured maximum."""
        spread_ticks = ctx.feature("spread_ticks")
        limit = ctx.instrument.max_spread_ticks
        if spread_ticks is None or limit <= 0:
            return None
        return max(0.0, min(1.0, 1.0 - spread_ticks / limit))

    def _flow_score(self, ctx: StrategyContext, deviation: float) -> float | None:
        """Whether aggression opposes the extension we are fading.

        Maps a signed imbalance in [-1, 1] onto [0, 1].  ``None`` when the feed tagged no
        aggressor, so the component is excluded rather than scored as balanced.
        """
        imbalance = ctx.feature("trade_imbalance")
        if imbalance is None:
            return None
        opposing = -imbalance if deviation < 0 else imbalance
        return max(0.0, min(1.0, (opposing + 1.0) / 2.0))

    def _volatility_score(self, ctx: StrategyContext) -> float | None:
        """Prefer a band that is wide relative to the spread it must overcome."""
        vwap_std = ctx.feature("vwap_std")
        spread = ctx.feature("spread")
        if vwap_std is None or spread is None or spread <= 0:
            return None
        return max(0.0, min(1.0, (vwap_std / spread) / _BAND_TO_SPREAD_SATURATION))
