"""The promotion decision, recorded.

Promotion is the only action in the platform that lets a strategy spend real money, so it is
the one that most needs an answer to "who decided this, when, and on what evidence". The
ledger is append-only: a promotion is not edited into a demotion, it is followed by a
separate demotion record.

**Promotion is keyed by strategy id, version *and* config hash.** A strategy whose
parameters changed is not the strategy that was promoted, however similar. That is not
bureaucracy: the parameters are the strategy, and the evidence was gathered about a
particular set of them.

**It is separate from the kill switch, in both directions.** Promoting does not clear a
halt; a halt does not demote. They answer different questions — *may this strategy trade at
all* versus *may anything trade right now* — and a mechanism that conflated them would let a
halt quietly undo a decision a human made, or a promotion quietly undo a halt.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.util.clock import Nanos, now_ns, to_iso
from core.util.logging import get_logger

__all__ = ["PromotionLedger", "PromotionRecord", "PromotionState"]

_log = get_logger("promotion.ledger")

# Service accounts are refused. An approval attributed to automation is an approval nobody
# made, and the entire purpose of this record is that somebody made it.
_FORBIDDEN_APPROVERS = frozenset(
    {"", "system", "automation", "service", "ci", "bot", "root", "admin", "unknown"}
)


@dataclass(frozen=True, slots=True)
class PromotionRecord:
    """One decision. Never modified."""

    strategy_id: str
    strategy_version: str
    config_hash: str
    action: str
    approver: str
    reason: str
    ts: Nanos
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "config_hash": self.config_hash,
            "action": self.action,
            "approver": self.approver,
            "reason": self.reason,
            "ts": self.ts,
            "ts_iso": to_iso(self.ts),
            "evidence": dict(self.evidence),
        }


@dataclass(frozen=True, slots=True)
class PromotionState:
    """Whether a particular build of a strategy may trade real money."""

    strategy_id: str
    strategy_version: str
    config_hash: str
    promoted: bool
    approver: str = ""
    ts: Nanos = 0
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "config_hash": self.config_hash,
            "promoted": self.promoted,
            "approver": self.approver,
            "promoted_at": to_iso(self.ts) if self.ts else None,
            "reason": self.reason,
        }


class PromotionLedger:
    """Append-only promotion history, with the current state derived from it.

    Args:
        store: a :class:`~core.storage.sql_store.SqlStore`, or ``None`` for an in-memory
            ledger. In-memory is for tests only: a promotion that does not survive a
            restart is a promotion nobody can audit, and :meth:`promote` says so in the log.
    """

    __slots__ = ("_records", "_store")

    def __init__(self, store: Any = None) -> None:
        self._store = store
        self._records: list[PromotionRecord] = []
        if store is not None:
            self._records = self._load()

    def _load(self) -> list[PromotionRecord]:
        return [
            PromotionRecord(
                strategy_id=row["strategy_id"],
                strategy_version=row["strategy_version"],
                config_hash=row["config_hash"],
                action=row["action"],
                approver=row["approver"],
                reason=row["reason"],
                ts=int(row["ts"]),
                evidence=row["evidence"] or {},
            )
            for row in self._store.read_promotions()
        ]

    @property
    def records(self) -> tuple[PromotionRecord, ...]:
        return tuple(self._records)

    def _append(self, record: PromotionRecord) -> None:
        if self._store is not None:
            self._store.append_promotion(record.to_dict())
        self._records.append(record)

    @staticmethod
    def _check_approver(approver: str) -> str:
        name = approver.strip()
        if name.lower() in _FORBIDDEN_APPROVERS:
            raise ValueError(
                f"{approver!r} is not a person. Promotion is the one action that lets a "
                "strategy spend real money, and an approval attributed to automation is "
                "an approval nobody made."
            )
        return name

    def promote(
        self,
        assessment: Any,
        approver: str,
        reason: str,
        config_hash: str,
        ts: Nanos | None = None,
    ) -> PromotionRecord:
        """Promote a strategy to live. Human action, recorded.

        Raises:
            ValueError: when the assessment did not approve, when the approver is not a
                person, or when no reason is given. The gate is not advisory: a promotion
                against a failed assessment is refused here rather than logged as an
                override, because an override that is merely logged is an override that
                becomes routine.
        """
        if not getattr(assessment, "approved", False):
            failures = list(getattr(assessment, "failures", []))
            missing = list(getattr(assessment, "missing", []))
            raise ValueError(
                f"{assessment.strategy_id} has not cleared the promotion bar: "
                f"{len(failures)} failure(s), {len(missing)} unmeasured requirement(s). "
                f"{'; '.join(failures + missing)}"
            )
        name = self._check_approver(approver)
        if not reason.strip():
            raise ValueError("a promotion requires a reason: the record is the point")

        record = PromotionRecord(
            strategy_id=assessment.strategy_id,
            strategy_version=assessment.strategy_version,
            config_hash=config_hash,
            action="PROMOTE",
            approver=name,
            reason=reason.strip(),
            ts=ts if ts is not None else now_ns(),
            evidence=assessment.to_dict(),
        )
        self._append(record)
        _log.critical(
            "strategy_promoted_to_live",
            strategy=record.strategy_id,
            version=record.strategy_version,
            config_hash=config_hash,
            approver=name,
            durable=self._store is not None,
            reason_codes=["STRATEGY_PROMOTED"],
        )
        if self._store is None:
            _log.warning(
                "promotion_not_durable",
                detail="this ledger is in memory; the promotion will not survive a restart",
            )
        return record

    def demote(
        self,
        strategy_id: str,
        strategy_version: str,
        config_hash: str,
        approver: str,
        reason: str,
        ts: Nanos | None = None,
    ) -> PromotionRecord:
        """Take a strategy off live. Deliberately easier than promoting it.

        No assessment is required and no bar is checked: stopping is always allowed, in the
        same way the kill switch is always allowed to trip. The approver is still recorded,
        because a demotion is also a decision somebody made.
        """
        record = PromotionRecord(
            strategy_id=strategy_id,
            strategy_version=strategy_version,
            config_hash=config_hash,
            action="DEMOTE",
            approver=self._check_approver(approver),
            reason=reason.strip() or "no reason given",
            ts=ts if ts is not None else now_ns(),
        )
        self._append(record)
        _log.warning(
            "strategy_demoted",
            strategy=strategy_id,
            version=strategy_version,
            approver=record.approver,
        )
        return record

    def state(
        self, strategy_id: str, strategy_version: str, config_hash: str
    ) -> PromotionState:
        """Whether this exact build is promoted.

        Exact: a different version or a different config hash is a different strategy, and
        this returns not-promoted for it. That is how a parameter change de-promotes
        automatically rather than inheriting an approval given for something else.
        """
        latest: PromotionRecord | None = None
        for record in self._records:
            if (
                record.strategy_id == strategy_id
                and record.strategy_version == strategy_version
                and record.config_hash == config_hash
            ):
                latest = record
        if latest is None or latest.action != "PROMOTE":
            return PromotionState(
                strategy_id=strategy_id,
                strategy_version=strategy_version,
                config_hash=config_hash,
                promoted=False,
                reason=latest.reason if latest else "never promoted",
            )
        return PromotionState(
            strategy_id=strategy_id,
            strategy_version=strategy_version,
            config_hash=config_hash,
            promoted=True,
            approver=latest.approver,
            ts=latest.ts,
            reason=latest.reason,
        )

    def promoted_strategies(self) -> list[PromotionState]:
        """Every build currently promoted. Empty is the expected answer today."""
        keys = {(r.strategy_id, r.strategy_version, r.config_hash) for r in self._records}
        states = [self.state(*key) for key in sorted(keys)]
        return [s for s in states if s.promoted]
