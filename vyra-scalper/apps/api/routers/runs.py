"""Backtests, performance and validation results.

Everything served here is a *completed* run read from disk. The API does not start
backtests: a long-running compute job triggered by an HTTP request is a job whose failure
nobody sees, and the runner already has a CLI that reports properly.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from apps.api.schemas import (
    PerformanceResponse,
    RunDetailResponse,
    RunListResponse,
)
from apps.api.security import Principal, Role, require_roles
from apps.api.state import get_state

router = APIRouter(tags=["runs"])

# Bounded because a tick-rate equity curve is millions of rows and an endpoint that
# returns all of them takes the service down.
_MAX_ROWS = 5_000
_DEFAULT_ROWS = 500


@router.get("/backtests", response_model=RunListResponse)
async def list_backtests(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> RunListResponse:
    state = get_state()
    runs = []
    for index, run in enumerate(state.iter_runs()):
        if index >= limit:
            break
        runs.append(run.to_dict(include_metrics=False))
    return RunListResponse(runs=runs, count=len(runs))


@router.get("/backtests/{run_id}", response_model=RunDetailResponse)
async def get_backtest(
    run_id: str,
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> RunDetailResponse:
    run = get_state().get_run(run_id)
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"unknown run {run_id!r}"
        )
    return RunDetailResponse(
        run_id=run.run_id,
        manifest=run.manifest,
        metrics=run.metrics,
        warnings=run.warnings,
    )


@router.get("/backtests/{run_id}/performance", response_model=PerformanceResponse)
async def get_performance(
    run_id: str,
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> PerformanceResponse:
    """Performance before and after costs, side by side.

    The two are returned as separate objects rather than one merged view, so a client
    cannot render the gross figure by accident.
    """
    run = get_state().get_run(run_id)
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"unknown run {run_id!r}"
        )
    metrics = run.metrics
    return PerformanceResponse(
        run_id=run.run_id,
        gross=metrics.get("gross", {}),
        net=metrics.get("net", {}),
        costs=metrics.get("costs", {}),
        survives_costs=bool(metrics.get("survives_costs", False)),
        implausibility_warnings=list(metrics.get("implausibility_warnings", [])),
        pnl_by_instrument=metrics.get("pnl_by_instrument", {}),
        pnl_by_strategy=metrics.get("pnl_by_strategy", {}),
        pnl_by_regime=metrics.get("pnl_by_regime", {}),
    )


@router.get("/backtests/{run_id}/equity")
async def get_equity_curve(
    run_id: str,
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    limit: Annotated[int, Query(ge=1, le=_MAX_ROWS)] = _DEFAULT_ROWS,
) -> dict[str, Any]:
    """The equity curve, sampled evenly across the run.

    Sampled rather than truncated: the first 500 points of a 410,000-point curve are all at
    the opening balance, so a client drawing the head of the file would render a flat line
    for a run that made and lost money. ``total`` is returned so the client can say what
    fraction it is drawing.
    """
    rows, total = get_state().read_run_rows(run_id, "equity.jsonl", limit, sample=True)
    return {
        "run_id": run_id,
        "points": rows,
        "count": len(rows),
        "total": total,
        "limit": limit,
        "sampled": True,
    }


@router.get("/trades")
async def list_trades(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    run_id: str,
    limit: Annotated[int, Query(ge=1, le=_MAX_ROWS)] = _DEFAULT_ROWS,
) -> dict[str, Any]:
    """The trade ledger for a run.

    Each row carries gross and net PnL and the fees between them, so the cost of a trade
    is visible without a second request.
    """
    rows, total = get_state().read_run_rows(run_id, "trades.jsonl", limit)
    return {
        "run_id": run_id,
        "trades": rows,
        "count": len(rows),
        "total": total,
        "limit": limit,
    }


@router.get("/orders")
async def list_orders(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    run_id: str,
    limit: Annotated[int, Query(ge=1, le=_MAX_ROWS)] = _DEFAULT_ROWS,
) -> dict[str, Any]:
    rows, total = get_state().read_run_rows(run_id, "orders.jsonl", limit)
    return {
        "run_id": run_id,
        "orders": rows,
        "count": len(rows),
        "total": total,
        "limit": limit,
    }


@router.get("/fills")
async def list_fills(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    run_id: str,
    limit: Annotated[int, Query(ge=1, le=_MAX_ROWS)] = _DEFAULT_ROWS,
) -> dict[str, Any]:
    rows, total = get_state().read_run_rows(run_id, "fills.jsonl", limit)
    return {
        "run_id": run_id,
        "fills": rows,
        "count": len(rows),
        "total": total,
        "limit": limit,
    }


@router.get("/signals")
async def list_signals(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
    run_id: str,
    limit: Annotated[int, Query(ge=1, le=_MAX_ROWS)] = _DEFAULT_ROWS,
) -> dict[str, Any]:
    """Risk decisions for a run.

    Every decision is recorded, approvals included: a trail containing only refusals
    cannot demonstrate that a limit was evaluated.
    """
    rows, total = get_state().read_run_rows(run_id, "risk_events.jsonl", limit)
    return {
        "run_id": run_id,
        "decisions": rows,
        "count": len(rows),
        "total": total,
        "limit": limit,
    }


@router.get("/positions")
async def list_positions(
    _: Annotated[Principal, Depends(require_roles(Role.VIEWER))],
) -> dict[str, Any]:
    """Open positions.

    Empty in this build: no live trader is running, and inventing a position from the last
    backtest would show a holding that does not exist.
    """
    return {
        "positions": [],
        "count": 0,
        "note": (
            "No live trader is attached. Positions appear here once paper or live trading "
            "is running; a backtest's final position is not a held position."
        ),
    }
