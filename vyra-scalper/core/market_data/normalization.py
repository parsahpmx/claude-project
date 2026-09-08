"""Market-data validation and normalisation.

The rule this module exists to enforce: **never silently repair data**
(``DATA_SPEC.md`` §1).  Events that are malformed-but-usable are delivered with a
:class:`~core.events.enums.DataFlag` attached; events that would corrupt downstream
arithmetic are dropped and counted.  Either way, the outcome is recorded — a backtest
whose input had 3 % invalid ticks says so on its report rather than quietly producing a
cleaner-looking equity curve.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from core.events import DataFlag, Event, QuoteEvent, TradeEvent
from core.instruments.instrument import Instrument
from core.util.clock import NS_PER_MS, Nanos
from core.util.logging import get_logger
from core.util.numeric import is_finite

__all__ = ["DropReason", "NormalizationResult", "Normalizer", "ValidationCounters"]

_log = get_logger("market_data.normalization")


class DropReason:
    """Reasons an event is discarded rather than delivered.

    Plain string constants, not an enum, because they are aggregated into counters keyed
    by name and written to manifests where a stable string is what matters.
    """

    INVALID_VALUE = "INVALID_VALUE"
    NON_POSITIVE_PRICE = "NON_POSITIVE_PRICE"
    NEGATIVE_SIZE = "NEGATIVE_SIZE"
    DUPLICATE = "DUPLICATE"
    OUT_OF_ORDER_STRICT = "OUT_OF_ORDER_STRICT"


@dataclass(slots=True)
class ValidationCounters:
    """Per-instrument tally of everything the normaliser saw.

    Written into the dataset manifest and the backtest report so data quality is visible
    next to the performance numbers rather than buried in a log file.
    """

    accepted: int = 0
    dropped: int = 0
    drops_by_reason: dict[str, int] = field(default_factory=dict)
    flags_by_type: dict[str, int] = field(default_factory=dict)

    def record_accept(self, flags: tuple[DataFlag, ...]) -> None:
        self.accepted += 1
        for flag in flags:
            self.flags_by_type[flag.value] = self.flags_by_type.get(flag.value, 0) + 1

    def record_drop(self, reason: str) -> None:
        self.dropped += 1
        self.drops_by_reason[reason] = self.drops_by_reason.get(reason, 0) + 1

    @property
    def total(self) -> int:
        return self.accepted + self.dropped

    @property
    def drop_rate(self) -> float:
        return self.dropped / self.total if self.total else 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "accepted": self.accepted,
            "dropped": self.dropped,
            "drop_rate": round(self.drop_rate, 6),
            "drops_by_reason": dict(self.drops_by_reason),
            "flags_by_type": dict(self.flags_by_type),
        }


@dataclass(frozen=True, slots=True)
class NormalizationResult:
    """Outcome of validating one event.

    ``event`` is ``None`` exactly when ``dropped`` is set.  Callers must check rather
    than assume: silently treating a drop as a pass-through is how bad ticks reach the
    feature engine.
    """

    event: Event | None
    dropped: str | None = None

    @property
    def is_accepted(self) -> bool:
        return self.event is not None


@dataclass(slots=True)
class _InstrumentState:
    last_ts: Nanos = 0
    last_sequence: int = -1
    last_price: float = 0.0
    seen_sequences: set[int] = field(default_factory=set)


class Normalizer:
    """Validates and flags market events against instrument definitions.

    Args:
        instruments: mapping of instrument id to :class:`Instrument`.
        strict_ordering: when ``True``, an out-of-order event is dropped rather than
            flagged.  Use for research datasets that must be strictly monotonic; leave
            ``False`` live, where a late tick is information rather than corruption.
        clock_skew_tolerance_ms: how far a venue timestamp may exceed our receive
            timestamp before ``CLOCK_SKEW`` is flagged.  Some skew is normal; a lot of it
            means the latency numbers cannot be trusted.
        spike_threshold_ticks: single-tick move beyond which ``PRICE_SPIKE`` is flagged.
            Flagged, never dropped — real markets gap, and deleting the gap is how a
            backtest learns that stops always fill.
        dedupe_window: number of recent sequence ids retained per instrument for
            duplicate detection.  Bounded so a long run does not grow without limit.
    """

    __slots__ = (
        "_clock_skew_tolerance_ns",
        "_counters",
        "_dedupe_window",
        "_instruments",
        "_spike_threshold_ticks",
        "_state",
        "_strict_ordering",
    )

    def __init__(
        self,
        instruments: dict[str, Instrument],
        *,
        strict_ordering: bool = False,
        clock_skew_tolerance_ms: float = 1000.0,
        spike_threshold_ticks: float = 200.0,
        dedupe_window: int = 4096,
    ) -> None:
        self._instruments = instruments
        self._strict_ordering = strict_ordering
        self._clock_skew_tolerance_ns = int(clock_skew_tolerance_ms * NS_PER_MS)
        self._spike_threshold_ticks = spike_threshold_ticks
        self._dedupe_window = dedupe_window
        self._state: dict[str, _InstrumentState] = {}
        self._counters: dict[str, ValidationCounters] = {}

    def counters(self, instrument_id: str) -> ValidationCounters:
        return self._counters.setdefault(instrument_id, ValidationCounters())

    def all_counters(self) -> dict[str, dict[str, object]]:
        return {iid: c.to_dict() for iid, c in sorted(self._counters.items())}

    def _state_for(self, instrument_id: str) -> _InstrumentState:
        return self._state.setdefault(instrument_id, _InstrumentState())

    def normalize(self, event: Event) -> NormalizationResult:
        """Validate ``event``, returning it (possibly flagged) or a drop reason."""
        counters = self.counters(event.instrument_id)
        state = self._state_for(event.instrument_id)
        instrument = self._instruments.get(event.instrument_id)

        drop = self._structural_drop(event, state)
        if drop is not None:
            counters.record_drop(drop)
            _log.debug(
                "event_dropped",
                instrument=event.instrument_id,
                reason=drop,
                sequence_id=event.sequence_id,
            )
            return NormalizationResult(None, drop)

        flags: list[DataFlag] = list(event.flags)
        self._flag_timing(event, state, flags)
        if isinstance(event, QuoteEvent):
            self._flag_quote(event, instrument, flags)
        elif isinstance(event, TradeEvent):
            self._flag_trade(event, instrument, state, flags)

        self._advance(event, state)
        flag_tuple = tuple(flags)
        counters.record_accept(flag_tuple)
        if flag_tuple != event.flags:
            event = replace(event, flags=flag_tuple)
        return NormalizationResult(event)

    # -- drops --------------------------------------------------------------------------

    def _structural_drop(self, event: Event, state: _InstrumentState) -> str | None:
        """Conditions under which an event cannot be delivered at all."""
        if event.sequence_id in state.seen_sequences:
            return DropReason.DUPLICATE

        if isinstance(event, QuoteEvent):
            for value in (event.bid, event.ask, event.bid_size, event.ask_size):
                if not is_finite(value):
                    return DropReason.INVALID_VALUE
            if event.bid_size < 0 or event.ask_size < 0:
                return DropReason.NEGATIVE_SIZE
            # A one-sided book is legitimate (a market can be bid-only), so only a book
            # with no price at all on either side is unusable.
            if event.bid <= 0 and event.ask <= 0:
                return DropReason.NON_POSITIVE_PRICE

        elif isinstance(event, TradeEvent):
            if not is_finite(event.price) or not is_finite(event.size):
                return DropReason.INVALID_VALUE
            if event.price <= 0:
                return DropReason.NON_POSITIVE_PRICE
            if event.size < 0:
                return DropReason.NEGATIVE_SIZE

        if self._strict_ordering and state.last_ts and event.ts < state.last_ts:
            return DropReason.OUT_OF_ORDER_STRICT
        return None

    # -- flags --------------------------------------------------------------------------

    def _flag_timing(self, event: Event, state: _InstrumentState, flags: list[DataFlag]) -> None:
        if state.last_ts and event.ts < state.last_ts:
            flags.append(DataFlag.OUT_OF_ORDER)
        if event.ts_exchange and event.ts_exchange > event.ts_receive + self._clock_skew_tolerance_ns:
            flags.append(DataFlag.CLOCK_SKEW)

    def _flag_quote(
        self, event: QuoteEvent, instrument: Instrument | None, flags: list[DataFlag]
    ) -> None:
        if event.is_crossed:
            flags.append(DataFlag.CROSSED_BOOK)
        if event.bid_size == 0 or event.ask_size == 0:
            flags.append(DataFlag.ZERO_SIZE)
        if instrument is None:
            return
        tick = instrument.tick_size
        for price in (event.bid, event.ask):
            if price > 0 and abs(instrument.round_price(price) - price) > tick * 1e-6:
                flags.append(DataFlag.OFF_TICK)
                break
        if event.is_two_sided:
            spread_ticks = event.spread / tick
            if spread_ticks > instrument.max_spread_ticks:
                flags.append(DataFlag.WIDE_SPREAD)

    def _flag_trade(
        self,
        event: TradeEvent,
        instrument: Instrument | None,
        state: _InstrumentState,
        flags: list[DataFlag],
    ) -> None:
        if event.size == 0:
            flags.append(DataFlag.ZERO_SIZE)
        if instrument is None:
            return
        if abs(instrument.round_price(event.price) - event.price) > instrument.tick_size * 1e-6:
            flags.append(DataFlag.OFF_TICK)
        if state.last_price > 0:
            move_ticks = abs(instrument.ticks(state.last_price, event.price))
            if move_ticks > self._spike_threshold_ticks:
                flags.append(DataFlag.PRICE_SPIKE)

    def _advance(self, event: Event, state: _InstrumentState) -> None:
        state.last_ts = max(state.last_ts, event.ts)
        state.last_sequence = max(state.last_sequence, event.sequence_id)
        if isinstance(event, TradeEvent):
            state.last_price = event.price
        elif isinstance(event, QuoteEvent) and event.is_two_sided:
            state.last_price = event.mid
        state.seen_sequences.add(event.sequence_id)
        if len(state.seen_sequences) > self._dedupe_window:
            # Bounded memory: drop the oldest half rather than growing without limit over
            # a multi-day run.  Sequence ids are monotonic, so the smallest are the oldest.
            keep = sorted(state.seen_sequences)[self._dedupe_window // 2 :]
            state.seen_sequences = set(keep)
