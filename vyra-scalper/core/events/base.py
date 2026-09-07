"""Base event type and the latency accounting every event carries.

All events are frozen dataclasses with ``slots=True``.  Immutability is not stylistic:
events are fanned out to the bar engine, feature engine, regime engine, strategies and
recorders, and a mutable event would let one consumer silently change what the next one
sees.  ``slots`` removes the per-instance ``__dict__``, which matters at tick rates.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, ClassVar

from core.events.enums import DataFlag, EventType
from core.util.clock import Nanos

__all__ = ["Event", "NO_EXCHANGE_TIMESTAMP"]

NO_EXCHANGE_TIMESTAMP: Nanos = 0
"""Sentinel for a venue that supplies no timestamp of its own.

Distinguishing "unknown" from "zero latency" matters: a missing measurement reported as
zero would make a degraded feed look perfect (``DATA_SPEC.md`` §2.1).
"""


@dataclass(frozen=True, slots=True)
class Event:
    """Common envelope for everything that crosses a boundary in the engine.

    Attributes:
        instrument_id: canonical internal identifier, e.g. ``CME:MES``.
        exchange: venue identifier, e.g. ``CME``, ``NASDAQ``, ``BROKER:OANDA``.
        ts_exchange: venue timestamp in UTC ns, or :data:`NO_EXCHANGE_TIMESTAMP`.
        ts_receive: UTC ns at which the process first saw the message.
        ts_processed: UTC ns at which the engine handed it to consumers.  This is the
            ordering key: it is the only stamp that reflects when a strategy could
            legitimately have known the information.
        sequence_id: strictly increasing within a run; breaks timestamp ties so ordering
            is total and replay is deterministic.
        source: feed identifier for provenance, e.g. ``SYNTH:v1``.
        flags: data-quality annotations; an empty tuple means the event passed clean.
    """

    event_type: ClassVar[EventType]

    instrument_id: str
    exchange: str
    ts_exchange: Nanos
    ts_receive: Nanos
    ts_processed: Nanos
    sequence_id: int
    source: str
    flags: tuple[DataFlag, ...] = field(default=())

    @property
    def ts(self) -> Nanos:
        """Canonical ordering timestamp — when the engine may act on this event."""
        return self.ts_processed

    @property
    def exchange_to_receive_latency(self) -> int | None:
        """Venue-to-process latency in ns, or ``None`` when the venue gave no stamp."""
        if self.ts_exchange == NO_EXCHANGE_TIMESTAMP:
            return None
        return self.ts_receive - self.ts_exchange

    @property
    def receive_to_process_latency(self) -> int:
        """Time the event spent inside our own pipeline, in ns."""
        return self.ts_processed - self.ts_receive

    @property
    def end_to_end_latency(self) -> int | None:
        """Venue-to-consumer latency in ns, or ``None`` when the venue gave no stamp."""
        if self.ts_exchange == NO_EXCHANGE_TIMESTAMP:
            return None
        return self.ts_processed - self.ts_exchange

    def has_flag(self, flag: DataFlag) -> bool:
        return flag in self.flags

    def with_flags(self, *flags: DataFlag) -> Event:
        """Return a copy with ``flags`` added, preserving order and removing duplicates."""
        merged = list(self.flags)
        for flag in flags:
            if flag not in merged:
                merged.append(flag)
        return replace(self, flags=tuple(merged))

    def with_processed(self, ts_processed: Nanos) -> Event:
        """Return a copy stamped with a new ``ts_processed``.

        Used by the latency model, which delays delivery of an event to consumers without
        altering when the venue produced it.
        """
        return replace(self, ts_processed=ts_processed)

    def to_dict(self) -> dict[str, Any]:
        """Serialise for storage and logging, including the derived latency fields."""
        from dataclasses import fields as dc_fields

        payload: dict[str, Any] = {"event_type": self.event_type.value}
        for f in dc_fields(self):
            value = getattr(self, f.name)
            if f.name == "flags":
                payload[f.name] = [flag.value for flag in value]
            elif hasattr(value, "value"):
                payload[f.name] = value.value
            else:
                payload[f.name] = value
        payload["exchange_to_receive_latency"] = self.exchange_to_receive_latency
        payload["receive_to_process_latency"] = self.receive_to_process_latency
        payload["end_to_end_latency"] = self.end_to_end_latency
        return payload
