"""Instrument definitions.

An :class:`Instrument` is the single source of truth for how a symbol converts price
movement into money.  Getting ``tick_value`` wrong scales every PnL number in the system
by a constant and is invisible in a backtest report, so the invariants are checked at
construction and again at config load (``DATA_SPEC.md`` §7.1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.events.enums import AssetClass
from core.util.clock import Nanos
from core.util.numeric import floor_to_step, quantize_qty, round_to_tick, ticks_between

__all__ = ["Instrument", "InstrumentError"]

_TICK_VALUE_TOLERANCE = 1e-9


class InstrumentError(ValueError):
    """Raised when an instrument definition is internally inconsistent."""


@dataclass(frozen=True, slots=True)
class Instrument:
    """A tradeable instrument.

    Attributes:
        instrument_id: canonical internal id, ``EXCHANGE:SYMBOL`` (e.g. ``CME:MES``).
        tick_size: minimum price increment in price units.
        tick_value: money earned per contract per tick of favourable movement, in
            ``currency``.  For futures this must equal ``tick_size * multiplier``.
        multiplier: contract multiplier.  ``1`` for equities; ``5`` for MES; ``50`` for ES.
        min_qty / qty_step: venue quantity constraints.  Futures use whole contracts;
            CFDs commonly allow fractional lots.
        max_spread_ticks: instrument-level spread gate used by the risk engine.
        expiry_ns: futures expiry, or ``None`` for perpetual instruments.
        is_continuous: ``True`` only for a synthetic series built by an explicit
            :class:`~core.instruments.continuous.ContinuousContractSpec`.  Such an
            instrument is research-only and the execution path refuses it.
    """

    instrument_id: str
    symbol: str
    asset_class: AssetClass
    exchange: str
    currency: str
    tick_size: float
    tick_value: float
    multiplier: float
    min_qty: float = 1.0
    qty_step: float = 1.0
    max_qty: float | None = None
    max_spread_ticks: float = 10.0
    session_id: str = "24x7"
    timezone: str = "UTC"
    expiry_ns: Nanos | None = None
    contract_month: str | None = None
    underlying: str | None = None
    is_continuous: bool = False
    price_precision: int = 2
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.instrument_id:
            raise InstrumentError("instrument_id must be non-empty")
        if self.tick_size <= 0:
            raise InstrumentError(f"{self.instrument_id}: tick_size must be positive")
        if self.tick_value <= 0:
            raise InstrumentError(f"{self.instrument_id}: tick_value must be positive")
        if self.multiplier <= 0:
            raise InstrumentError(f"{self.instrument_id}: multiplier must be positive")
        if self.min_qty <= 0:
            raise InstrumentError(f"{self.instrument_id}: min_qty must be positive")
        if self.qty_step <= 0:
            raise InstrumentError(f"{self.instrument_id}: qty_step must be positive")
        if self.max_qty is not None and self.max_qty < self.min_qty:
            raise InstrumentError(f"{self.instrument_id}: max_qty is below min_qty")

        # The identity that keeps PnL honest.  Enforced for futures and equities, where it
        # is definitional; CFD brokers quote their own contract sizes, so it is advisory
        # there and carried in metadata instead.
        if self.asset_class in (AssetClass.FUTURE, AssetClass.EQUITY):
            expected = self.tick_size * self.multiplier
            if abs(self.tick_value - expected) > _TICK_VALUE_TOLERANCE:
                raise InstrumentError(
                    f"{self.instrument_id}: tick_value {self.tick_value} != "
                    f"tick_size * multiplier ({self.tick_size} * {self.multiplier} = "
                    f"{expected}). A wrong tick value silently rescales every PnL figure."
                )
        if self.asset_class is AssetClass.EQUITY and self.multiplier != 1.0:
            raise InstrumentError(
                f"{self.instrument_id}: equity multiplier must be 1, got {self.multiplier}"
            )
        if self.asset_class is AssetClass.FUTURE and self.expiry_ns is None and not self.is_continuous:
            raise InstrumentError(
                f"{self.instrument_id}: a dated future needs expiry_ns; if this is a "
                "stitched series, build it through ContinuousContractSpec and set "
                "is_continuous=True"
            )

    # -- price and quantity conversion -------------------------------------------------

    def round_price(self, price: float) -> float:
        """Quantise ``price`` to a legal tick."""
        return round_to_tick(price, self.tick_size)

    def round_qty(self, qty: float) -> float:
        """Quantise ``qty`` down to a legal size, or ``0.0`` if below the minimum.

        Zero means *do not send an order*.  Rounding up to ``min_qty`` would exceed the
        risk budget the size was derived from (``RISK_SPEC.md`` §4).
        """
        return quantize_qty(qty, self.qty_step, self.min_qty)

    def ticks(self, from_price: float, to_price: float) -> float:
        """Signed distance between two prices, in ticks."""
        return ticks_between(from_price, to_price, self.tick_size)

    def money_per_tick(self, qty: float = 1.0) -> float:
        """Money earned per tick of favourable movement for ``qty`` units."""
        return self.tick_value * qty

    def pnl(self, entry: float, exit_price: float, qty: float, sign: int) -> float:
        """PnL in account currency for a round trip.

        Args:
            entry: entry price.
            exit_price: exit price.
            qty: absolute quantity.
            sign: ``+1`` for a long, ``-1`` for a short.

        Computed through ticks rather than ``(exit - entry) * multiplier`` so that the
        result is consistent with the tick-value identity above and with how a venue
        actually settles.
        """
        return self.ticks(entry, exit_price) * sign * self.tick_value * qty

    def notional(self, price: float, qty: float) -> float:
        """Gross notional exposure of ``qty`` units at ``price``."""
        return abs(price * qty * self.multiplier)

    def max_position_from_notional(self, price: float, max_notional: float) -> float:
        """Largest legal quantity whose notional stays within ``max_notional``."""
        if price <= 0 or self.multiplier <= 0:
            return 0.0
        raw = max_notional / (price * self.multiplier)
        return floor_to_step(max(0.0, raw), self.qty_step)

    # -- lifecycle ---------------------------------------------------------------------

    def is_expired(self, ts: Nanos) -> bool:
        """True when ``ts`` is at or past the contract's expiry."""
        return self.expiry_ns is not None and ts >= self.expiry_ns

    def days_to_expiry(self, ts: Nanos) -> float | None:
        """Calendar days until expiry, or ``None`` for a perpetual instrument."""
        if self.expiry_ns is None:
            return None
        from core.util.clock import NS_PER_DAY

        return (self.expiry_ns - ts) / NS_PER_DAY

    @property
    def supports_exchange_depth(self) -> bool:
        """Whether centralised depth exists for this instrument.

        CFD "depth" is one broker's quoting, not market liquidity, so strategies that
        require genuine order-book microstructure are refused on these instruments at
        configuration time (``DATA_SPEC.md`` §6).
        """
        return self.asset_class in (AssetClass.FUTURE, AssetClass.EQUITY)

    def to_dict(self) -> dict[str, Any]:
        from dataclasses import asdict

        payload = asdict(self)
        payload["asset_class"] = self.asset_class.value
        return payload
