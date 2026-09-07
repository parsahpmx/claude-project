"""Quantisation: prices land on ticks, quantities on steps, money on cents."""

from __future__ import annotations

import pytest

from core.util.numeric import (
    floor_to_step,
    is_finite,
    quantize_qty,
    require_finite,
    round_money,
    round_to_tick,
    safe_div,
    ticks_between,
)


class TestRoundToTick:
    @pytest.mark.parametrize(
        ("price", "tick", "expected"),
        [
            (4512.37, 0.25, 4512.25),
            (4512.38, 0.25, 4512.50),
            (2.675, 0.05, 2.70),  # the classic binary-representation trap
            (-4512.37, 0.25, -4512.25),
            (1.005, 0.01, 1.01),
            (5100.0, 0.25, 5100.0),
            (2345.678, 0.005, 2345.680),
        ],
    )
    def test_rounds_to_nearest_tick(self, price: float, tick: float, expected: float) -> None:
        assert round_to_tick(price, tick) == pytest.approx(expected, abs=1e-9)

    def test_result_is_always_an_exact_multiple(self) -> None:
        for i in range(500):
            price = 5100.0 + i * 0.0137
            rounded = round_to_tick(price, 0.25)
            assert abs(round(rounded / 0.25) - rounded / 0.25) < 1e-9

    @pytest.mark.parametrize("tick", [0.0, -0.25])
    def test_rejects_non_positive_tick(self, tick: float) -> None:
        with pytest.raises(ValueError, match="tick_size must be positive"):
            round_to_tick(100.0, tick)

    def test_rejects_non_finite_price(self) -> None:
        with pytest.raises(ValueError, match="must be finite"):
            round_to_tick(float("nan"), 0.25)


class TestQuantities:
    def test_floor_never_rounds_up(self) -> None:
        assert floor_to_step(3.999, 1.0) == 3.0
        assert floor_to_step(0.999, 1.0) == 0.0

    def test_below_minimum_yields_zero_not_the_minimum(self) -> None:
        """Rounding up to min_qty would silently exceed the risk budget."""
        assert quantize_qty(0.4, 1.0, 1.0) == 0.0
        assert quantize_qty(0.99, 1.0, 1.0) == 0.0

    def test_fractional_steps_for_cfd_lots(self) -> None:
        assert quantize_qty(7.678, 0.01, 0.01) == pytest.approx(7.67)
        assert quantize_qty(0.005, 0.01, 0.01) == 0.0

    def test_rejects_negative_quantity(self) -> None:
        with pytest.raises(ValueError, match="qty must be non-negative"):
            quantize_qty(-1.0, 1.0, 1.0)


class TestMoneyAndRatios:
    def test_money_rounds_half_away_from_zero(self) -> None:
        assert round_money(10.005) == 10.01
        assert round_money(-10.005) == -10.01
        assert round_money(0.1 + 0.2) == 0.30

    def test_ticks_between_is_signed(self) -> None:
        assert ticks_between(4500.0, 4512.5, 0.25) == 50.0
        assert ticks_between(4512.5, 4500.0, 0.25) == -50.0

    def test_safe_div_raises_without_an_explicit_default(self) -> None:
        """Sizing must fail loudly on a zero denominator, never produce a number."""
        with pytest.raises(ZeroDivisionError):
            safe_div(1.0, 0.0)

    def test_safe_div_returns_the_default_when_one_is_given(self) -> None:
        assert safe_div(1.0, 0.0, default=0.0) == 0.0


class TestFiniteness:
    @pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
    def test_non_finite_is_rejected(self, value: float) -> None:
        assert not is_finite(value)
        with pytest.raises(ValueError, match="price must be finite"):
            require_finite(value, "price")

    def test_bool_is_not_a_number_here(self) -> None:
        """``True`` is an int in Python; accepting it as a price hides a real bug."""
        assert not is_finite(True)
