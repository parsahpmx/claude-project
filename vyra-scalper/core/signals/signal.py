"""The Signal — a strategy's only output.

A :class:`Signal` describes *what the strategy believes*, never *how much to trade*.
There is deliberately no ``quantity`` field: position sizing is the Risk Engine's
exclusive responsibility (``RISK_SPEC.md`` §4), and a strategy that cannot express a size
cannot accidentally override the risk budget.

Signals are validated at construction.  A stop on the wrong side of the entry, or a
non-finite price, is refused here rather than becoming an order that guarantees an
immediate loss.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from core.events import OrderType, Regime, Side
from core.util.clock import Nanos
from core.util.numeric import is_finite

__all__ = ["EntryType", "Signal", "SignalError", "SignalIntent"]


class SignalError(ValueError):
    """Raised when a strategy emits a structurally impossible signal.

    Also a kill-switch trigger (``IMPOSSIBLE_STRATEGY_VALUE``): a strategy producing
    nonsense is a strategy whose state is corrupt, and it should stop trading, not have
    its output quietly repaired.
    """


class SignalIntent(StrEnum):
    """What the signal asks the portfolio to do."""

    ENTER = "ENTER"
    EXIT = "EXIT"
    REVERSE = "REVERSE"
    SCALE_IN = "SCALE_IN"
    SCALE_OUT = "SCALE_OUT"


class EntryType(StrEnum):
    """How the strategy would like to be filled.

    A preference, not a command: the execution engine maps it onto an order type the venue
    actually supports, and may downgrade along a declared path.
    """

    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    MARKETABLE_LIMIT = "MARKETABLE_LIMIT"

    def to_order_type(self) -> OrderType:
        return {
            EntryType.MARKET: OrderType.MARKET,
            EntryType.LIMIT: OrderType.LIMIT,
            EntryType.STOP: OrderType.STOP,
            EntryType.MARKETABLE_LIMIT: OrderType.LIMIT,
        }[self]


@dataclass(frozen=True, slots=True)
class Signal:
    """A trading intention with no size attached.

    Attributes:
        confidence: in [0, 1].  May scale size *down* within an already-approved envelope
            and can never raise a limit (``RISK_SPEC.md`` §6).
        features: the feature values the decision was based on, captured for post-hoc
            analysis and for ML training sets.  Recording them at signal time is what
            makes later attribution possible without replaying the whole run.
        reason_codes: why this signal fired, in stable machine-readable form.
    """

    signal_id: str
    strategy_id: str
    instrument_id: str
    direction: Side
    intent: SignalIntent
    ts: Nanos
    entry_type: EntryType
    suggested_entry: float
    suggested_stop: float
    suggested_target: float | None = None
    confidence: float = 0.5
    regime: Regime = Regime.UNKNOWN
    features: dict[str, float] = field(default_factory=dict)
    reason_codes: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("suggested_entry", "suggested_stop"):
            value = getattr(self, name)
            if not is_finite(value):
                raise SignalError(f"{self.strategy_id}: {name} must be finite, got {value!r}")
            if value <= 0:
                raise SignalError(f"{self.strategy_id}: {name} must be positive, got {value}")
        if self.suggested_target is not None and not is_finite(self.suggested_target):
            raise SignalError(f"{self.strategy_id}: suggested_target must be finite or None")
        if not 0.0 <= self.confidence <= 1.0:
            raise SignalError(
                f"{self.strategy_id}: confidence must be in [0, 1], got {self.confidence}"
            )

        if self.intent in (SignalIntent.ENTER, SignalIntent.REVERSE, SignalIntent.SCALE_IN):
            self._validate_entry_geometry()

    def _validate_entry_geometry(self) -> None:
        """A stop must be on the losing side and a target on the winning side.

        An inverted stop is not a rounding problem: it is an order that converts the
        intended risk into an immediate exit, or into an unbounded one.
        """
        if self.direction is Side.BUY:
            if self.suggested_stop >= self.suggested_entry:
                raise SignalError(
                    f"{self.strategy_id}: long stop {self.suggested_stop} is not below "
                    f"entry {self.suggested_entry}"
                )
            if self.suggested_target is not None and self.suggested_target <= self.suggested_entry:
                raise SignalError(
                    f"{self.strategy_id}: long target {self.suggested_target} is not above "
                    f"entry {self.suggested_entry}"
                )
        else:
            if self.suggested_stop <= self.suggested_entry:
                raise SignalError(
                    f"{self.strategy_id}: short stop {self.suggested_stop} is not above "
                    f"entry {self.suggested_entry}"
                )
            if self.suggested_target is not None and self.suggested_target >= self.suggested_entry:
                raise SignalError(
                    f"{self.strategy_id}: short target {self.suggested_target} is not below "
                    f"entry {self.suggested_entry}"
                )

    @property
    def stop_distance(self) -> float:
        """Absolute distance from entry to stop, in price units."""
        return abs(self.suggested_entry - self.suggested_stop)

    @property
    def reward_risk(self) -> float | None:
        """Target distance divided by stop distance, or ``None`` without a target."""
        if self.suggested_target is None:
            return None
        risk = self.stop_distance
        if risk <= 0:
            return None
        return abs(self.suggested_target - self.suggested_entry) / risk

    @property
    def is_entry(self) -> bool:
        return self.intent in (SignalIntent.ENTER, SignalIntent.REVERSE, SignalIntent.SCALE_IN)

    def to_dict(self) -> dict[str, Any]:
        return {
            "signal_id": self.signal_id,
            "strategy_id": self.strategy_id,
            "instrument_id": self.instrument_id,
            "direction": self.direction.value,
            "intent": self.intent.value,
            "ts": self.ts,
            "entry_type": self.entry_type.value,
            "suggested_entry": self.suggested_entry,
            "suggested_stop": self.suggested_stop,
            "suggested_target": self.suggested_target,
            "stop_distance": self.stop_distance,
            "reward_risk": self.reward_risk,
            "confidence": self.confidence,
            "regime": self.regime.value,
            "reason_codes": list(self.reason_codes),
            "features": {k: round(v, 10) for k, v in sorted(self.features.items())},
        }
