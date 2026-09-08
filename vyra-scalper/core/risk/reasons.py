"""Stable reason codes for risk decisions.

These strings are queried by analytics and stored in the audit log, so they are **never
reworded**.  A new condition gets a new code; an existing code keeps its meaning forever.
"""

from __future__ import annotations

__all__ = ["Reason", "ALL_REASONS"]


class Reason:
    """Namespace of reason-code constants (``RISK_SPEC.md`` §2)."""

    KILL_SWITCH_ACTIVE = "KILL_SWITCH_ACTIVE"
    MAX_RISK_PER_TRADE = "MAX_RISK_PER_TRADE"
    MAX_INSTRUMENT_EXPOSURE = "MAX_INSTRUMENT_EXPOSURE"
    MAX_PORTFOLIO_EXPOSURE = "MAX_PORTFOLIO_EXPOSURE"
    MAX_CORRELATED_EXPOSURE = "MAX_CORRELATED_EXPOSURE"
    MAX_DAILY_LOSS = "MAX_DAILY_LOSS"
    MAX_WEEKLY_LOSS = "MAX_WEEKLY_LOSS"
    MAX_DRAWDOWN = "MAX_DRAWDOWN"
    MAX_TRADES_PER_SESSION = "MAX_TRADES_PER_SESSION"
    MAX_CONSECUTIVE_LOSSES = "MAX_CONSECUTIVE_LOSSES"
    MAX_POSITION_SIZE = "MAX_POSITION_SIZE"
    MAX_LEVERAGE = "MAX_LEVERAGE"
    MIN_LIQUIDITY = "MIN_LIQUIDITY"
    MAX_SPREAD = "MAX_SPREAD"
    MAX_EXPECTED_SLIPPAGE = "MAX_EXPECTED_SLIPPAGE"
    VOLATILITY_LIMIT = "VOLATILITY_LIMIT"
    NEWS_BLACKOUT = "NEWS_BLACKOUT"
    SESSION_RESTRICTED = "SESSION_RESTRICTED"
    COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE"
    INVALID_STOP_DISTANCE = "INVALID_STOP_DISTANCE"
    STALE_MARKET_DATA = "STALE_MARKET_DATA"
    SIZE_ROUNDS_TO_ZERO = "SIZE_ROUNDS_TO_ZERO"
    DUPLICATE_SIGNAL = "DUPLICATE_SIGNAL"
    RISK_CHECK_ERROR = "RISK_CHECK_ERROR"
    REGIME_NOT_ALLOWED = "REGIME_NOT_ALLOWED"
    INSUFFICIENT_EQUITY = "INSUFFICIENT_EQUITY"
    APPROVED = "APPROVED"


ALL_REASONS: frozenset[str] = frozenset(
    value
    for name, value in vars(Reason).items()
    if not name.startswith("_") and isinstance(value, str)
)
