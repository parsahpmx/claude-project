"""Numeric helpers for price, quantity and money quantisation.

The engine uses IEEE-754 doubles for prices and sizes (see ``ARCHITECTURE.md`` §5.2).
The hazard that choice creates — a value landing between two valid ticks, or a quantity
that is not a legal multiple of the venue's step — is contained here rather than left to
each call site.

Every function in this module is pure and total: given finite inputs it returns a value
or raises a named error; none of them silently coerce.
"""

from __future__ import annotations

import math
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

__all__ = [
    "MONEY_DP",
    "floor_to_step",
    "is_finite",
    "quantize_qty",
    "require_finite",
    "round_money",
    "round_to_tick",
    "safe_div",
    "ticks_between",
]

MONEY_DP = 2
"""Decimal places retained for monetary accounting boundaries."""


def is_finite(x: float) -> bool:
    """True when ``x`` is a real, finite number (not NaN, not +/-inf)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def require_finite(x: float, name: str) -> float:
    """Return ``x``, or raise :class:`ValueError` naming the offending field.

    Used at every boundary where a NaN would otherwise propagate silently — a NaN price
    compares false against every threshold, so it passes risk checks that a large price
    would fail.
    """
    if not is_finite(x):
        raise ValueError(f"{name} must be finite, got {x!r}")
    return float(x)


def _decimal_steps(value: float, step: float) -> Decimal:
    """``value / step`` computed in :class:`Decimal` from the shortest repr of each.

    ``round(2.675 / 0.05)`` and friends misbehave because the binary double nearest to
    ``2.675`` is slightly below it.  Going through ``Decimal(str(x))`` uses the shortest
    decimal string that round-trips the double, which is the number the venue and the
    config file actually meant.
    """
    return Decimal(str(value)) / Decimal(str(step))


def round_to_tick(price: float, tick_size: float) -> float:
    """Round ``price`` to the nearest multiple of ``tick_size``, halves away from zero.

    Args:
        price: price in instrument units.
        tick_size: minimum price increment; must be positive.

    Raises:
        ValueError: if either argument is non-finite, or ``tick_size <= 0``.

    Examples:
        >>> round_to_tick(4512.37, 0.25)
        4512.25
        >>> round_to_tick(2.675, 0.05)
        2.7
    """
    require_finite(price, "price")
    require_finite(tick_size, "tick_size")
    if tick_size <= 0:
        raise ValueError(f"tick_size must be positive, got {tick_size}")
    steps = _decimal_steps(price, tick_size)
    # Decimal's ROUND_HALF_UP is "half away from zero", so it is already symmetric about
    # zero; branching on the sign would make negative prices round half toward zero and
    # quietly disagree with positive ones.
    rounded = steps.to_integral_value(rounding=ROUND_HALF_UP)
    return float(rounded * Decimal(str(tick_size)))


def floor_to_step(value: float, step: float) -> float:
    """Round ``value`` **down** to a multiple of ``step`` (toward negative infinity).

    Position sizing always floors: rounding a quantity up to reach the next legal step
    would exceed the risk budget the size was derived from.

    Raises:
        ValueError: on non-finite input or ``step <= 0``.
    """
    require_finite(value, "value")
    require_finite(step, "step")
    if step <= 0:
        raise ValueError(f"step must be positive, got {step}")
    steps = _decimal_steps(value, step)
    return float(steps.to_integral_value(rounding=ROUND_FLOOR) * Decimal(str(step)))


def quantize_qty(qty: float, qty_step: float, min_qty: float) -> float:
    """Quantise an order quantity to the venue's step, flooring.

    Returns ``0.0`` when the floored quantity is below ``min_qty``.  The caller must treat
    zero as "do not send an order" — never as "send the minimum".

    Raises:
        ValueError: on non-finite input, ``qty_step <= 0``, negative ``qty`` or
            negative ``min_qty``.
    """
    require_finite(qty, "qty")
    require_finite(min_qty, "min_qty")
    if qty < 0:
        raise ValueError(f"qty must be non-negative, got {qty}")
    if min_qty < 0:
        raise ValueError(f"min_qty must be non-negative, got {min_qty}")
    stepped = floor_to_step(qty, qty_step)
    if stepped < min_qty:
        return 0.0
    return stepped


def round_money(amount: float, dp: int = MONEY_DP) -> float:
    """Round a monetary amount to ``dp`` decimal places, halves away from zero.

    Applied at accounting boundaries (realised PnL, commission, equity) so that reported
    money does not carry sub-cent binary residue.
    """
    require_finite(amount, "amount")
    quant = Decimal(1).scaleb(-dp)
    return float(Decimal(str(amount)).quantize(quant, rounding=ROUND_HALF_UP))


def ticks_between(a: float, b: float, tick_size: float) -> float:
    """Signed distance from ``a`` to ``b`` expressed in ticks.

    Raises:
        ValueError: on non-finite input or ``tick_size <= 0``.
    """
    require_finite(a, "a")
    require_finite(b, "b")
    if tick_size <= 0:
        raise ValueError(f"tick_size must be positive, got {tick_size}")
    return float(_decimal_steps(b - a, tick_size))


def safe_div(numerator: float, denominator: float, default: float | None = None) -> float:
    """Divide, returning ``default`` instead of raising when the denominator is zero.

    Args:
        default: value to return when ``denominator == 0``.  If ``None`` (the default),
            a :class:`ZeroDivisionError` is raised instead.

    The explicit ``default=None`` behaviour is deliberate: most divisions in this codebase
    (notably position sizing) *must* fail loudly on a zero denominator rather than
    produce a plausible-looking number.  ``safe_div`` is for the ratio metrics where a
    defined fallback genuinely exists, such as a win rate over zero trades.
    """
    require_finite(numerator, "numerator")
    require_finite(denominator, "denominator")
    if denominator == 0:
        if default is None:
            raise ZeroDivisionError("division by zero with no default provided")
        return default
    return numerator / denominator
