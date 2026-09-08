"""What must never leave the process, in one place.

There are now three boundaries where credentials could escape — the config endpoint, feed
and broker diagnostics, and metric labels — and they were going to end up with three
slightly different ideas of what a credential looks like. The one that was missing an entry
would be the one that leaked.

The list is names, not values. A secret cannot be recognised by looking at it: a token and a
symbol are both strings. What can be recognised is the *field* that conventionally holds
one, so the rule is applied to keys and the value never has to be inspected.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "CREDENTIAL_BLOCKS",
    "CREDENTIAL_HINTS",
    "is_credential_name",
    "strip_credentials",
]

# Field names that must never appear in anything leaving the process.
#
# A bare ``account`` is deliberately absent: ``risk.yaml`` has an ``account`` block holding
# starting equity and currency, which the risk dashboard needs and which identifies nobody.
# A broker *account identifier* is matched by ``account_id``/``account_number``, and every
# one in the shipped configuration also sits inside a connection block, which goes wholesale.
CREDENTIAL_HINTS: tuple[str, ...] = (
    "password", "passwd", "secret", "token", "api_key", "apikey", "access_key",
    "private_key", "credential", "authorization", "account_id", "account_number",
    "accountid", "login", "username", "user_id", "client_id", "clientid",
    "passphrase", "session_id", "signing", "dsn", "connection_string",
)

# Whole blocks removed regardless of their contents. A connection block exists to hold the
# details of reaching a venue; enumerating which individual fields are sensitive is a list
# that will eventually be incomplete — ``client_id`` was missing from the hints above until
# a test caught it.
CREDENTIAL_BLOCKS: tuple[str, ...] = ("connection", "credentials", "auth")


def is_credential_name(name: str) -> bool:
    """Whether a field or label name is one that conventionally holds a credential."""
    lowered = str(name).lower()
    return lowered in CREDENTIAL_BLOCKS or any(hint in lowered for hint in CREDENTIAL_HINTS)


def strip_credentials(payload: Any) -> Any:
    """Remove anything credential-shaped from a structure bound for outside the process.

    Removes the key rather than masking its value: a masked key still tells an attacker
    what to look for and where it is configured.
    """
    if isinstance(payload, dict):
        # Keys are stringified before matching: YAML yields datetime.date keys for a
        # holiday calendar, and calling .lower() on one raises.
        return {
            key: strip_credentials(value)
            for key, value in payload.items()
            if not is_credential_name(str(key))
        }
    if isinstance(payload, list):
        return [strip_credentials(item) for item in payload]
    return payload
