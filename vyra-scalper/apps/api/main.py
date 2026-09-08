"""The VYRA API service.

A read-mostly window onto the engine, plus the kill switch. Three properties hold
regardless of which endpoint is called:

* **No broker credential can be returned.** Credential-shaped fields and whole connection
  blocks are removed before any config response is built.
* **Every endpoint except health requires a token**, and every privileged one requires a
  role above viewer.
* **The API does not compute trading state.** It reads what the engine decided. An API
  that could mutate risk state would be a second path into the risk engine, and the
  platform's central guarantee is that there is only one.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm

from apps.api.routers import markets, runs, system
from apps.api.schemas import TokenResponse
from apps.api.security import Role, create_access_token, resolve_secret
from apps.api.state import EngineState, set_state
from core.util.logging import configure_logging, get_logger

__all__ = ["create_app"]

_log = get_logger("api.main")

REPO_ROOT = Path(__file__).resolve().parents[2]
_TOKEN_TTL_MINUTES = 60


def _configured_users() -> dict[str, tuple[str, Role]]:
    """Users from ``VYRA_API_USERS``, formatted ``name:password:ROLE,...``.

    There is deliberately no default user. A service that ships with a known account is
    one anybody can log into, and it would start silently — the same reason the signing
    secret has no default.

    Passwords arrive from the deployment's secret manager and are compared in constant
    time, but they are compared *as given*: this is an environment-supplied operator list,
    not a user store. A hashed store with rotation and lockout belongs with the persistence
    layer, and is tracked as a gap rather than half-built here.
    """
    raw = os.environ.get("VYRA_API_USERS", "").strip()
    if not raw:
        return {}
    users: dict[str, tuple[str, Role]] = {}
    for entry in raw.split(","):
        parts = entry.strip().split(":")
        if len(parts) != 3:
            raise RuntimeError(
                f"VYRA_API_USERS entry {entry!r} is malformed; expected name:password:ROLE"
            )
        name, password, role = parts
        if not name.strip() or not password:
            # An empty password would otherwise authenticate: comparing "" against "" in
            # constant time succeeds, so a blank field in the environment would open the
            # account rather than disable it.
            raise RuntimeError(
                f"VYRA_API_USERS entry {entry!r} has an empty name or password; "
                "remove the entry rather than leaving it blank"
            )
        if role not in Role.__members__:
            raise RuntimeError(
                f"VYRA_API_USERS entry {name!r} has unknown role {role!r}; "
                f"expected one of {sorted(Role.__members__)}"
            )
        users[name] = (password, Role(role))
    return users


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Validate the environment before serving a single request.

    Both checks fail startup rather than the first request: a service that accepts traffic
    and then refuses every call is harder to diagnose than one that never came up.
    """
    resolve_secret()
    _configured_users()
    config_dir = Path(os.environ.get("VYRA_CONFIG_DIR", REPO_ROOT / "configs"))
    runs_dir = Path(os.environ.get("VYRA_RUNS_DIR", REPO_ROOT / "runs"))
    # Kept separate so a deployment can mount the runs directory read-only; see EngineState.
    state_dir = Path(os.environ.get("VYRA_STATE_DIR", runs_dir))
    set_state(EngineState(config_dir=config_dir, runs_dir=runs_dir, state_dir=state_dir))
    _log.info(
        "api_started",
        config_dir=str(config_dir),
        runs_dir=str(runs_dir),
        state_dir=str(state_dir),
    )
    yield
    _log.info("api_stopped")


def create_app(state: EngineState | None = None) -> FastAPI:
    """Build the application.

    Args:
        state: inject a pre-built state, used by tests to avoid touching the real runs
            directory. When given, the lifespan validation still runs so the tests
            exercise the same startup checks production does.
    """
    app = FastAPI(
        title="VYRA Scalper Engine API",
        version="0.1.0",
        description=(
            "Read-mostly access to the trading engine, plus the kill switch.\n\n"
            "Every performance figure is reported **before and after transaction costs**. "
            "A strategy being `enabled` is not the same as being `promoted`: promotion "
            "requires passing the validation pipeline, and nothing has."
        ),
        lifespan=_lifespan if state is None else None,
    )

    if state is not None:
        set_state(state)

    origins = [
        o.strip()
        for o in os.environ.get("VYRA_CORS_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.post("/auth/token", response_model=TokenResponse, tags=["auth"])
    async def login(
        form: Annotated[OAuth2PasswordRequestForm, Depends()],
    ) -> TokenResponse:
        """Exchange credentials for a bearer token.

        Passwords are compared in constant time. The failure message does not distinguish
        an unknown user from a wrong password, so the endpoint cannot be used to enumerate
        accounts.
        """
        import hmac

        users = _configured_users()
        entry = users.get(form.username)
        expected = entry[0] if entry else ""
        # Compared even when the user is unknown, so the response time does not reveal
        # whether the account exists.
        matched = hmac.compare_digest(expected, form.password) and entry is not None
        if not matched:
            _log.warning("auth_failed", subject=form.username)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        assert entry is not None
        role = entry[1]
        _log.info("auth_succeeded", subject=form.username, role=role.value)
        return TokenResponse(
            access_token=create_access_token(form.username, role, _TOKEN_TTL_MINUTES),
            role=role.value,
            expires_in_seconds=int(timedelta(minutes=_TOKEN_TTL_MINUTES).total_seconds()),
        )

    app.include_router(system.router)
    app.include_router(markets.router)
    app.include_router(runs.router)

    @app.get("/", tags=["system"])
    async def root() -> dict[str, Any]:
        return {
            "service": "vyra-scalper-api",
            "version": "0.1.0",
            "docs": "/docs",
            "openapi": "/openapi.json",
        }

    return app


configure_logging(os.environ.get("VYRA_LOG_LEVEL", "INFO"))
app = create_app()
