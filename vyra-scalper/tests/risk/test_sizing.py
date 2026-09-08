"""Position sizing: exact money risk, and no path to a division by zero."""

from __future__ import annotations

import pytest

from core.instruments.instrument import Instrument
from core.risk.reasons import Reason
from core.risk.sizing import compute_position_size

EQUITY = 100_000.0
RISK = 0.0025  # 0.25% -> $250 per trade


class TestExactRisk:
    """Every instrument must risk the same money for the same risk fraction."""

    def test_mes(self, mes: Instrument) -> None:
        # 5-point stop = 20 ticks x $1.25 = $25 per contract -> 10 contracts.
        result = compute_position_size(mes, EQUITY, RISK, 5100.0, 5095.0)
        assert result.quantity == 10.0
        assert result.risk_at_stop == pytest.approx(250.0)

    def test_es_is_one_tenth_of_mes(self, es: Instrument) -> None:
        result = compute_position_size(es, EQUITY, RISK, 5100.0, 5095.0)
        assert result.quantity == 1.0
        assert result.risk_at_stop == pytest.approx(250.0)

    def test_equity(self, aapl: Instrument) -> None:
        result = compute_position_size(aapl, EQUITY, RISK, 190.0, 188.0)
        assert result.quantity == 125.0
        assert result.risk_at_stop == pytest.approx(250.0)

    def test_cfd_fractional_lots(self, xauusd: Instrument) -> None:
        result = compute_position_size(xauusd, EQUITY, RISK, 2050.0, 2045.0)
        assert result.quantity == pytest.approx(0.5)
        assert result.risk_at_stop == pytest.approx(250.0)

    def test_risk_never_exceeds_the_budget_after_rounding(self, mes: Instrument) -> None:
        """Flooring means realised risk is at or below the budget, never above."""
        for stop_points in (1.25, 2.5, 3.75, 6.25, 7.5, 11.25):
            result = compute_position_size(mes, EQUITY, RISK, 5100.0, 5100.0 - stop_points)
            assert result.risk_at_stop <= EQUITY * RISK + 1e-9


class TestDivisionByZeroIsImpossible:
    @pytest.mark.parametrize("stop", [5100.0, 5099.75, 5100.24])
    def test_stops_at_or_inside_the_floor_are_refused(self, mes: Instrument, stop: float) -> None:
        result = compute_position_size(mes, EQUITY, RISK, 5100.0, stop, min_stop_distance_ticks=2)
        assert result.quantity == 0.0
        assert Reason.INVALID_STOP_DISTANCE in result.reason_codes

    def test_the_floor_is_never_silently_widened(self, mes: Instrument) -> None:
        """Moving the stop to make sizing work would change the trade requested."""
        result = compute_position_size(mes, EQUITY, RISK, 5100.0, 5099.75)
        assert result.quantity == 0.0
        assert result.stop_ticks == pytest.approx(1.0)  # reported, not adjusted

    @pytest.mark.parametrize("value", [float("nan"), float("inf")])
    def test_non_finite_inputs_are_refused(self, mes: Instrument, value: float) -> None:
        assert compute_position_size(mes, EQUITY, RISK, 5100.0, value).quantity == 0.0
        assert compute_position_size(mes, value, RISK, 5100.0, 5095.0).quantity == 0.0

    @pytest.mark.parametrize("equity", [0.0, -1000.0])
    def test_non_positive_equity(self, mes: Instrument, equity: float) -> None:
        result = compute_position_size(mes, equity, RISK, 5100.0, 5095.0)
        assert result.quantity == 0.0
        assert Reason.INSUFFICIENT_EQUITY in result.reason_codes


class TestRoundingBehaviour:
    def test_below_minimum_returns_zero_not_the_minimum(self, es: Instrument) -> None:
        """Rounding up to min_qty would exceed the budget the size came from."""
        result = compute_position_size(es, 10_000.0, RISK, 5100.0, 5000.0)
        assert result.quantity == 0.0
        assert Reason.SIZE_ROUNDS_TO_ZERO in result.reason_codes

    def test_max_position_size_caps_and_names_the_binding_limit(self, mes: Instrument) -> None:
        result = compute_position_size(mes, EQUITY, RISK, 5100.0, 5095.0, max_position_size=3)
        assert result.quantity == 3.0
        assert result.binding_limit == Reason.MAX_POSITION_SIZE

    def test_instrument_max_qty_also_caps(self, mes: Instrument) -> None:
        result = compute_position_size(mes, 10_000_000.0, RISK, 5100.0, 5095.0)
        assert result.quantity <= (mes.max_qty or float("inf"))


class TestConfidenceScaling:
    def test_confidence_scales_size_down(self, mes: Instrument) -> None:
        full = compute_position_size(mes, EQUITY, RISK, 5100.0, 5095.0)
        scaled = compute_position_size(
            mes, EQUITY, RISK, 5100.0, 5095.0, confidence=0.4, confidence_floor=0.4
        )
        assert scaled.quantity == 4.0
        assert scaled.quantity < full.quantity

    def test_confidence_can_never_increase_size(self, mes: Instrument) -> None:
        """Even a caller passing confidence above 1 cannot raise risk."""
        full = compute_position_size(mes, EQUITY, RISK, 5100.0, 5095.0)
        for confidence in (1.0, 2.0, 100.0):
            scaled = compute_position_size(
                mes, EQUITY, RISK, 5100.0, 5095.0,
                confidence=confidence, confidence_floor=0.4,
            )
            assert scaled.quantity <= full.quantity

    def test_floor_bounds_the_reduction(self, mes: Instrument) -> None:
        scaled = compute_position_size(
            mes, EQUITY, RISK, 5100.0, 5095.0, confidence=0.0, confidence_floor=0.5
        )
        assert scaled.quantity == 5.0
