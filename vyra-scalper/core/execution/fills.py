"""Fill models for simulated execution.

The central rule: **a limit order is never assumed to fill just because the price printed
at its level** (``BACKTEST_SPEC.md`` §5).  Under the realistic and conservative models a
resting order needs the market to trade *through* it, or to trade at it with enough volume
to clear the queue ahead.

Three models, increasingly pessimistic.  ``OPTIMISTIC`` exists for diagnosis and is
blocked from supporting a promotion decision — `FillModel.allowed_for_promotion` is
checked by the validation pipeline.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import assert_never

from core.events import FillModel, OrderType, QuoteEvent, Side, TradeEvent
from core.instruments.instrument import Instrument

__all__ = ["FillDecision", "FillSimulator", "MarketSnapshot"]


@dataclass(frozen=True, slots=True)
class MarketSnapshot:
    """The market state an order is matched against."""

    quote: QuoteEvent | None = None
    trade: TradeEvent | None = None
    atr: float | None = None
    recent_volume: float | None = None

    @property
    def bid(self) -> float | None:
        return self.quote.bid if self.quote and self.quote.bid > 0 else None

    @property
    def ask(self) -> float | None:
        return self.quote.ask if self.quote and self.quote.ask > 0 else None

    @property
    def spread(self) -> float | None:
        if self.quote is None or not self.quote.is_two_sided:
            return None
        return self.quote.spread

    @property
    def mid(self) -> float | None:
        if self.quote is None or not self.quote.is_two_sided:
            return None
        return self.quote.mid


@dataclass(frozen=True, slots=True)
class FillDecision:
    """Whether an order fills against this snapshot, and how."""

    filled: bool
    quantity: float = 0.0
    price: float = 0.0
    is_partial: bool = False
    crossed_spread: bool = True
    rejected: bool = False
    reason: str = ""

    @classmethod
    def no_fill(cls, reason: str = "") -> FillDecision:
        return cls(filled=False, reason=reason)

    @classmethod
    def reject(cls, reason: str) -> FillDecision:
        return cls(filled=False, rejected=True, reason=reason)


class FillSimulator:
    """Decides whether a resting or marketable order executes.

    Args:
        model: optimism level.
        queue_ratio: displayed volume required at a limit price, as a multiple of the
            order size, before a touch (without trade-through) fills.  Models the queue
            ahead of us.
        reject_rate: probability that a submission is rejected outright.  Real venues
            reject; a simulator that never does teaches a strategy that orders always
            arrive.
        partial_fill_probability: probability that an otherwise-complete fill is split.
        seed: makes every random decision reproducible.
    """

    __slots__ = ("_model", "_partial_probability", "_queue_ratio", "_reject_rate", "_rng")

    def __init__(
        self,
        model: FillModel = FillModel.REALISTIC,
        queue_ratio: float = 1.0,
        reject_rate: float = 0.0,
        partial_fill_probability: float = 0.0,
        seed: int = 0,
    ) -> None:
        if not 0 <= reject_rate <= 1:
            raise ValueError(f"reject_rate must be a probability, got {reject_rate}")
        if not 0 <= partial_fill_probability <= 1:
            raise ValueError(
                f"partial_fill_probability must be a probability, got {partial_fill_probability}"
            )
        if queue_ratio < 0:
            raise ValueError(f"queue_ratio must be non-negative, got {queue_ratio}")
        self._model = model
        self._queue_ratio = queue_ratio
        self._reject_rate = reject_rate
        self._partial_probability = partial_fill_probability
        self._rng = random.Random(seed)

    @property
    def model(self) -> FillModel:
        return self._model

    @property
    def rng(self) -> random.Random:
        return self._rng

    def should_reject(self, instrument: Instrument, snapshot: MarketSnapshot) -> str | None:
        """Whether a submission is rejected before it can rest or execute.

        Always rejects when the spread is beyond the instrument's configured maximum: a
        venue in that state is not one where an order behaves normally, and pretending
        otherwise is how a backtest earns money in conditions where it could not have
        traded.
        """
        spread = snapshot.spread
        if spread is not None and spread / instrument.tick_size > instrument.max_spread_ticks:
            return "SPREAD_BEYOND_LIMIT"
        if self._reject_rate > 0 and self._rng.random() < self._reject_rate:
            return "VENUE_REJECT"
        return None

    def match(
        self,
        instrument: Instrument,
        side: Side,
        order_type: OrderType,
        quantity: float,
        limit_price: float | None,
        stop_price: float | None,
        snapshot: MarketSnapshot,
    ) -> FillDecision:
        """Match one order against one market snapshot."""
        if quantity <= 0:
            return FillDecision.no_fill("ZERO_QUANTITY")

        if order_type is OrderType.MARKET:
            return self._match_market(instrument, side, quantity, snapshot)
        if order_type is OrderType.LIMIT:
            if limit_price is None:
                return FillDecision.reject("LIMIT_ORDER_WITHOUT_PRICE")
            return self._match_limit(instrument, side, quantity, limit_price, snapshot)
        if order_type in (OrderType.STOP, OrderType.STOP_LIMIT):
            if stop_price is None:
                return FillDecision.reject("STOP_ORDER_WITHOUT_PRICE")
            return self._match_stop(
                instrument, side, quantity, stop_price, limit_price, order_type, snapshot
            )
        # Every OrderType is handled above, so this is defensive: it fires only if a new
        # member is added without a matching branch here.  assert_never makes that a type
        # error at check time rather than a silent no-fill at run time.
        assert_never(order_type)

    # -- market orders ------------------------------------------------------------------

    def _match_market(
        self, instrument: Instrument, side: Side, quantity: float, snapshot: MarketSnapshot
    ) -> FillDecision:
        """A market order fills at the far touch, paying the spread."""
        touch = snapshot.ask if side is Side.BUY else snapshot.bid
        if touch is None:
            touch = snapshot.trade.price if snapshot.trade else None
        if touch is None:
            return FillDecision.no_fill("NO_MARKET_PRICE")

        filled_qty, is_partial = self._apply_partial(instrument, quantity, snapshot)
        return FillDecision(
            filled=True,
            quantity=filled_qty,
            price=instrument.round_price(touch),
            is_partial=is_partial,
            crossed_spread=True,
        )

    # -- limit orders -------------------------------------------------------------------

    def _match_limit(
        self,
        instrument: Instrument,
        side: Side,
        quantity: float,
        limit_price: float,
        snapshot: MarketSnapshot,
    ) -> FillDecision:
        """Match a resting limit order.

        A buy limit is marketable when the ask is at or below it, in which case it fills
        immediately at the better of the two prices and pays the spread.  Otherwise it
        rests, and whether it fills depends on the model.
        """
        touch = snapshot.ask if side is Side.BUY else snapshot.bid
        if touch is not None:
            marketable = (side is Side.BUY and touch <= limit_price) or (
                side is Side.SELL and touch >= limit_price
            )
            if marketable:
                filled_qty, is_partial = self._apply_partial(instrument, quantity, snapshot)
                return FillDecision(
                    filled=True,
                    quantity=filled_qty,
                    price=instrument.round_price(touch),
                    is_partial=is_partial,
                    crossed_spread=True,
                )

        trade = snapshot.trade
        if trade is None:
            return FillDecision.no_fill("RESTING_NO_TRADE")

        traded_through = (side is Side.BUY and trade.price < limit_price) or (
            side is Side.SELL and trade.price > limit_price
        )
        traded_at = trade.price == limit_price

        if self._model is FillModel.OPTIMISTIC:
            # Touching the level is enough.  This is the assumption the platform exists to
            # avoid relying on; it is available only for diagnosis.
            touched = traded_through or traded_at
            if not touched:
                return FillDecision.no_fill("NOT_TOUCHED")
            return FillDecision(
                filled=True, quantity=quantity, price=limit_price, crossed_spread=False
            )

        if self._model is FillModel.CONSERVATIVE:
            # Requires trade-through by at least a tick AND twice our size in volume.
            through_by_tick = (
                side is Side.BUY and trade.price <= limit_price - instrument.tick_size
            ) or (side is Side.SELL and trade.price >= limit_price + instrument.tick_size)
            if not through_by_tick or trade.size < 2.0 * quantity:
                return FillDecision.no_fill("INSUFFICIENT_TRADE_THROUGH")
            filled_qty, is_partial = self._apply_partial(instrument, quantity, snapshot, force_partial=True)
            return FillDecision(
                filled=True,
                quantity=filled_qty,
                price=limit_price,
                is_partial=is_partial,
                crossed_spread=False,
            )

        # REALISTIC: trade-through fills; a touch fills only if enough volume printed to
        # clear the queue ahead of us.
        if traded_through:
            filled_qty, is_partial = self._apply_partial(instrument, quantity, snapshot)
            return FillDecision(
                filled=True,
                quantity=filled_qty,
                price=limit_price,
                is_partial=is_partial,
                crossed_spread=False,
            )
        if traded_at and trade.size >= self._queue_ratio * quantity:
            filled_qty, is_partial = self._apply_partial(instrument, quantity, snapshot)
            return FillDecision(
                filled=True,
                quantity=filled_qty,
                price=limit_price,
                is_partial=is_partial,
                crossed_spread=False,
            )
        return FillDecision.no_fill("QUEUE_NOT_CLEARED")

    # -- stop orders --------------------------------------------------------------------

    def _match_stop(
        self,
        instrument: Instrument,
        side: Side,
        quantity: float,
        stop_price: float,
        limit_price: float | None,
        order_type: OrderType,
        snapshot: MarketSnapshot,
    ) -> FillDecision:
        """Match a stop, honouring gaps.

        When the market gaps through the stop, the fill is at the **gap price**, not at the
        stop price.  Filling at the stop is the single most common way a backtest
        manufactures money that a live account would never have seen.
        """
        reference = snapshot.trade.price if snapshot.trade else snapshot.mid
        if reference is None:
            return FillDecision.no_fill("NO_MARKET_PRICE")

        triggered = (side is Side.BUY and reference >= stop_price) or (
            side is Side.SELL and reference <= stop_price
        )
        if not triggered:
            return FillDecision.no_fill("STOP_NOT_TRIGGERED")

        if order_type is OrderType.STOP_LIMIT:
            if limit_price is None:
                return FillDecision.reject("STOP_LIMIT_WITHOUT_LIMIT_PRICE")
            return self._match_limit(instrument, side, quantity, limit_price, snapshot)

        touch = snapshot.ask if side is Side.BUY else snapshot.bid
        if self._model is FillModel.OPTIMISTIC:
            fill_price = stop_price
        else:
            # The worse of the stop and the market: a gap is paid for.
            candidates = [stop_price, reference]
            if touch is not None:
                candidates.append(touch)
            fill_price = max(candidates) if side is Side.BUY else min(candidates)

        filled_qty, is_partial = self._apply_partial(instrument, quantity, snapshot)
        return FillDecision(
            filled=True,
            quantity=filled_qty,
            price=instrument.round_price(fill_price),
            is_partial=is_partial,
            crossed_spread=True,
        )

    # -- partial fills ------------------------------------------------------------------

    def _apply_partial(
        self,
        instrument: Instrument,
        quantity: float,
        snapshot: MarketSnapshot,
        force_partial: bool = False,
    ) -> tuple[float, bool]:
        """Split a fill when available size is short, or by configured probability.

        Any partial is quantised to the instrument's quantity step, and a partial that
        rounds below the minimum becomes a full fill rather than an illegal one: a venue
        cannot execute 0.76 of a futures contract, and a simulator that reports one
        produces a position no broker could confirm.
        """
        if self._model is FillModel.OPTIMISTIC:
            return quantity, False

        def legalise(candidate: float) -> tuple[float, bool] | None:
            stepped = instrument.round_qty(candidate)
            if 0 < stepped < quantity:
                return stepped, True
            return None

        available = snapshot.trade.size if snapshot.trade else None
        if available is not None and 0 < available < quantity:
            legal = legalise(available)
            if legal is not None:
                return legal

        if force_partial or (
            self._partial_probability > 0 and self._rng.random() < self._partial_probability
        ):
            legal = legalise(quantity * self._rng.uniform(0.3, 0.9))
            if legal is not None:
                return legal
        return quantity, False
