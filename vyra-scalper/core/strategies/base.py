"""The strategy interface.

A strategy consumes events and returns :class:`~core.signals.signal.Signal` objects.  That
is the whole contract.  It has no broker, no order manager, no portfolio mutator and no
way to express a position size.

The isolation is structural, not advisory:

* :class:`StrategyContext` — everything a strategy is *allowed* to see — carries market
  state and read-only position information, and nothing that can place an order;
* ``tests/risk/test_no_bypass.py`` inspects strategy module namespaces and fails if a
  broker, order or execution symbol is importable from one.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from core.events import (
    BarEvent,
    FillEvent,
    OrderBookEvent,
    QuoteEvent,
    Regime,
    Side,
    Timeframe,
    TradeEvent,
)
from core.features.engine import FeatureSnapshot
from core.instruments.instrument import Instrument
from core.signals.confidence import ConfidenceScorer
from core.signals.signal import EntryType, Signal, SignalError, SignalIntent
from core.util.clock import Nanos
from core.util.logging import StructuredLogger, get_logger

__all__ = ["BaseStrategy", "StrategyConfig", "StrategyContext", "StrategyPosition"]


@dataclass(frozen=True, slots=True)
class StrategyPosition:
    """Read-only view of the strategy's own position.

    A strategy may know what it holds; it may not change it except by emitting a signal.
    """

    quantity: float = 0.0
    avg_price: float = 0.0
    unrealized_pnl: float = 0.0
    bars_held: int = 0
    entry_ts: Nanos = 0

    @property
    def is_flat(self) -> bool:
        return self.quantity == 0.0

    @property
    def is_long(self) -> bool:
        return self.quantity > 0.0

    @property
    def is_short(self) -> bool:
        return self.quantity < 0.0

    @property
    def side(self) -> Side | None:
        if self.quantity > 0:
            return Side.BUY
        if self.quantity < 0:
            return Side.SELL
        return None


@dataclass(frozen=True, slots=True)
class StrategyContext:
    """Everything a strategy may see at decision time.

    Deliberately does not expose the broker, the order manager, the risk engine or the
    account.  A strategy that cannot reach them cannot bypass them.
    """

    ts: Nanos
    instrument: Instrument
    features: FeatureSnapshot
    position: StrategyPosition
    regime: Regime = Regime.UNKNOWN
    session_open_ns: Nanos = 0
    is_session_open: bool = True
    last_quote: QuoteEvent | None = None

    def feature(self, name: str, default: float | None = None) -> float | None:
        return self.features.get(name, default)

    def require_features(self, *names: str) -> tuple[float, ...]:
        return self.features.require(*names)


@dataclass(frozen=True, slots=True)
class StrategyConfig:
    """A strategy's configuration, loaded from ``strategies.yaml``.

    ``params`` is an opaque mapping validated by each strategy's own
    :meth:`BaseStrategy.validate_params`, so a missing or nonsensical parameter fails at
    construction rather than on the first signal.
    """

    strategy_id: str
    version: str
    instruments: tuple[str, ...]
    timeframe: Timeframe
    allowed_regimes: tuple[Regime, ...]
    params: dict[str, Any] = field(default_factory=dict)
    requires_exchange_depth: bool = False
    enabled: bool = True

    def allows(self, regime: Regime) -> bool:
        """Whether the strategy may trade in ``regime``.

        An empty ``allowed_regimes`` means "any regime", which is only appropriate for a
        strategy that has been shown to be regime-insensitive.
        """
        return not self.allowed_regimes or regime in self.allowed_regimes


class BaseStrategy(ABC):
    """Base class for every strategy.

    Subclasses implement :meth:`generate_signal` and whichever ``on_*`` handlers they
    need.  The base class provides id minting, logging, parameter access and the
    signal-construction helpers that enforce tick alignment and stop geometry.
    """

    def __init__(
        self,
        config: StrategyConfig,
        instruments: dict[str, Instrument],
        confidence_scorer: ConfidenceScorer | None = None,
    ) -> None:
        self.config = config
        self.instruments = instruments
        # Scoring weights live in the shared confidence configuration (section 10), not in
        # strategy source.  A strategy contributes observations; the scorer combines them.
        self.confidence_scorer = confidence_scorer
        self.log: StructuredLogger = get_logger(f"strategy.{config.strategy_id}").bind(
            strategy_id=config.strategy_id, strategy_version=config.version
        )
        self._signal_counter = 0
        self.validate_params(config.params)
        self._check_depth_requirement()

    def _check_depth_requirement(self) -> None:
        """Refuse to attach a depth-dependent strategy to an instrument without depth.

        Broker CFD quoting is not centralised market liquidity (``DATA_SPEC.md`` §6), so
        this is caught at construction rather than producing microstructure signals from
        one broker's spread policy.
        """
        if not self.config.requires_exchange_depth:
            return
        offenders = [
            iid
            for iid, inst in self.instruments.items()
            if iid in self.config.instruments and not inst.supports_exchange_depth
        ]
        if offenders:
            raise ValueError(
                f"strategy {self.config.strategy_id!r} requires exchange depth but is "
                f"configured for instruments without it: {', '.join(sorted(offenders))}. "
                "Broker CFD depth is that broker's quoting, not market liquidity."
            )

    # -- lifecycle ---------------------------------------------------------------------

    # The lifecycle and event hooks below default to doing nothing on purpose: a strategy
    # implements only the handlers it needs, and forcing an empty override of the rest
    # would be noise in every subclass.
    def initialize(self) -> None:  # noqa: B027
        """Called once before the first event.  Override to set up strategy state."""

    def reset(self) -> None:
        """Clear all state.  Called between walk-forward windows and on session reset.

        A strategy whose ``reset`` leaves state behind will leak information across a
        walk-forward boundary, which quietly turns an out-of-sample test into an
        in-sample one.
        """
        self._signal_counter = 0

    # -- event handlers (override as needed) --------------------------------------------

    def on_quote(self, event: QuoteEvent, ctx: StrategyContext) -> list[Signal]:
        return []

    def on_trade(self, event: TradeEvent, ctx: StrategyContext) -> list[Signal]:
        return []

    def on_bar(self, event: BarEvent, ctx: StrategyContext) -> list[Signal]:
        return []

    def on_orderbook(self, event: OrderBookEvent, ctx: StrategyContext) -> list[Signal]:
        return []

    def on_fill(self, event: FillEvent, ctx: StrategyContext) -> None:  # noqa: B027
        """Notification that one of this strategy's orders executed.

        Returns nothing: a fill is information, not an opportunity to place another order
        synchronously.  React on the next event if a reaction is warranted.
        """

    @abstractmethod
    def generate_signal(self, ctx: StrategyContext) -> list[Signal]:
        """Core decision logic, called after features are updated.

        Must be pure with respect to the context: no I/O, no broker calls, no clock reads.
        Anything time-dependent comes from ``ctx.ts``, so a replay reproduces the run.
        """

    def validate_params(self, params: dict[str, Any]) -> None:  # noqa: B027
        """Validate this strategy's configuration block.

        Override to check required keys and ranges.  Called from ``__init__`` so a
        misconfiguration fails at startup, not at the first signal.
        """

    # -- helpers -----------------------------------------------------------------------

    def param(self, name: str, default: Any = None) -> Any:
        """Read a configured parameter.

        Raises:
            KeyError: when the parameter is absent and no default is given.  Defaulting
                silently would put a trading constant into the source file, which is
                exactly what ``configs/`` exists to prevent.
        """
        if name in self.config.params:
            return self.config.params[name]
        if default is not None:
            return default
        raise KeyError(
            f"strategy {self.config.strategy_id!r}: required parameter {name!r} is not "
            "configured; add it to strategies.yaml"
        )

    def score_confidence(self, observations: dict[str, float | None]) -> float:
        """Combine confirmation observations into a confidence in [0, 1].

        ``None`` marks a confirmation that could not be evaluated; it is excluded and the
        remaining weights renormalise, rather than being scored as neutral or zero.

        Without a configured scorer this returns ``0.5``: a strategy must still be usable
        in a bare unit test, and an unscored signal is neither endorsed nor penalised.
        Sizing is unaffected either way, because confidence can only scale size down
        within an envelope the risk engine has already approved.
        """
        if self.confidence_scorer is None:
            return 0.5
        return self.confidence_scorer.score(observations).value

    def next_signal_id(self, ts: Nanos) -> str:
        self._signal_counter += 1
        return f"sig-{self.config.strategy_id}-{ts}-{self._signal_counter:04d}"

    def make_signal(
        self,
        ctx: StrategyContext,
        direction: Side,
        intent: SignalIntent,
        entry: float,
        stop: float,
        target: float | None = None,
        entry_type: EntryType = EntryType.MARKETABLE_LIMIT,
        confidence: float = 0.5,
        reason_codes: tuple[str, ...] = (),
        features: dict[str, float] | None = None,
    ) -> Signal:
        """Construct a validated signal with tick-aligned prices.

        Prices are quantised to the instrument tick here so a strategy cannot emit a level
        that no venue can represent.  Geometry (stop on the losing side, target on the
        winning side) is validated by :class:`Signal` itself.

        Raises:
            SignalError: if the geometry is impossible after quantisation — for instance
                a stop that rounds onto the entry price, which would imply infinite size.
        """
        instrument = ctx.instrument
        entry_px = instrument.round_price(entry)
        stop_px = instrument.round_price(stop)
        target_px = instrument.round_price(target) if target is not None else None

        if entry_px == stop_px:
            raise SignalError(
                f"{self.config.strategy_id}: entry and stop both quantise to {entry_px} "
                f"at tick {instrument.tick_size}; the stop distance is zero"
            )

        return Signal(
            signal_id=self.next_signal_id(ctx.ts),
            strategy_id=self.config.strategy_id,
            instrument_id=instrument.instrument_id,
            direction=direction,
            intent=intent,
            ts=ctx.ts,
            entry_type=entry_type,
            suggested_entry=entry_px,
            suggested_stop=stop_px,
            suggested_target=target_px,
            confidence=confidence,
            regime=ctx.regime,
            features=dict(features or ctx.features.values),
            reason_codes=reason_codes,
        )

    def make_exit_signal(
        self,
        ctx: StrategyContext,
        reason_codes: tuple[str, ...] = (),
        confidence: float = 1.0,
    ) -> Signal:
        """Construct an exit for the current position.

        The direction is the *closing* side.  Exit signals carry a nominal stop one tick
        beyond the entry price purely to satisfy the signal schema; sizing for an exit is
        taken from the open position, not from the stop distance.
        """
        position = ctx.position
        if position.is_flat:
            raise SignalError(
                f"{self.config.strategy_id}: exit signal requested with no open position"
            )
        instrument = ctx.instrument
        closing_side = Side.SELL if position.is_long else Side.BUY
        reference = ctx.feature("mid") or position.avg_price
        entry_px = instrument.round_price(reference)
        offset = instrument.tick_size
        stop_px = entry_px - offset if closing_side is Side.BUY else entry_px + offset

        return Signal(
            signal_id=self.next_signal_id(ctx.ts),
            strategy_id=self.config.strategy_id,
            instrument_id=instrument.instrument_id,
            direction=closing_side,
            intent=SignalIntent.EXIT,
            ts=ctx.ts,
            entry_type=EntryType.MARKET,
            suggested_entry=entry_px,
            suggested_stop=stop_px,
            suggested_target=None,
            confidence=confidence,
            regime=ctx.regime,
            features=dict(ctx.features.values),
            reason_codes=reason_codes,
        )

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}(id={self.config.strategy_id!r}, "
            f"v{self.config.version}, instruments={list(self.config.instruments)})"
        )
