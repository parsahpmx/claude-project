"""Structural tests: a strategy cannot reach the broker, and risk cannot be bypassed.

These inspect the code itself rather than its behaviour. A behavioural test proves that
the current strategies do not bypass risk; these prove that a *future* strategy could not,
because the objects it can reach do not offer the capability.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from core.events import OrderType, Side, TimeInForce
from core.execution.order_manager import OrderManager
from core.risk.engine import RiskAction, RiskDecision
from core.signals.signal import Signal, SignalIntent
from core.strategies.base import BaseStrategy, StrategyContext
from core.util.clock import from_iso

REPO_ROOT = Path(__file__).resolve().parents[2]
STRATEGY_DIR = REPO_ROOT / "core" / "strategies"

FORBIDDEN_IMPORTS = (
    "core.brokers",
    "brokers.",
    "core.execution.engine",
    "core.execution.order_manager",
    "core.portfolio.portfolio",
)


def strategy_modules() -> list[Path]:
    return [p for p in STRATEGY_DIR.glob("*.py") if p.name != "__init__.py"]


class TestStrategyIsolation:
    @pytest.mark.parametrize("path", strategy_modules(), ids=lambda p: p.name)
    def test_no_strategy_imports_a_broker_or_execution_component(self, path: Path) -> None:
        """A strategy that cannot import a broker cannot call one."""
        tree = ast.parse(path.read_text())
        imported: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.append(node.module)

        offenders = [
            name
            for name in imported
            for forbidden in FORBIDDEN_IMPORTS
            if name.startswith(forbidden)
        ]
        assert not offenders, f"{path.name} imports execution machinery: {offenders}"

    def test_the_strategy_context_exposes_nothing_that_can_place_an_order(self) -> None:
        fields = set(StrategyContext.__dataclass_fields__)
        forbidden = {"broker", "order_manager", "execution", "portfolio", "risk_engine",
                     "account"}
        assert not (fields & forbidden), f"StrategyContext exposes {fields & forbidden}"

    def test_a_signal_cannot_express_a_position_size(self) -> None:
        """Sizing belongs to the risk engine; the type system enforces it."""
        fields = set(Signal.__dataclass_fields__)
        assert "quantity" not in fields
        assert "size" not in fields
        assert "position_size" not in fields
        assert "notional" not in fields

    def test_base_strategy_has_no_order_placing_method(self) -> None:
        methods = {name for name, _ in inspect.getmembers(BaseStrategy, inspect.isfunction)}
        forbidden = {"submit_order", "place_order", "cancel_order", "flatten", "buy", "sell"}
        assert not (methods & forbidden), f"BaseStrategy exposes {methods & forbidden}"


class TestRiskDecisionIsMandatory:
    def _signal(self) -> Signal:
        from core.signals.signal import EntryType

        return Signal(
            signal_id="s1", strategy_id="vwap", instrument_id="CME:MES",
            direction=Side.BUY, intent=SignalIntent.ENTER,
            ts=from_iso("2024-03-05T15:00:00Z"), entry_type=EntryType.MARKET,
            suggested_entry=5100.0, suggested_stop=5095.0,
        )

    def test_an_order_cannot_be_created_without_a_decision(self) -> None:
        """The signature requires one; there is no default."""
        parameters = inspect.signature(OrderManager.create).parameters
        assert "decision" in parameters
        assert parameters["decision"].default is inspect.Parameter.empty

    def test_a_rejected_decision_cannot_become_an_order(self) -> None:
        manager = OrderManager("run")
        rejected = RiskDecision(
            decision_id="d1", signal_id="s1", strategy_id="vwap", instrument_id="CME:MES",
            action=RiskAction.REJECT, requested_qty=10, approved_qty=0,
            reason_codes=("MAX_SPREAD",), binding_limit="MAX_SPREAD", equity=100_000.0,
            risk_amount=0.0, ts=1,
        )
        with pytest.raises(ValueError, match="cannot create an order from a REJECT"):
            manager.create(self._signal(), rejected, "CME", OrderType.MARKET, TimeInForce.DAY)

    def test_a_halt_decision_cannot_become_an_order(self) -> None:
        manager = OrderManager("run")
        halted = RiskDecision(
            decision_id="d2", signal_id="s1", strategy_id="vwap", instrument_id="CME:MES",
            action=RiskAction.HALT, requested_qty=10, approved_qty=0,
            reason_codes=("KILL_SWITCH_ACTIVE",), binding_limit=None, equity=100_000.0,
            risk_amount=0.0, ts=1,
        )
        with pytest.raises(ValueError, match="cannot create an order from a HALT"):
            manager.create(self._signal(), halted, "CME", OrderType.MARKET, TimeInForce.DAY)

    def test_a_decision_for_a_different_signal_is_refused(self) -> None:
        """Lineage must be exact: an order carries the verdict given for *its* signal."""
        manager = OrderManager("run")
        other = RiskDecision(
            decision_id="d3", signal_id="SOMETHING_ELSE", strategy_id="vwap",
            instrument_id="CME:MES", action=RiskAction.APPROVE, requested_qty=10,
            approved_qty=10, reason_codes=("APPROVED",), binding_limit=None,
            equity=100_000.0, risk_amount=250.0, ts=1,
        )
        with pytest.raises(ValueError, match="belongs to signal"):
            manager.create(self._signal(), other, "CME", OrderType.MARKET, TimeInForce.DAY)


class TestConfidenceCannotRaiseRisk:
    def test_confidence_is_bounded_at_construction(self) -> None:
        from core.signals.signal import EntryType, SignalError

        with pytest.raises(SignalError, match="confidence must be in"):
            Signal(
                signal_id="s", strategy_id="v", instrument_id="X", direction=Side.BUY,
                intent=SignalIntent.ENTER, ts=1, entry_type=EntryType.MARKET,
                suggested_entry=100.0, suggested_stop=95.0, confidence=1.5,
            )

    def test_sizing_clamps_the_confidence_multiplier_at_one(self, mes) -> None:
        from core.risk.sizing import compute_position_size

        baseline = compute_position_size(mes, 100_000.0, 0.0025, 5100.0, 5095.0)
        for confidence in (1.0, 10.0, 1e9):
            scaled = compute_position_size(
                mes, 100_000.0, 0.0025, 5100.0, 5095.0,
                confidence=confidence, confidence_floor=0.4,
            )
            assert scaled.quantity <= baseline.quantity
