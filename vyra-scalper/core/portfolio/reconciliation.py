"""Position reconciliation.

**The broker is the source of truth. Our book is a belief.** Every divergence between the
two is either a bug in our order tracking or a fill we never saw, and both are conditions
under which continuing to trade compounds the error (``EXECUTION_SPEC.md`` §7).

The reconciler never silently overwrites. Every adoption of broker state emits a
:class:`~core.events.trading.RiskEvent`, so a position that changed without an order can be
traced afterwards.

Runs on connect, on a timer, after any disconnect, and before every flatten.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from core.brokers.base import BrokerAdapter, BrokerError, BrokerPosition
from core.events import RiskEvent
from core.instruments.instrument import Instrument
from core.portfolio.portfolio import Portfolio
from core.risk.kill_switch import KillSwitch, Trigger
from core.util.clock import NS_PER_SEC, Nanos
from core.util.logging import get_logger

__all__ = [
    "Divergence",
    "DivergenceKind",
    "PositionReconciler",
    "ReconciliationResult",
]

_log = get_logger("portfolio.reconciliation")


class DivergenceKind(StrEnum):
    """How our book and the venue's disagree.

    The three that trip the kill switch are the three where *we do not know what we own*.
    ``AVG_PRICE_MISMATCH`` is a bookkeeping difference on a position both sides agree
    exists, so it is adopted and logged rather than halted on.
    """

    UNKNOWN_POSITION = "UNKNOWN_POSITION"
    PHANTOM_POSITION = "PHANTOM_POSITION"
    QTY_MISMATCH = "QTY_MISMATCH"
    AVG_PRICE_MISMATCH = "AVG_PRICE_MISMATCH"

    @property
    def is_critical(self) -> bool:
        """Whether this divergence means we do not know our own exposure."""
        return self in (
            DivergenceKind.UNKNOWN_POSITION,
            DivergenceKind.PHANTOM_POSITION,
            DivergenceKind.QTY_MISMATCH,
        )

    @property
    def trigger(self) -> Trigger:
        """The kill-switch trigger this divergence maps to."""
        if self is DivergenceKind.UNKNOWN_POSITION:
            return Trigger.UNKNOWN_POSITION
        return Trigger.RECONCILIATION_FAILURE


@dataclass(frozen=True, slots=True)
class Divergence:
    """One disagreement between our book and the venue's."""

    kind: DivergenceKind
    instrument_id: str
    our_quantity: float
    their_quantity: float
    our_avg_price: float = 0.0
    their_avg_price: float = 0.0
    ts: Nanos = 0

    @property
    def quantity_delta(self) -> float:
        """Their quantity minus ours — the size of the position we did not know about."""
        return self.their_quantity - self.our_quantity

    def describe(self) -> str:
        if self.kind is DivergenceKind.UNKNOWN_POSITION:
            return (
                f"{self.instrument_id}: broker reports {self.their_quantity} but our book "
                "has no position. A fill was missed, or an order was placed outside the "
                "engine."
            )
        if self.kind is DivergenceKind.PHANTOM_POSITION:
            return (
                f"{self.instrument_id}: our book has {self.our_quantity} but the broker "
                "reports flat. The position was closed without us seeing the fill."
            )
        if self.kind is DivergenceKind.QTY_MISMATCH:
            return (
                f"{self.instrument_id}: our book has {self.our_quantity}, broker reports "
                f"{self.their_quantity} (delta {self.quantity_delta:+g})."
            )
        return (
            f"{self.instrument_id}: quantity agrees at {self.their_quantity} but average "
            f"price differs — ours {self.our_avg_price}, theirs {self.their_avg_price}."
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "instrument_id": self.instrument_id,
            "our_quantity": self.our_quantity,
            "their_quantity": self.their_quantity,
            "quantity_delta": self.quantity_delta,
            "our_avg_price": self.our_avg_price,
            "their_avg_price": self.their_avg_price,
            "is_critical": self.kind.is_critical,
            "ts": self.ts,
            "detail": self.describe(),
        }


@dataclass(frozen=True, slots=True)
class ReconciliationResult:
    """The outcome of one reconciliation pass."""

    ts: Nanos
    checked: int
    divergences: tuple[Divergence, ...] = ()
    adopted: tuple[str, ...] = ()
    risk_events: tuple[RiskEvent, ...] = ()
    tripped_kill_switch: bool = False
    error: str | None = None

    @property
    def is_clean(self) -> bool:
        return not self.divergences and self.error is None

    @property
    def critical(self) -> tuple[Divergence, ...]:
        return tuple(d for d in self.divergences if d.kind.is_critical)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "checked": self.checked,
            "is_clean": self.is_clean,
            "divergences": [d.to_dict() for d in self.divergences],
            "adopted": list(self.adopted),
            "tripped_kill_switch": self.tripped_kill_switch,
            "error": self.error,
        }


