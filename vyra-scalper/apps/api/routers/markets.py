"""Instruments, sessions and strategies."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from apps.api.schemas import InstrumentResponse, StrategyResponse
from apps.api.security import Principal, Role, require_roles
from apps.api.state import get_state
from core.util.clock import now_ns, to_iso

router = APIRouter(tags=["markets"])


def _instrument_view(instrument_id: str, include_session: bool = True) -> InstrumentResponse:
    state = get_state()
    instrument = state.registry.get(instrument_id)
    is_open: bool | None = None
    if include_session:
        is_open = state.registry.calendar(instrument_id).is_open(now_ns())
    return InstrumentResponse(
        instrument_id=instrument.instrument_id,
        symbol=instrument.symbol,
        asset_class=instrument.asset_class.value,
        exchange=instrument.exchange,
        currency=instrument.currency,
        tick_size=instrument.tick_size,
        tick_value=instrument.tick_value,
        multiplier=instrument.multiplier,
        min_qty=instrument.min_qty,
        qty_step=instrument.qty_step,
        max_spread_ticks=instrument.max_spread_ticks,
        session_id=instrument.session_id,
        timezone=instrument.timezone,
        supports_exchange_depth=instrument.supports_exchange_depth,
        expiry=to_iso(instrument.expiry_ns) if instrument.expiry_ns else None,
        is_open=is_open,
    )


@router.get("/markets", response_model=list[InstrumentResponse])
async def list_markets(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    asset_class: str | None = None,
) -> list[InstrumentResponse]:
    state = get_state()
    views = [_instrument_view(iid) for iid in state.registry.ids()]
    if asset_class is not None:
        wanted = asset_class.upper()
        views = [v for v in views if v.asset_class == wanted]
    return views


@router.get("/markets/{instrument_id:path}", response_model=InstrumentResponse)
async def get_market(
    instrument_id: str,
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> InstrumentResponse:
    state = get_state()
    if instrument_id not in state.registry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown instrument {instrument_id!r}",
        )
    return _instrument_view(instrument_id)


@router.get("/strategies", response_model=list[StrategyResponse])
async def list_strategies(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> list[StrategyResponse]:
    """Every configured strategy.

    ``enabled`` and ``promoted`` are distinct and both are reported. A strategy can be
    enabled in configuration without having passed validation; nothing in this build has
    passed, so ``promoted`` is false for all of them.
    """
    state = get_state()
    section = state.bundle["strategies"].section("strategies")
    responses: list[StrategyResponse] = []
    for name in section:
        spec = section.section(name)
        responses.append(
            StrategyResponse(
                strategy_id=name,
                version=spec.str_("version", "0.0.0"),
                enabled=spec.bool_("enabled", False),
                instruments=[str(i) for i in spec.list_("instruments")],
                timeframe=spec.str_("timeframe", "1m"),
                allowed_regimes=[str(r) for r in spec.list_("allowed_regimes")],
                requires_exchange_depth=spec.bool_("requires_exchange_depth", False),
                params=dict(spec.section("params", required=False).data),
                promoted=False,
            )
        )
    return responses


@router.get("/sessions")
async def list_sessions(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> dict[str, Any]:
    """Session state per instrument, right now."""
    state = get_state()
    ts = now_ns()
    return {
        "as_of": to_iso(ts),
        "instruments": {
            iid: {
                "session_id": state.registry.get(iid).session_id,
                "is_open": state.registry.calendar(iid).is_open(ts),
                "state": state.registry.calendar(iid).session_state(ts).value,
                "trading_date": state.registry.calendar(iid).session_date(ts).isoformat(),
                "blocked_window": state.registry.is_blocked_window(iid, ts),
            }
            for iid in state.registry.ids()
        },
    }
