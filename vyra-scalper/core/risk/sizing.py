"""Risk-based position sizing.

One pure, total function (``RISK_SPEC.md`` §4).  Given equity, a risk allowance and a
stop distance, it returns the largest legal quantity whose loss at the stop stays within
the allowance — or zero, with a named reason.

Division by zero is **structurally impossible** here: the stop distance is validated
against a configured minimum before it is ever used as a denominator.  That is a stronger
guarantee than a try/except, because it also rules out the near-zero distances that
produce an enormous but technically finite size.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.instruments.instrument import Instrument
from core.risk.reasons import Reason
from core.util.numeric import floor_to_step, is_finite

__all__ = ["SizingResult", "compute_position_size"]


@dataclass(frozen=True, slots=True)
class SizingResult:
    """The computed size and the arithmetic that produced it.

    Every field is recorded on the risk decision, so a position size can be re-derived
    from the audit log without re-running the engine.
    """

    quantity: float
    risk_amount: float
    risk_per_unit: float
    stop_ticks: float
    raw_quantity: float
    reason_codes: tuple[str, ...] = ()
    binding_limit: str | None = None

    @property
    def is_tradeable(self) -> bool:
        return self.quantity > 0

    @property
    def risk_at_stop(self) -> float:
        """Money lost if the stop is hit at exactly the stop price, before costs."""
        return self.quantity * self.risk_per_unit

    def to_dict(self) -> dict[str, object]:
        return {
            "quantity": self.quantity,
            "risk_amount": round(self.risk_amount, 6),
            "risk_per_unit": round(self.risk_per_unit, 6),
            "stop_ticks": round(self.stop_ticks, 6),
            "raw_quantity": round(self.raw_quantity, 6),
            "risk_at_stop": round(self.risk_at_stop, 6),
            "reason_codes": list(self.reason_codes),
            "binding_limit": self.binding_limit,
        }


def _rejected(reason: str, stop_ticks: float = 0.0, risk_amount: float = 0.0) -> SizingResult:
    return SizingResult(
        quantity=0.0,
        risk_amount=risk_amount,
        risk_per_unit=0.0,
        stop_ticks=stop_ticks,
        raw_quantity=0.0,
        reason_codes=(reason,),
        binding_limit=reason,
    )


def compute_position_size(
    instrument: Instrument,
    equity: float,
    risk_fraction: float,
    entry: float,
    stop: float,
    *,
    min_stop_distance_ticks: float = 2.0,
    max_position_size: float | None = None,
    confidence: float = 1.0,
    confidence_floor: float = 1.0,
) -> SizingResult:
    """Size a position from monetary risk.

    Args:
        instrument: supplies tick size, tick value and quantity constraints.
        equity: current account equity in the instrument's currency.
        risk_fraction: fraction of equity risked if the stop is hit, e.g. ``0.0025``.
        entry: intended entry price.
        stop: protective stop price.
        min_stop_distance_ticks: stops closer than this are refused.  Sizing divides by
            the stop distance, so a one-tick stop implies an enormous position; this floor
            is what makes that impossible rather than merely unlikely.
        max_position_size: hard cap from configuration, applied after the risk cap.
        confidence: signal confidence in [0, 1].
        confidence_floor: the smallest multiplier confidence may apply.  Confidence scales
            size **down only**; the multiplier is clamped to at most ``1.0`` so no
            confidence value can ever increase risk (``RISK_SPEC.md`` §6).

    Returns:
        A :class:`SizingResult`.  A zero quantity means *do not trade*, never *trade the
        minimum*: rounding up to reach ``min_qty`` would exceed the very budget the size
        was derived from.
    """
    if not all(is_finite(x) for x in (equity, risk_fraction, entry, stop, confidence)):
        return _rejected(Reason.INVALID_STOP_DISTANCE)
    if equity <= 0:
        return _rejected(Reason.INSUFFICIENT_EQUITY)
    if risk_fraction <= 0:
        return _rejected(Reason.MAX_RISK_PER_TRADE)
    if entry <= 0 or stop <= 0:
        return _rejected(Reason.INVALID_STOP_DISTANCE)

    stop_distance = abs(entry - stop)
    if stop_distance <= 0:
        return _rejected(Reason.INVALID_STOP_DISTANCE)

    stop_ticks = stop_distance / instrument.tick_size
    if stop_ticks < min_stop_distance_ticks:
        # Refused, never widened: silently moving the stop would change the trade the
        # strategy asked for into a different one with different economics.
        return _rejected(Reason.INVALID_STOP_DISTANCE, stop_ticks)

    risk_amount = equity * risk_fraction
    # Confidence may only reduce.  Clamped at 1.0 so a confidence above the floor cannot
    # scale risk upward even if a caller passes a value greater than one.
    multiplier = min(1.0, max(confidence_floor, confidence)) if confidence_floor < 1.0 else 1.0
    risk_amount *= multiplier

    risk_per_unit = stop_ticks * instrument.tick_value
    if risk_per_unit <= 0:
        # Unreachable given the instrument invariants, but a zero here would be a division
        # by zero one line below, so it is checked rather than assumed.
        return _rejected(Reason.INVALID_STOP_DISTANCE, stop_ticks, risk_amount)

    raw_quantity = risk_amount / risk_per_unit
    quantity = floor_to_step(raw_quantity, instrument.qty_step)
    reasons: list[str] = []
    binding: str | None = None

    if max_position_size is not None and quantity > max_position_size:
        quantity = floor_to_step(max_position_size, instrument.qty_step)
        reasons.append(Reason.MAX_POSITION_SIZE)
        binding = Reason.MAX_POSITION_SIZE

    if instrument.max_qty is not None and quantity > instrument.max_qty:
        quantity = floor_to_step(instrument.max_qty, instrument.qty_step)
        reasons.append(Reason.MAX_POSITION_SIZE)
        binding = Reason.MAX_POSITION_SIZE

    if quantity < instrument.min_qty:
        return SizingResult(
            quantity=0.0,
            risk_amount=risk_amount,
            risk_per_unit=risk_per_unit,
            stop_ticks=stop_ticks,
            raw_quantity=raw_quantity,
            reason_codes=(Reason.SIZE_ROUNDS_TO_ZERO,),
            binding_limit=Reason.SIZE_ROUNDS_TO_ZERO,
        )

    return SizingResult(
        quantity=quantity,
        risk_amount=risk_amount,
        risk_per_unit=risk_per_unit,
        stop_ticks=stop_ticks,
        raw_quantity=raw_quantity,
        reason_codes=tuple(reasons),
        binding_limit=binding,
    )
