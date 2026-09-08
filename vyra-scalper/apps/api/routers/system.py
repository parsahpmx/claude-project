"""Health, system status, configuration and the kill switch.

The kill switch endpoints are the most privileged in the service. Tripping needs an
operator; clearing needs an operator whose identity is recorded, because the switch's
value comes from the audit trail it produces, and an anonymous reset destroys that.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from apps.api.schemas import (
    HealthResponse,
    KillSwitchResetRequest,
    KillSwitchResponse,
    KillSwitchTripRequest,
    RiskLimitsResponse,
    SystemStatusResponse,
)
from apps.api.security import Principal, Role, require_roles
from apps.api.state import EngineState, get_state
from core.risk.kill_switch import Trigger
from core.util.clock import to_iso
from core.util.logging import get_logger

router = APIRouter(tags=["system"])
_log = get_logger("api.system")

ENGINE_VERSION = "0.1.0"


def _kill_switch_view(state: EngineState) -> KillSwitchResponse:
    switch = state.kill_switch
    record = switch.trip_record
    return KillSwitchResponse(
        state=switch.state.value,
        is_tripped=switch.is_tripped,
        allows_new_entries=switch.allows_new_entries(),
        emergency_policy=switch.emergency_policy.value,
        trigger=record.trigger.value if record else None,
        detail=record.detail if record else None,
        tripped_at=to_iso(record.ts) if record else None,
        history_count=len(switch.history),
    )


@router.get("/health", response_model=HealthResponse, summary="Liveness and readiness")
async def health() -> HealthResponse:
    """Unauthenticated on purpose: a load balancer cannot hold a token.

    It exposes no position, PnL or credential — only whether the service is up and whether
    trading is halted.
    """
    return HealthResponse(**get_state().health())


@router.get("/system/status", response_model=SystemStatusResponse)
async def system_status(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> SystemStatusResponse:
    state = get_state()
    warnings: list[str] = []
    if state.kill_switch.is_tripped:
        warnings.append(
            "TRADING HALTED: the kill switch is tripped and will not clear itself."
        )
    return SystemStatusResponse(
        health=HealthResponse(**state.health()),
        kill_switch=_kill_switch_view(state),
        engine_version=ENGINE_VERSION,
        mode="BACKTEST",
        config_hash=state.bundle.hash,
        warnings=warnings,
    )


@router.get("/config", summary="Configuration, with credentials removed")
async def get_config(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    section: str | None = None,
) -> dict[str, Any]:
    """Serve configuration.

    Credential-shaped fields and whole connection blocks are removed before the response
    is built, so no broker credential can reach a client whatever the caller's role.
    """
    state = get_state()
    if section is not None and section not in state.bundle.sections:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown config section {section!r}; "
            f"available: {sorted(state.bundle.sections)}",
        )
    return {"config_hash": state.bundle.hash, "config": state.safe_config(section)}


@router.get("/risk/limits", response_model=RiskLimitsResponse)
async def risk_limits(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> RiskLimitsResponse:
    limits = get_state().limits
    return RiskLimitsResponse(
        max_risk_per_trade_pct=limits.max_risk_per_trade_pct,
        min_stop_distance_ticks=limits.min_stop_distance_ticks,
        max_daily_loss_pct=limits.max_daily_loss_pct,
        max_weekly_loss_pct=limits.max_weekly_loss_pct,
        max_drawdown_pct=limits.max_drawdown_pct,
        max_consecutive_losses=limits.max_consecutive_losses,
        max_trades_per_session=limits.max_trades_per_session,
        max_instrument_exposure_pct=limits.max_instrument_exposure_pct,
        max_portfolio_exposure_pct=limits.max_portfolio_exposure_pct,
        max_correlated_exposure_pct=limits.max_correlated_exposure_pct,
        max_leverage=limits.max_leverage,
        correlation_groups={k: list(v) for k, v in limits.correlation_groups.items()},
    )


@router.get("/kill-switch", response_model=KillSwitchResponse)
async def kill_switch_status(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> KillSwitchResponse:
    return _kill_switch_view(get_state())


@router.post("/kill-switch/trip", response_model=KillSwitchResponse)
async def trip_kill_switch(
    request: KillSwitchTripRequest,
    principal: Annotated[Principal, Depends(require_roles(Role.OPERATOR))],
) -> KillSwitchResponse:
    """Halt trading immediately.

    Idempotent: tripping an already-tripped switch records the additional trigger but
    keeps the original cause, so an incident review can still identify what started it.
    """
    state = get_state()
    state.kill_switch.trip(
        Trigger.MANUAL,
        f"{request.reason} (operator: {principal.subject})",
        context={"operator": principal.subject, "via": "api"},
    )
    _log.critical(
        "kill_switch_tripped_via_api",
        operator=principal.subject,
        detail=request.reason,
        reason_codes=["KILL_SWITCH_ACTIVE"],
    )
    return _kill_switch_view(state)


@router.post("/kill-switch/reset", response_model=KillSwitchResponse)
async def reset_kill_switch(
    request: KillSwitchResetRequest,
    principal: Annotated[Principal, Depends(require_roles(Role.OPERATOR))],
) -> KillSwitchResponse:
    """Clear the switch. Operator action only, and recorded.

    The operator identity comes from the authenticated token, not from the request body:
    a caller must not be able to name someone else as the person who authorised a resume.
    """
    state = get_state()
    try:
        state.kill_switch.reset(
            operator=principal.subject,
            reason=request.reason,
            condition_cleared=request.condition_cleared,
        )
    except ValueError as exc:
        # The switch refuses resets that would be unsafe — too soon, condition still
        # present, or not tripped. That refusal is the feature, so it is surfaced as a
        # client error with the switch's own explanation.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc

    _log.warning(
        "kill_switch_reset_via_api",
        operator=principal.subject,
        reason=request.reason,
    )
    return _kill_switch_view(state)
