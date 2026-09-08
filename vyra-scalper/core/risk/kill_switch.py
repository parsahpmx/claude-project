"""The kill switch.

A hard stop on trading with **no automatic recovery path** (``RISK_SPEC.md`` §5).  There
is no timeout that clears it, no config flag that enables auto-resume, and no code path
that calls :meth:`KillSwitch.reset` on the engine's behalf.  A tripped switch is cleared
only by a human operator, and the reset is refused while the triggering condition is still
true.

State is persisted, so a process that crashes and restarts comes back **tripped**.  A
crash loop must never look like a clean start.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from core.util.clock import NS_PER_SEC, Nanos, now_ns, to_iso
from core.util.logging import get_logger

__all__ = ["EmergencyPolicy", "KillSwitch", "KillSwitchState", "Trigger", "TripRecord"]

_log = get_logger("risk.kill_switch")


class Trigger(StrEnum):
    """Conditions that trip the switch."""

    DAILY_LOSS_EXCEEDED = "DAILY_LOSS_EXCEEDED"
    WEEKLY_LOSS_EXCEEDED = "WEEKLY_LOSS_EXCEEDED"
    DRAWDOWN_EXCEEDED = "DRAWDOWN_EXCEEDED"
    BROKER_DISCONNECTED = "BROKER_DISCONNECTED"
    MARKET_DATA_STALE = "MARKET_DATA_STALE"
    RECONCILIATION_FAILURE = "RECONCILIATION_FAILURE"
    UNKNOWN_POSITION = "UNKNOWN_POSITION"
    DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"
    RISK_SERVICE_UNAVAILABLE = "RISK_SERVICE_UNAVAILABLE"
    ABNORMAL_LATENCY = "ABNORMAL_LATENCY"
    ABNORMAL_SLIPPAGE = "ABNORMAL_SLIPPAGE"
    ORDER_REJECT_RATE = "ORDER_REJECT_RATE"
    IMPOSSIBLE_STRATEGY_VALUE = "IMPOSSIBLE_STRATEGY_VALUE"
    CLOCK_DESYNC = "CLOCK_DESYNC"
    MANUAL = "MANUAL"


class EmergencyPolicy(StrEnum):
    """What to do with open positions when the switch trips.

    ``HOLD`` is the default because flattening into the conditions that tripped the switch
    — a stale feed, a disconnected broker — can be worse than holding.  The right answer
    is operational, so it is configured rather than assumed.
    """

    HOLD = "HOLD"
    FLATTEN_ON_RECOVERY = "FLATTEN_ON_RECOVERY"
    FLATTEN_IMMEDIATELY = "FLATTEN_IMMEDIATELY"


class KillSwitchState(StrEnum):
    ARMED = "ARMED"
    TRIPPED = "TRIPPED"


@dataclass(frozen=True, slots=True)
class TripRecord:
    """An immutable record of one trip or reset."""

    ts: Nanos
    trigger: Trigger
    detail: str
    operator: str | None = None
    is_reset: bool = False
    context: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "ts_iso": to_iso(self.ts),
            "trigger": self.trigger.value,
            "detail": self.detail,
            "operator": self.operator,
            "is_reset": self.is_reset,
            "context": self.context,
        }


class KillSwitch:
    """Global trading halt.

    Args:
        emergency_policy: what happens to open positions on a trip.
        min_trip_seconds: minimum time the switch must remain tripped before a reset is
            accepted.  Prevents a reflexive reset that re-enters the same condition.
        state_file: where to persist state so a restart stays tripped.  ``None`` disables
            persistence, which is appropriate only for tests and backtests.
    """

    __slots__ = (
        "_emergency_policy",
        "_history",
        "_min_trip_ns",
        "_state",
        "_state_file",
        "_trip_record",
    )

    def __init__(
        self,
        emergency_policy: EmergencyPolicy = EmergencyPolicy.HOLD,
        min_trip_seconds: float = 60.0,
        state_file: str | Path | None = None,
    ) -> None:
        if min_trip_seconds < 0:
            raise ValueError("min_trip_seconds must be non-negative")
        self._emergency_policy = emergency_policy
        self._min_trip_ns = int(min_trip_seconds * NS_PER_SEC)
        self._state_file = Path(state_file) if state_file else None
        self._state = KillSwitchState.ARMED
        self._trip_record: TripRecord | None = None
        self._history: list[TripRecord] = []
        if self._state_file is not None:
            self._load()

    # -- state --------------------------------------------------------------------------

    @property
    def state(self) -> KillSwitchState:
        return self._state

    @property
    def is_tripped(self) -> bool:
        return self._state is KillSwitchState.TRIPPED

    @property
    def emergency_policy(self) -> EmergencyPolicy:
        return self._emergency_policy

    @property
    def trip_record(self) -> TripRecord | None:
        return self._trip_record

    @property
    def history(self) -> tuple[TripRecord, ...]:
        return tuple(self._history)

    def allows_new_entries(self) -> bool:
        """Entries are blocked whenever the switch is tripped, without exception."""
        return not self.is_tripped

    def allows_risk_reducing_exit(self) -> bool:
        """Exits that reduce risk stay permitted under the flattening policies.

        Under ``HOLD`` even exits are suppressed: the policy explicitly says do nothing,
        usually because the conditions that tripped the switch make execution unreliable.
        """
        if not self.is_tripped:
            return True
        return self._emergency_policy in (
            EmergencyPolicy.FLATTEN_IMMEDIATELY,
            EmergencyPolicy.FLATTEN_ON_RECOVERY,
        )

    def should_flatten_now(self) -> bool:
        return self.is_tripped and self._emergency_policy is EmergencyPolicy.FLATTEN_IMMEDIATELY

    # -- transitions --------------------------------------------------------------------

    def trip(
        self,
        trigger: Trigger,
        detail: str,
        ts: Nanos | None = None,
        context: dict[str, Any] | None = None,
    ) -> TripRecord:
        """Trip the switch.

        Idempotent: tripping an already-tripped switch records the additional trigger in
        history but keeps the original trip record, so the *first* cause remains
        identifiable during an incident review.
        """
        stamp = ts if ts is not None else now_ns()
        record = TripRecord(
            ts=stamp, trigger=trigger, detail=detail, context=dict(context or {})
        )
        self._history.append(record)

        if self._state is KillSwitchState.TRIPPED:
            _log.warning(
                "kill_switch_additional_trigger",
                trigger=trigger.value,
                detail=detail,
                original_trigger=self._trip_record.trigger.value if self._trip_record else None,
            )
            self._persist()
            return record

        self._state = KillSwitchState.TRIPPED
        self._trip_record = record
        _log.critical(
            "kill_switch_tripped",
            trigger=trigger.value,
            detail=detail,
            emergency_policy=self._emergency_policy.value,
            reason_codes=["KILL_SWITCH_ACTIVE"],
            **(context or {}),
        )
        self._persist()
        return record

    def reset(
        self,
        operator: str,
        reason: str,
        ts: Nanos | None = None,
        condition_cleared: bool = True,
    ) -> TripRecord:
        """Clear the switch.  Operator action only.

        Args:
            operator: identity of the person performing the reset.  Recorded in the audit
                trail; an anonymous reset is refused.
            reason: why the reset is being performed.
            condition_cleared: the operator's assertion that the triggering condition no
                longer holds.  Passing ``False`` refuses the reset.

        Raises:
            ValueError: if the switch is not tripped, the operator or reason is empty,
                the condition still holds, or the minimum trip duration has not elapsed.

        There is intentionally no ``force`` parameter.  Every automated recovery path this
        function could offer is one that would eventually resume trading into the
        condition that stopped it.
        """
        if self._state is not KillSwitchState.TRIPPED:
            raise ValueError("kill switch is not tripped; nothing to reset")
        if not operator.strip():
            raise ValueError("reset requires an operator identity for the audit trail")
        if not reason.strip():
            raise ValueError("reset requires a reason for the audit trail")
        if not condition_cleared:
            raise ValueError(
                "reset refused: the triggering condition has not been cleared. "
                "Resolve the condition first, then reset."
            )

        stamp = ts if ts is not None else now_ns()
        assert self._trip_record is not None
        elapsed = stamp - self._trip_record.ts
        if elapsed < self._min_trip_ns:
            raise ValueError(
                f"reset refused: switch has been tripped for {elapsed / NS_PER_SEC:.1f}s, "
                f"minimum is {self._min_trip_ns / NS_PER_SEC:.1f}s"
            )

        record = TripRecord(
            ts=stamp,
            trigger=self._trip_record.trigger,
            detail=reason,
            operator=operator,
            is_reset=True,
        )
        self._history.append(record)
        self._state = KillSwitchState.ARMED
        self._trip_record = None
        _log.warning(
            "kill_switch_reset",
            operator=operator,
            reason=reason,
            previous_trigger=record.trigger.value,
        )
        self._persist()
        return record

    # -- persistence --------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self._state.value,
            "emergency_policy": self._emergency_policy.value,
            "trip_record": self._trip_record.to_dict() if self._trip_record else None,
            "history": [r.to_dict() for r in self._history],
        }

    def _persist(self) -> None:
        """Write state to disk.

        A failure here is logged and re-raised: if the switch cannot record that it is
        tripped, a restart would come back armed, which is the one failure mode this
        persistence exists to prevent.
        """
        if self._state_file is None:
            return
        try:
            self._state_file.parent.mkdir(parents=True, exist_ok=True)
            temp = self._state_file.with_suffix(self._state_file.suffix + ".tmp")
            temp.write_text(json.dumps(self.to_dict(), indent=2))
            temp.replace(self._state_file)  # atomic: never a half-written state file
        except OSError:
            _log.exception("kill_switch_persist_failed", path=str(self._state_file))
            raise

    def _load(self) -> None:
        """Restore state from disk, defaulting to ARMED when no file exists."""
        assert self._state_file is not None
        if not self._state_file.is_file():
            return
        try:
            payload = json.loads(self._state_file.read_text())
        except (OSError, json.JSONDecodeError):
            # An unreadable state file is treated as TRIPPED, not as ARMED.  The safe
            # interpretation of "I do not know whether I was halted" is "I was halted".
            _log.exception("kill_switch_state_unreadable", path=str(self._state_file))
            self._state = KillSwitchState.TRIPPED
            self._trip_record = TripRecord(
                ts=now_ns(),
                trigger=Trigger.RISK_SERVICE_UNAVAILABLE,
                detail=f"kill switch state file {self._state_file} is unreadable",
            )
            return

        self._state = KillSwitchState(payload.get("state", KillSwitchState.ARMED.value))
        # Restore the full history, not just the current state: the next _persist would
        # otherwise write back only this process's records and truncate the audit trail
        # of every prior trip.
        self._history = [
            TripRecord(
                ts=int(entry["ts"]),
                trigger=Trigger(entry["trigger"]),
                detail=str(entry.get("detail", "")),
                operator=entry.get("operator"),
                is_reset=bool(entry.get("is_reset", False)),
                context=dict(entry.get("context", {})),
            )
            for entry in payload.get("history", [])
        ]
        record = payload.get("trip_record")
        if record:
            self._trip_record = TripRecord(
                ts=int(record["ts"]),
                trigger=Trigger(record["trigger"]),
                detail=str(record.get("detail", "")),
                operator=record.get("operator"),
                is_reset=bool(record.get("is_reset", False)),
                context=dict(record.get("context", {})),
            )
        if self._state is KillSwitchState.TRIPPED:
            _log.critical(
                "kill_switch_restored_tripped",
                trigger=self._trip_record.trigger.value if self._trip_record else "UNKNOWN",
                detail="process restarted while the kill switch was tripped",
            )
