"""Market regime classification.

Deterministic and rule-based, as specified for the first implementation (§7).  An ML
classifier replaces the rules in a later phase, behind the same interface, so strategies
and the risk engine do not change when it lands.

Two design rules:

* **Insufficient evidence is ``UNKNOWN``, and ``UNKNOWN`` blocks trading** for any strategy
  that declares an allowed-regime list.  Trading a mean-reversion strategy through an
  unclassified market because "we could not tell" is the failure mode the regime gate
  exists to prevent.
* **Thresholds are configured**, never hardcoded.  A regime boundary is a trading
  parameter like any other and belongs in ``configs/regime.yaml``.

Classification is deliberately hysteretic: a regime must persist for a configured number
of bars before it is published, so a single noisy bar cannot toggle a strategy on and off.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from core.config.loader import ConfigSection
from core.events import Regime
from core.features.engine import FeatureSnapshot
from core.instruments.instrument import Instrument
from core.util.clock import Nanos
from core.util.logging import get_logger

__all__ = ["MarketRegimeEngine", "RegimeClassification", "RegimeConfig"]

_log = get_logger("regime.engine")


@dataclass(frozen=True, slots=True)
class RegimeConfig:
    """Regime thresholds.

    Attributes:
        min_bars: bars of history required before any classification other than
            ``UNKNOWN`` is published.
        confirm_bars: consecutive bars a candidate regime must hold before it is adopted.
        trend_ema_separation_atr: EMA separation, in ATR units, above which the market is
            treated as trending.
        breakout_atr: distance beyond the recent range, in ATR units, that marks a
            breakout.
        low_vol_ratio / high_vol_ratio: current ATR divided by its own rolling median.
        range_containment: fraction of the recent range within which price must sit for
            the market to be called a range.
        vol_lookback: bars over which the ATR median is taken.
    """

    min_bars: int = 30
    confirm_bars: int = 3
    trend_ema_separation_atr: float = 0.5
    breakout_atr: float = 0.75
    low_vol_ratio: float = 0.7
    high_vol_ratio: float = 1.6
    range_containment: float = 0.8
    vol_lookback: int = 50

    def __post_init__(self) -> None:
        if self.min_bars < 1:
            raise ValueError("min_bars must be at least 1")
        if self.confirm_bars < 1:
            raise ValueError("confirm_bars must be at least 1")
        if not 0 < self.low_vol_ratio < self.high_vol_ratio:
            raise ValueError(
                f"require 0 < low_vol_ratio ({self.low_vol_ratio}) < high_vol_ratio "
                f"({self.high_vol_ratio})"
            )
        if not 0 < self.range_containment <= 1:
            raise ValueError("range_containment must be in (0, 1]")

    @classmethod
    def from_config(cls, section: ConfigSection) -> RegimeConfig:
        return cls(
            min_bars=section.int_("min_bars", 30),
            confirm_bars=section.int_("confirm_bars", 3),
            trend_ema_separation_atr=section.float_("trend_ema_separation_atr", 0.5),
            breakout_atr=section.float_("breakout_atr", 0.75),
            low_vol_ratio=section.float_("low_vol_ratio", 0.7),
            high_vol_ratio=section.float_("high_vol_ratio", 1.6),
            range_containment=section.float_("range_containment", 0.8),
            vol_lookback=section.int_("vol_lookback", 50),
        )


@dataclass(frozen=True, slots=True)
class RegimeClassification:
    """The published regime, with the evidence that produced it."""

    regime: Regime
    ts: Nanos
    candidate: Regime = Regime.UNKNOWN
    confirm_count: int = 0
    evidence: dict[str, float] = field(default_factory=dict)

    @property
    def is_known(self) -> bool:
        return self.regime is not Regime.UNKNOWN

    def to_dict(self) -> dict[str, object]:
        return {
            "regime": self.regime.value,
            "candidate": self.candidate.value,
            "confirm_count": self.confirm_count,
            "ts": self.ts,
            "evidence": {k: round(v, 6) for k, v in sorted(self.evidence.items())},
        }


class MarketRegimeEngine:
    """Classifies each instrument's market state from its feature snapshot."""

    __slots__ = ("_atr_history", "_candidate", "_config", "_confirm", "_published")

    def __init__(self, config: RegimeConfig | None = None) -> None:
        self._config = config or RegimeConfig()
        self._atr_history: dict[str, deque[float]] = {}
        self._candidate: dict[str, Regime] = {}
        self._confirm: dict[str, int] = {}
        self._published: dict[str, RegimeClassification] = {}

    @property
    def config(self) -> RegimeConfig:
        return self._config

    def current(self, instrument_id: str) -> Regime:
        """The published regime, or ``UNKNOWN`` if nothing has been confirmed yet."""
        classification = self._published.get(instrument_id)
        return classification.regime if classification else Regime.UNKNOWN

    def classification(self, instrument_id: str) -> RegimeClassification | None:
        return self._published.get(instrument_id)

    def on_bar_close(
        self, instrument: Instrument, snapshot: FeatureSnapshot, ts: Nanos
    ) -> RegimeClassification:
        """Reclassify on a closed bar and return the published state.

        Called only on bar closes: a regime is a property of the market over a period, and
        recomputing it per tick would produce a signal that flickers faster than any
        strategy could act on.
        """
        instrument_id = instrument.instrument_id
        candidate, evidence = self._classify(instrument, snapshot)

        if candidate is self._candidate.get(instrument_id):
            self._confirm[instrument_id] = self._confirm.get(instrument_id, 0) + 1
        else:
            self._candidate[instrument_id] = candidate
            self._confirm[instrument_id] = 1

        published = self._published.get(instrument_id)
        confirmed = self._confirm[instrument_id] >= self._config.confirm_bars

        if candidate is Regime.UNKNOWN:
            # UNKNOWN is published immediately: losing confidence in the classification is
            # itself information, and holding a stale regime while the evidence has gone
            # would keep a strategy enabled on a state we can no longer see.
            regime = Regime.UNKNOWN
        elif confirmed:
            regime = candidate
        else:
            regime = published.regime if published else Regime.UNKNOWN

        if published is None or published.regime is not regime:
            _log.info(
                "regime_changed",
                instrument=instrument_id,
                previous=published.regime.value if published else None,
                regime=regime.value,
                confirm_count=self._confirm[instrument_id],
                **{k: round(v, 4) for k, v in evidence.items()},
            )

        result = RegimeClassification(
            regime=regime,
            ts=ts,
            candidate=candidate,
            confirm_count=self._confirm[instrument_id],
            evidence=evidence,
        )
        self._published[instrument_id] = result
        return result

    def _classify(
        self, instrument: Instrument, snapshot: FeatureSnapshot
    ) -> tuple[Regime, dict[str, float]]:
        """Apply the rules, returning the candidate regime and the evidence for it."""
        cfg = self._config
        evidence: dict[str, float] = {"bar_count": float(snapshot.bar_count)}

        if snapshot.bar_count < cfg.min_bars:
            return Regime.UNKNOWN, evidence

        required = ("atr", "last_close", "range_high", "range_low")
        if not snapshot.has(*required):
            return Regime.UNKNOWN, evidence
        atr, close, range_high, range_low = snapshot.require(*required)
        if atr <= 0:
            return Regime.UNKNOWN, evidence

        history = self._atr_history.setdefault(
            instrument.instrument_id, deque(maxlen=cfg.vol_lookback)
        )
        history.append(atr)
        median_atr = sorted(history)[len(history) // 2]
        vol_ratio = atr / median_atr if median_atr > 0 else 1.0
        evidence["atr"] = atr
        evidence["vol_ratio"] = vol_ratio

        # 1. Breakout: price has left the recent range by a meaningful multiple of ATR.
        breakout_distance = cfg.breakout_atr * atr
        if close > range_high + breakout_distance or close < range_low - breakout_distance:
            evidence["breakout_atr"] = (
                (close - range_high) / atr if close > range_high else (range_low - close) / atr
            )
            return Regime.BREAKOUT, evidence

        # 2. Trend: the moving averages have separated, and structure agrees.
        if snapshot.has("ema_fast", "ema_slow"):
            fast, slow = snapshot.require("ema_fast", "ema_slow")
            separation = (fast - slow) / atr
            evidence["ema_separation_atr"] = separation
            swing_trend = snapshot.get("swing_trend", 0.0) or 0.0
            evidence["swing_trend"] = swing_trend
            if separation >= cfg.trend_ema_separation_atr and swing_trend >= 0:
                return Regime.TRENDING_UP, evidence
            if separation <= -cfg.trend_ema_separation_atr and swing_trend <= 0:
                return Regime.TRENDING_DOWN, evidence

        # 3. Volatility extremes, before falling through to range.
        if vol_ratio >= cfg.high_vol_ratio:
            return Regime.HIGH_VOLATILITY, evidence
        if vol_ratio <= cfg.low_vol_ratio:
            return Regime.LOW_VOLATILITY, evidence

        # 4. Range: price contained within the recent band.
        band = range_high - range_low
        if band > 0:
            position = (close - range_low) / band
            evidence["range_position"] = position
            margin = (1.0 - cfg.range_containment) / 2.0
            if margin <= position <= 1.0 - margin:
                return Regime.RANGE, evidence

        return Regime.UNKNOWN, evidence

    def reset(self, instrument_id: str | None = None) -> None:
        """Clear state, for one instrument or all.

        Called between walk-forward windows: regime history that survived the boundary
        would carry information from the in-sample period into the out-of-sample test.
        """
        if instrument_id is None:
            self._atr_history.clear()
            self._candidate.clear()
            self._confirm.clear()
            self._published.clear()
            return
        self._atr_history.pop(instrument_id, None)
        self._candidate.pop(instrument_id, None)
        self._confirm.pop(instrument_id, None)
        self._published.pop(instrument_id, None)
