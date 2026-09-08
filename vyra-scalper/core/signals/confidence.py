"""Signal confidence scoring.

Combines independent confirmations into a single score in [0, 1].  The score is advisory:
it may scale position size **down** inside an approved envelope, and it can never raise a
limit or bypass a check (``RISK_SPEC.md`` §6).

Components that cannot be evaluated (a feature is not ready, an instrument has no depth)
are *excluded* and the weights renormalise over what remains.  Scoring a missing
confirmation as zero would penalise a signal for the platform's warm-up state; scoring it
as neutral would invent evidence.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.util.numeric import is_finite

__all__ = ["ConfidenceComponent", "ConfidenceScore", "ConfidenceScorer"]


@dataclass(frozen=True, slots=True)
class ConfidenceComponent:
    """One scored confirmation."""

    name: str
    score: float
    weight: float

    def __post_init__(self) -> None:
        if not is_finite(self.score) or not 0.0 <= self.score <= 1.0:
            raise ValueError(f"component {self.name!r} score must be in [0, 1], got {self.score}")
        if self.weight < 0:
            raise ValueError(f"component {self.name!r} weight must be non-negative")


@dataclass(frozen=True, slots=True)
class ConfidenceScore:
    """The combined score and its inputs, kept together for auditability."""

    value: float
    components: tuple[ConfidenceComponent, ...] = ()
    excluded: tuple[str, ...] = field(default=())

    def to_dict(self) -> dict[str, object]:
        return {
            "confidence": round(self.value, 6),
            "components": {c.name: round(c.score, 6) for c in self.components},
            "weights": {c.name: c.weight for c in self.components},
            "excluded": list(self.excluded),
        }


class ConfidenceScorer:
    """Weighted combination of confirmations.

    Args:
        weights: component name to weight.  Names not present in a given scoring call are
            excluded rather than defaulted.
        min_confidence: below this, a signal should not be traded.  Enforced by the
            strategy or the risk engine, not here — this class only measures.
    """

    __slots__ = ("_min_confidence", "_weights")

    def __init__(self, weights: dict[str, float], min_confidence: float = 0.0) -> None:
        if not weights:
            raise ValueError("ConfidenceScorer requires at least one weighted component")
        bad = {k: v for k, v in weights.items() if v < 0}
        if bad:
            raise ValueError(f"negative confidence weights: {bad}")
        if not 0.0 <= min_confidence <= 1.0:
            raise ValueError(f"min_confidence must be in [0, 1], got {min_confidence}")
        self._weights = dict(weights)
        self._min_confidence = min_confidence

    @property
    def min_confidence(self) -> float:
        return self._min_confidence

    def score(self, observations: dict[str, float | None]) -> ConfidenceScore:
        """Combine ``observations`` (name → score in [0, 1], or ``None`` if unavailable).

        Raises:
            ValueError: for an unknown component name, or a score outside [0, 1].  A typo
                in a component name would otherwise silently drop a confirmation and
                shift the score without anyone noticing.
        """
        unknown = set(observations) - set(self._weights)
        if unknown:
            raise ValueError(
                f"unknown confidence components: {sorted(unknown)}; "
                f"configured: {sorted(self._weights)}"
            )

        components: list[ConfidenceComponent] = []
        excluded: list[str] = []
        for name, weight in self._weights.items():
            value = observations.get(name)
            if value is None:
                excluded.append(name)
                continue
            components.append(ConfidenceComponent(name, float(value), weight))

        total_weight = sum(c.weight for c in components)
        if total_weight <= 0:
            # Nothing could be evaluated.  Return zero rather than a neutral 0.5: no
            # evidence is not the same as balanced evidence.
            return ConfidenceScore(0.0, tuple(components), tuple(excluded))

        combined = sum(c.score * c.weight for c in components) / total_weight
        return ConfidenceScore(
            value=min(1.0, max(0.0, combined)),
            components=tuple(components),
            excluded=tuple(excluded),
        )

    @classmethod
    def from_config(cls, section: dict[str, object]) -> ConfidenceScorer:
        """Build from the ``confidence`` block of ``strategies.yaml``."""
        raw_weights = section.get("weights")
        if not isinstance(raw_weights, dict):
            raise ValueError("confidence config requires a 'weights' mapping")
        minimum = section.get("min_confidence_to_trade", 0.0)
        return cls(
            {str(k): float(v) for k, v in raw_weights.items()},
            float(minimum),  # type: ignore[arg-type]
        )
