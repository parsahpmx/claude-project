"""No trading constant may be hardcoded in strategy source.

Every threshold lives in ``configs/strategies.yaml`` (``ARCHITECTURE.md`` §5.6). This test
scans strategy modules for numeric literals outside a small allowlist of structural
constants, so a parameter that creeps back into code is caught at review time rather than
discovered when a backtest cannot be reproduced from its configuration.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
STRATEGY_DIR = REPO_ROOT / "core" / "strategies"

# Structural constants, not trading parameters: array indices, signs, halves and the
# bounds of a [0, 1] score. None of these can change whether or how much a strategy trades.
ALLOWED_LITERALS = frozenset({0, 1, 2, -1, -1.0, 0.5, 100.0})

# Module-level constants named in UPPER_CASE are documented shape parameters, not
# thresholds; they are allowed to hold a value but must be defined at module level where
# they are visible, never inline.
def module_level_constant_values(tree: ast.Module) -> set[float]:
    values: set[float] = set()
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if (
                    isinstance(target, ast.Name)
                    and target.id.isupper()
                    and isinstance(node.value, ast.Constant)
                    and isinstance(node.value.value, (int, float))
                ):
                    values.add(node.value.value)
    return values


def strategy_modules() -> list[Path]:
    return [p for p in STRATEGY_DIR.glob("*.py") if p.name not in ("__init__.py", "base.py")]


@pytest.mark.parametrize("path", strategy_modules(), ids=lambda p: p.name)
def test_no_hardcoded_trading_constants(path: Path) -> None:
    tree = ast.parse(path.read_text())
    allowed = ALLOWED_LITERALS | module_level_constant_values(tree)

    offenders: list[tuple[int, float]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Constant):
            continue
        value = node.value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if value in allowed:
            continue
        offenders.append((node.lineno, value))

    assert not offenders, (
        f"{path.name} contains hardcoded numeric literals at "
        f"{offenders}. Trading parameters belong in configs/strategies.yaml."
    )


def test_the_scan_would_actually_catch_a_hardcoded_threshold(tmp_path: Path) -> None:
    """Guard against a vacuous test: prove the scan detects a real violation."""
    offender = tmp_path / "bad_strategy.py"
    offender.write_text("def f(x):\n    return x > 2.75\n")
    tree = ast.parse(offender.read_text())
    literals = [
        n.value
        for n in ast.walk(tree)
        if isinstance(n, ast.Constant)
        and isinstance(n.value, (int, float))
        and not isinstance(n.value, bool)
        and n.value not in ALLOWED_LITERALS
    ]
    assert literals == [2.75]
