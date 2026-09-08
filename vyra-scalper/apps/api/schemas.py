"""Response models.

Explicit schemas rather than raw dicts, so the OpenAPI document is accurate and a
dashboard can be generated against it. Every monetary field is named for whether it is
before or after costs — the distinction the whole platform exists to preserve should not
be lost at the API boundary.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

__all__ = [
    "HealthResponse",
    "InstrumentResponse",
    "KillSwitchResetRequest",
    "KillSwitchResponse",
    "KillSwitchTripRequest",
    "PerformanceResponse",
    "RiskLimitsResponse",
    "RunDetailResponse",
    "RunListResponse",
    "StrategyResponse",
    "SystemStatusResponse",
    "TokenResponse",
]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    expires_in_seconds: int


class HealthResponse(BaseModel):
    status: str = Field(description="ok, or degraded when the kill switch is tripped")
    uptime_seconds: float
    started_at: str
    config_hash: str
    instruments: int
    kill_switch: str
    runs_available: int


class InstrumentResponse(BaseModel):
    instrument_id: str
    symbol: str
    asset_class: str
    exchange: str
    currency: str
    tick_size: float
    tick_value: float
    multiplier: float
    min_qty: float
    qty_step: float
    max_spread_ticks: float
    session_id: str
    timezone: str
    supports_exchange_depth: bool = Field(
        description=(
            "False for broker CFD instruments. Their depth is one dealer's quoting, not "
            "centralised liquidity, and strategies requiring real depth are refused on them."
        )
    )
    expiry: str | None = None
    is_open: bool | None = None


class StrategyResponse(BaseModel):
    strategy_id: str
    version: str
    enabled: bool
    instruments: list[str]
    timeframe: str
    allowed_regimes: list[str]
    requires_exchange_depth: bool
    params: dict[str, Any]
    promoted: bool = Field(
        default=False,
        description=(
            "Whether the strategy has passed the validation pipeline. No strategy is "
            "promoted until it has; enabled is not the same thing."
        ),
    )


class RiskLimitsResponse(BaseModel):
    max_risk_per_trade_pct: float
    min_stop_distance_ticks: float
    max_daily_loss_pct: float
    max_weekly_loss_pct: float
    max_drawdown_pct: float
    max_consecutive_losses: int
    max_trades_per_session: int
    max_instrument_exposure_pct: float
    max_portfolio_exposure_pct: float
    max_correlated_exposure_pct: float
    max_leverage: float
    correlation_groups: dict[str, list[str]]


class KillSwitchResponse(BaseModel):
    state: str
    is_tripped: bool
    allows_new_entries: bool
    emergency_policy: str
    trigger: str | None = None
    detail: str | None = None
    tripped_at: str | None = None
    history_count: int = 0


class KillSwitchTripRequest(BaseModel):
    reason: str = Field(min_length=1, description="why trading is being halted")


class KillSwitchResetRequest(BaseModel):
    reason: str = Field(min_length=1, description="what was investigated and resolved")
    condition_cleared: bool = Field(
        description=(
            "The operator's assertion that the triggering condition no longer holds. "
            "Passing false refuses the reset."
        )
    )


class PerformanceResponse(BaseModel):
    run_id: str
    gross: dict[str, Any] = Field(description="metrics BEFORE transaction costs")
    net: dict[str, Any] = Field(description="metrics AFTER transaction costs")
    costs: dict[str, Any]
    survives_costs: bool
    implausibility_warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Result shapes that are far more often a bug than an edge: no losing trades, "
            "an implausible win rate or Sharpe, too few trades to measure."
        ),
    )
    pnl_by_instrument: dict[str, float] = Field(default_factory=dict)
    pnl_by_strategy: dict[str, float] = Field(default_factory=dict)
    pnl_by_regime: dict[str, float] = Field(default_factory=dict)


class RunListResponse(BaseModel):
    runs: list[dict[str, Any]]
    count: int


class RunDetailResponse(BaseModel):
    run_id: str
    manifest: dict[str, Any]
    metrics: dict[str, Any]
    warnings: list[str]


class SystemStatusResponse(BaseModel):
    health: HealthResponse
    kill_switch: KillSwitchResponse
    engine_version: str
    mode: str
    config_hash: str
    warnings: list[str] = Field(default_factory=list)