@dataclass(frozen=True, slots=True)
class ReconciliationConfig:
    """Reconciliation policy, from ``execution.yaml``.

    Attributes:
        qty_tolerance: quantity difference treated as agreement. Zero for futures and
            equities, which are integral — any drift there is a real missing fill.
        price_tolerance_ticks: average-price difference treated as agreement. A venue
            rounds and accrues differently from us, so a small difference is expected.
        adopt_broker_on_mismatch: whether to overwrite our book with the venue's. Default
            true, because the venue is the source of truth; the alternative is trading
            against a book we already know to be wrong.
    """

    interval_seconds: float = 30.0
    on_connect: bool = True
    qty_tolerance: float = 0.0
    price_tolerance_ticks: float = 1.0
    adopt_broker_on_mismatch: bool = True

    @classmethod
    def from_config(cls, section: Any) -> ReconciliationConfig:
        return cls(
            interval_seconds=section.float_("interval_seconds", 30.0),
            on_connect=section.bool_("on_connect", True),
            qty_tolerance=section.float_("qty_tolerance", 0.0),
            price_tolerance_ticks=section.float_("price_tolerance_ticks", 1.0),
            adopt_broker_on_mismatch=section.bool_("adopt_broker_on_mismatch", True),
        )


class PositionReconciler:
    """Compares our book with the venue's and resolves the difference.

    Args:
        broker: the adapter to query. Its answer is authoritative.
        portfolio: our own book.
        instruments: instrument definitions, for tick-based price tolerance.
        kill_switch: tripped on any critical divergence.
        config: tolerances and policy.
    """

    __slots__ = (
        "_broker",
        "_config",
        "_instruments",
        "_kill_switch",
        "_last_run_ns",
        "_portfolio",
        "_sequence",
    )

    def __init__(
        self,
        broker: BrokerAdapter,
        portfolio: Portfolio,
        instruments: dict[str, Instrument],
        kill_switch: KillSwitch,
        config: ReconciliationConfig | None = None,
    ) -> None:
        self._broker = broker
        self._portfolio = portfolio
        self._instruments = instruments
        self._kill_switch = kill_switch
        self._config = config or ReconciliationConfig()
        self._last_run_ns: Nanos = 0
        self._sequence = 0

    @property
    def config(self) -> ReconciliationConfig:
        return self._config

    @property
    def last_run_ns(self) -> Nanos:
        return self._last_run_ns

    def is_due(self, ts: Nanos) -> bool:
        """Whether the interval has elapsed since the last pass."""
        if self._last_run_ns == 0:
            return True
        return ts - self._last_run_ns >= int(self._config.interval_seconds * NS_PER_SEC)

    def reconcile(self, ts: Nanos, reason: str = "SCHEDULED") -> ReconciliationResult:
        """Compare both books and resolve any difference.

        Never raises. A broker error during reconciliation is itself a reason to stop
        trading — we cannot verify what we own — so it trips the kill switch and is
        returned as an error rather than propagating into the event loop.
        """
        self._last_run_ns = ts
        try:
            theirs = self._broker.get_positions()
        except BrokerError as exc:
            _log.error(
                "reconciliation_query_failed",
                reason=reason,
                error_code=exc.code.value,
                message=exc.message,
                reason_codes=["RECONCILIATION_FAILURE"],
            )
            self._kill_switch.trip(
                Trigger.RECONCILIATION_FAILURE,
                f"cannot query broker positions: {exc.message}",
                ts=ts,
                context={"reason": reason, "error_code": exc.code.value},
            )
            return ReconciliationResult(
                ts=ts, checked=0, tripped_kill_switch=True, error=exc.message
            )

        divergences = self._compare(theirs, ts)
        if not divergences:
            _log.debug("reconciliation_clean", reason=reason, checked=len(theirs))
            return ReconciliationResult(ts=ts, checked=len(theirs))

        events: list[RiskEvent] = []
        adopted: list[str] = []
        for divergence in divergences:
            events.append(self._emit(divergence, ts, reason))
            if self._config.adopt_broker_on_mismatch:
                self._adopt(divergence, theirs.get(divergence.instrument_id))
                adopted.append(divergence.instrument_id)

        critical = [d for d in divergences if d.kind.is_critical]
        tripped = False
        if critical:
            worst = critical[0]
            self._kill_switch.trip(
                worst.kind.trigger,
                "; ".join(d.describe() for d in critical),
                ts=ts,
                context={"reason": reason, "divergences": [d.to_dict() for d in critical]},
            )
            tripped = True

        return ReconciliationResult(
            ts=ts,
            checked=len(theirs),
            divergences=tuple(divergences),
            adopted=tuple(adopted),
            risk_events=tuple(events),
            tripped_kill_switch=tripped,
        )

    def _compare(
        self, theirs: dict[str, BrokerPosition], ts: Nanos
    ) -> list[Divergence]:
        """Find every disagreement, checking the union of both books.

        The union matters: iterating only our own positions would never find a position
        the broker has and we do not — which is precisely the most dangerous case.
        """
        ours = self._portfolio.open_positions
        divergences: list[Divergence] = []

        for instrument_id in sorted(set(ours) | set(theirs)):
            our_position = ours.get(instrument_id)
            their_position = theirs.get(instrument_id)
            our_qty = our_position.quantity if our_position else 0.0
            their_qty = their_position.quantity if their_position else 0.0
            our_avg = our_position.avg_price if our_position else 0.0
            their_avg = their_position.avg_price if their_position else 0.0

            if abs(our_qty - their_qty) > self._config.qty_tolerance:
                if our_qty == 0.0:
                    kind = DivergenceKind.UNKNOWN_POSITION
                elif their_qty == 0.0:
                    kind = DivergenceKind.PHANTOM_POSITION
                else:
                    kind = DivergenceKind.QTY_MISMATCH
                divergences.append(
                    Divergence(kind, instrument_id, our_qty, their_qty, our_avg, their_avg, ts)
                )
                continue

            if our_qty != 0.0 and self._price_differs(instrument_id, our_avg, their_avg):
                divergences.append(
                    Divergence(
                        DivergenceKind.AVG_PRICE_MISMATCH, instrument_id, our_qty,
                        their_qty, our_avg, their_avg, ts,
                    )
                )
        return divergences

    def _price_differs(self, instrument_id: str, ours: float, theirs: float) -> bool:
        instrument = self._instruments.get(instrument_id)
        if instrument is None or theirs <= 0 or ours <= 0:
            return False
        tolerance = self._config.price_tolerance_ticks * instrument.tick_size
        return abs(ours - theirs) > tolerance

    def _adopt(self, divergence: Divergence, their_position: BrokerPosition | None) -> None:
        """Overwrite our book with the venue's, for one instrument.

        Only the position is adopted; realised PnL and fees already booked are left alone,
        because they record what we actually paid and observed. The gap this leaves in the
        equity reconstruction is intentional and visible: it is the cost of a divergence,
        not something to be smoothed over.
        """
        instrument = self._instruments.get(divergence.instrument_id)
        if instrument is None:
            return
        position = self._portfolio.position(divergence.instrument_id)
        if their_position is None or their_position.is_flat:
            position.quantity = 0.0
            position.avg_price = 0.0
            position.entry_ts = 0
        else:
            position.quantity = their_position.quantity
            position.avg_price = their_position.avg_price
        _log.warning(
            "position_adopted_from_broker",
            instrument=divergence.instrument_id,
            kind=divergence.kind.value,
            our_quantity=divergence.our_quantity,
            adopted_quantity=position.quantity,
            reason_codes=["RECONCILIATION_FAILURE"],
        )

    def _emit(self, divergence: Divergence, ts: Nanos, reason: str) -> RiskEvent:
        """Record the divergence as an auditable risk event."""
        self._sequence += 1
        instrument = self._instruments.get(divergence.instrument_id)
        severity = "CRITICAL" if divergence.kind.is_critical else "WARNING"
        log = _log.error if divergence.kind.is_critical else _log.warning
        log(
            "position_divergence",
            instrument=divergence.instrument_id,
            kind=divergence.kind.value,
            detail=divergence.describe(),
            trigger_reason=reason,
            reason_codes=[divergence.kind.value],
        )
        return RiskEvent(
            instrument_id=divergence.instrument_id,
            exchange=instrument.exchange if instrument else "",
            ts_exchange=0,
            ts_receive=ts,
            ts_processed=ts,
            sequence_id=self._sequence,
            source="RECONCILER",
            risk_event_id=f"recon-{self._sequence:08d}",
            kind=divergence.kind.value,
            severity=severity,
            action="HALT" if divergence.kind.is_critical else "REDUCE",
            reason_codes=(divergence.kind.value,),
            detail=divergence.to_dict(),
        )
