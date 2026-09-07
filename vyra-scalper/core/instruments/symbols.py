"""Symbol mapping between canonical internal ids and broker-specific symbols.

The same economic instrument is called different things by different brokers — gold is
``XAUUSD``, ``GOLD`` or ``XAU_USD`` depending on who you ask.  Getting this wrong routes
an order to the wrong market, so the mapper is **total and bidirectional**: an unmapped
symbol raises at connect time, not at order time (``DATA_SPEC.md`` §7.4).
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["SymbolMapper", "SymbolMappingError", "SymbolNotMapped"]


class SymbolMappingError(ValueError):
    """Raised when a mapping table is ambiguous or malformed."""


class SymbolNotMapped(KeyError):
    """Raised when a symbol has no mapping for the requested broker.

    Deliberately a hard failure.  Falling back to "use the canonical id and hope" is how
    an order for ``XAUUSD`` reaches a broker that only knows ``GOLD`` and is rejected — or
    worse, matches something else entirely.
    """

    def __str__(self) -> str:  # KeyError repr quotes the message; this reads better in logs
        return self.args[0] if self.args else ""


@dataclass(frozen=True, slots=True)
class _BrokerTable:
    to_broker: dict[str, str]
    from_broker: dict[str, str]


class SymbolMapper:
    """Bidirectional canonical-id ↔ broker-symbol translation.

    Example:
        >>> mapper = SymbolMapper()
        >>> mapper.register("IBKR", {"XAUUSD": "XAUUSD"})
        >>> mapper.register("MT5_B", {"XAUUSD": "GOLD"})
        >>> mapper.to_broker("MT5_B", "XAUUSD")
        'GOLD'
        >>> mapper.to_canonical("MT5_B", "GOLD")
        'XAUUSD'
    """

    __slots__ = ("_tables",)

    def __init__(self) -> None:
        self._tables: dict[str, _BrokerTable] = {}

    def register(self, broker: str, mapping: dict[str, str]) -> None:
        """Register (or replace) the table for ``broker``.

        Args:
            broker: broker identifier, e.g. ``IBKR``.
            mapping: canonical id → broker symbol.

        Raises:
            SymbolMappingError: if two canonical ids map to the same broker symbol.  A
                non-injective table cannot be reversed, and a fill arriving under an
                ambiguous symbol could be attributed to the wrong instrument.
        """
        if not broker:
            raise SymbolMappingError("broker identifier must be non-empty")
        reverse: dict[str, str] = {}
        for canonical, broker_symbol in mapping.items():
            if not canonical or not broker_symbol:
                raise SymbolMappingError(
                    f"{broker}: empty symbol in mapping entry {canonical!r} -> {broker_symbol!r}"
                )
            existing = reverse.get(broker_symbol)
            if existing is not None:
                raise SymbolMappingError(
                    f"{broker}: broker symbol {broker_symbol!r} is claimed by both "
                    f"{existing!r} and {canonical!r}; reverse mapping would be ambiguous"
                )
            reverse[broker_symbol] = canonical
        self._tables[broker] = _BrokerTable(dict(mapping), reverse)

    def brokers(self) -> tuple[str, ...]:
        return tuple(sorted(self._tables))

    def to_broker(self, broker: str, canonical_id: str) -> str:
        """Translate a canonical id to the broker's symbol.

        Raises:
            SymbolNotMapped: when the broker is unknown or the symbol is unmapped.
        """
        table = self._tables.get(broker)
        if table is None:
            raise SymbolNotMapped(
                f"no symbol table registered for broker {broker!r}; "
                f"known brokers: {', '.join(self.brokers()) or '(none)'}"
            )
        try:
            return table.to_broker[canonical_id]
        except KeyError:
            raise SymbolNotMapped(
                f"instrument {canonical_id!r} has no {broker} mapping; add it to "
                "configs/brokers.yaml before trading this instrument"
            ) from None

    def to_canonical(self, broker: str, broker_symbol: str) -> str:
        """Translate a broker symbol back to the canonical id.

        Raises:
            SymbolNotMapped: when the broker is unknown or the symbol is unrecognised.
                An unrecognised inbound symbol usually means the broker sent an update for
                an instrument we did not subscribe to, which must be surfaced rather than
                dropped.
        """
        table = self._tables.get(broker)
        if table is None:
            raise SymbolNotMapped(f"no symbol table registered for broker {broker!r}")
        try:
            return table.from_broker[broker_symbol]
        except KeyError:
            raise SymbolNotMapped(
                f"broker {broker} sent unknown symbol {broker_symbol!r}; "
                "it is not in this broker's mapping table"
            ) from None

    def has(self, broker: str, canonical_id: str) -> bool:
        """Whether ``canonical_id`` is mapped for ``broker`` (no exception)."""
        table = self._tables.get(broker)
        return table is not None and canonical_id in table.to_broker

    def validate_universe(self, broker: str, canonical_ids: list[str]) -> None:
        """Assert that every instrument we intend to trade is mapped for ``broker``.

        Called at connect time so that a missing mapping fails during startup rather than
        at the moment a signal fires.

        Raises:
            SymbolNotMapped: listing every missing instrument at once, so one restart
                fixes them all.
        """
        missing = [cid for cid in canonical_ids if not self.has(broker, cid)]
        if missing:
            raise SymbolNotMapped(
                f"broker {broker} is missing mappings for: {', '.join(sorted(missing))}"
            )

    @classmethod
    def from_config(cls, brokers_config: dict[str, dict[str, object]]) -> SymbolMapper:
        """Build from the ``brokers.yaml`` structure.

        Expects ``{broker_name: {"symbols": {canonical: broker_symbol}}}``.  Brokers
        without a ``symbols`` block are registered empty, which makes the resulting
        :class:`SymbolNotMapped` name the broker rather than reporting it as unknown.
        """
        mapper = cls()
        for broker, spec in brokers_config.items():
            symbols = spec.get("symbols", {}) if isinstance(spec, dict) else {}
            if not isinstance(symbols, dict):
                raise SymbolMappingError(f"{broker}: 'symbols' must be a mapping")
            mapper.register(broker, {str(k): str(v) for k, v in symbols.items()})
        return mapper
