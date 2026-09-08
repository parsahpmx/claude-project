"""Authentication and role-based access control.

Three rules, all of which the tests enforce:

1. **Broker credentials never leave the process.** No endpoint returns them, and the
   config serialiser strips anything credential-shaped before a response is built.
2. **The kill switch is the most privileged operation there is.** Tripping it needs only
   an operator; *clearing* it needs an operator identity that is recorded, because an
   anonymous reset defeats the audit trail the switch exists to produce.
3. **Read and write are separated.** A dashboard needs to see positions; it does not need
   to place orders.

Tokens are JWTs signed with a secret supplied through the environment. There is no default
secret: a service that starts with a hardcoded signing key is a service anyone can forge a
token for.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

__all__ = [
    "ALGORITHM",
    "Principal",
    "Role",
    "create_access_token",
    "current_principal",
    "require_roles",
    "resolve_secret",
]

ALGORITHM = "HS256"
_TOKEN_TTL_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)


class Role(StrEnum):
    """What a principal may do.

    Deliberately coarse. A permission model with thirty verbs is one nobody configures
    correctly, and the meaningful boundary here is between looking and acting.
    """

    VIEWER = "VIEWER"
    """Read market state, positions, performance and risk."""

    TRADER = "TRADER"
    """Everything a viewer can do, plus submitting and cancelling orders."""

    OPERATOR = "OPERATOR"
    """Everything a trader can do, plus tripping and resetting the kill switch."""

    ADMIN = "ADMIN"
    """Everything, plus configuration and user management."""

    @property
    def implied(self) -> frozenset[Role]:
        """Roles this one subsumes, so a check names the minimum rather than a list."""
        return _IMPLIED[self]

    def satisfies(self, required: Role) -> bool:
        return required is self or required in self.implied


_IMPLIED: dict[Role, frozenset[Role]] = {
    Role.VIEWER: frozenset(),
    Role.TRADER: frozenset({Role.VIEWER}),
    Role.OPERATOR: frozenset({Role.VIEWER, Role.TRADER}),
    Role.ADMIN: frozenset({Role.VIEWER, Role.TRADER, Role.OPERATOR}),
}


@dataclass(frozen=True, slots=True)
class Principal:
    """Who is making a request.

    ``subject`` is recorded on every privileged action — a kill-switch reset without an
    identity is a reset nobody is accountable for.
    """

    subject: str
    role: Role

    def can(self, required: Role) -> bool:
        return self.role.satisfies(required)


def resolve_secret() -> str:
    """The JWT signing secret, from ``VYRA_API_SECRET``.

    Raises:
        RuntimeError: when unset. There is deliberately no default: a service that starts
            with a hardcoded signing key is one whose tokens anyone can forge, and it would
            start silently.
    """
    secret = os.environ.get("VYRA_API_SECRET", "").strip()
    if not secret:
        raise RuntimeError(
            "VYRA_API_SECRET is not set. The API refuses to start with a default signing "
            "key, because tokens signed with a known secret can be forged by anyone."
        )
    if len(secret) < 32:
        raise RuntimeError(
            f"VYRA_API_SECRET is {len(secret)} characters; at least 32 are required for "
            "an HS256 signing key."
        )
    return secret


def create_access_token(
    subject: str, role: Role, ttl_minutes: int = _TOKEN_TTL_MINUTES
) -> str:
    """Mint a bearer token for ``subject``."""
    expires = datetime.now(UTC) + timedelta(minutes=ttl_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role.value,
        "exp": expires,
        "iat": datetime.now(UTC),
    }
    token: str = jwt.encode(payload, resolve_secret(), algorithm=ALGORITHM)
    return token


def _decode(token: str) -> Principal:
    try:
        payload = jwt.decode(token, resolve_secret(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    subject = payload.get("sub")
    # Stringified before the membership test: a token carrying an unhashable value in
    # ``role`` would otherwise raise a TypeError inside the check meant to reject it.
    raw_role = str(payload.get("role", ""))
    if not subject or raw_role not in Role.__members__:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token is missing a subject or carries an unknown role",
        )
    return Principal(subject=str(subject), role=Role(raw_role))


async def current_principal(
    token: Annotated[str | None, Depends(oauth2_scheme)],
) -> Principal:
    """Resolve the caller, or refuse the request."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode(token)


def require_roles(minimum: Role) -> Callable[..., Awaitable[Principal]]:
    """Dependency factory enforcing a minimum role.

    Named for the *minimum* rather than a set, so a new role slots into the hierarchy
    without every endpoint being revisited.
    """

    async def dependency(
        principal: Annotated[Principal, Depends(current_principal)],
    ) -> Principal:
        if not principal.can(minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"role {principal.role.value} cannot perform this action; "
                    f"{minimum.value} or higher is required"
                ),
            )
        return principal

    return dependency
