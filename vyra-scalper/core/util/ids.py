"""Deterministic identifier generation.

Two properties matter for a trading system:

* **Monotonicity** — ids sort in creation order, so a ledger sorted by id is a timeline.
* **Determinism** — a replay of the same run produces the same ids, which is what makes
  a backtest result hash stable (``BACKTEST_SPEC.md`` §7).

Both are provided by :class:`IdGenerator`, a per-run counter.  Random uuid4s are
deliberately not used in the engine path: they break replay equality.
"""

from __future__ import annotations

import hashlib
import itertools
import os
import threading

__all__ = ["IdGenerator", "canonicalize", "client_order_id", "content_hash", "run_id"]


class IdGenerator:
    """Monotonic, deterministic id source scoped to one run.

    Ids have the form ``{prefix}-{run_token}-{counter:08d}``.  The counter is shared
    across prefixes so that ids are globally ordered within the run.

    Thread-safe: the live engine is single-threaded on the event path, but ids are also
    minted by reconciliation and health threads.
    """

    __slots__ = ("_counter", "_lock", "_run_token")

    def __init__(self, run_token: str) -> None:
        if not run_token:
            raise ValueError("run_token must be a non-empty string")
        self._run_token = run_token
        self._counter = itertools.count(1)
        self._lock = threading.Lock()

    @property
    def run_token(self) -> str:
        return self._run_token

    def next(self, prefix: str) -> str:
        """Mint the next id with the given prefix (e.g. ``ord``, ``sig``, ``fill``)."""
        with self._lock:
            n = next(self._counter)
        return f"{prefix}-{self._run_token}-{n:08d}"

    def peek(self) -> int:
        """Current counter value without consuming one (for diagnostics)."""
        with self._lock:
            value = next(self._counter)
            self._counter = itertools.count(value)
        return value


def run_id(seed: str | None = None) -> str:
    """Create a run identifier.

    Args:
        seed: when provided, the id is a deterministic function of it, so a replay names
            its run identically to the original.  When ``None``, 8 random bytes are used
            — appropriate for live sessions, which are not replays of anything.
    """
    if seed is not None:
        return hashlib.sha256(seed.encode()).hexdigest()[:16]
    return os.urandom(8).hex()


def client_order_id(
    run_token: str, strategy_id: str, instrument_id: str, signal_id: str, attempt: int
) -> str:
    """Deterministic broker-facing idempotency key.

    Retrying the *same* attempt reproduces the same key, so a broker that deduplicates on
    client order id will not open a second position when our first submission timed out
    but actually arrived (``EXECUTION_SPEC.md`` §4).  Incrementing ``attempt`` is an
    explicit decision to place a genuinely new order.

    The result is truncated to 32 characters, which every supported venue accepts.
    """
    if attempt < 0:
        raise ValueError(f"attempt must be non-negative, got {attempt}")
    payload = f"{run_token}|{strategy_id}|{instrument_id}|{signal_id}|{attempt}"
    return "v" + hashlib.sha256(payload.encode()).hexdigest()[:31]


def canonicalize(payload: object) -> object:
    """Convert ``payload`` into a JSON-encodable structure with string keys.

    YAML yields :class:`datetime.date` keys for bare dates (a holiday calendar keyed by
    date, for instance), and tuples for anything the loader normalises.  ``json.dumps``
    rejects non-string keys outright — ``default=`` only covers values — so keys are
    stringified here rather than at each call site.

    Collapsing ``date(2024, 12, 24)`` and the string ``"2024-12-24"`` to the same key is
    intentional: YAML would have produced the same configuration either way, so they
    should hash identically.
    """
    if isinstance(payload, dict):
        return {str(k): canonicalize(v) for k, v in sorted(payload.items(), key=lambda kv: str(kv[0]))}
    if isinstance(payload, (list, tuple)):
        return [canonicalize(v) for v in payload]
    if isinstance(payload, (str, int, float, bool)) or payload is None:
        return payload
    return str(payload)


def content_hash(payload: object) -> str:
    """SHA-256 over a canonical JSON encoding of ``payload``.

    Used for config hashes, dataset hashes and result hashes.  Keys are sorted and
    separators are fixed so that two logically identical structures hash identically
    regardless of construction order.
    """
    import json

    encoded = json.dumps(canonicalize(payload), sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(encoded.encode()).hexdigest()
