"""In-process matching engine used by the backtester and paper trading.

Orders submitted here do not leave the process.  They rest in a book, are matched against
the event stream by a :class:`~core.execution.fills.FillSimulator`, and produce
:class:`~core.events.trading.FillEvent` objects with realistic costs attached.

The property that makes the backtest meaningful: **an order submitted while processing
event *n* cannot be filled by event *n***.  It becomes eligible only at
``ts + order_latency``, so latency is a real constraint rather than a documented intention
(``BACKTEST_SPEC.md`` §2).
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from core.brokers.base import (
    AccountSnapshot,
    BrokerAdapter,
    BrokerCapabilities,
    BrokerError,
    BrokerErrorCode,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderAmendment,
    OrderRequest,
)
from core.events import (
    Event,
    FillEvent,
    FillModel,
    OrderType,
    QuoteEvent,
    Side,
    TimeInForce,
    TradeEvent,
)
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator, MarketSnapshot
from core.instruments.instrument import Instrument
from core.util.clock import Nanos
from core.util.logging import get_logger

__all__ = ["SimulatedBrokerAdapter", "WorkingOrder"]

_log = get_logger("brokers.simulated")


@dataclass(slots=True)
class WorkingOrder:
    """An order resting in the simulated book."""

    request: OrderRequest
    broker_order_id: str
    eligible_from_ns: Nanos
    filled_qty: float = 0.0
    expires_at_ns: Nanos = 0
    decision_price: float | None = None
    expected_price: float | None = None
    cancel_pending_from_ns: Nanos = 0

    @property
    def remaining(self) -> float:
        return max(0.0, self.request.quantity - self.filled_qty)

    def is_eligible(self, ts: Nanos) -> bool:
        """Whether the venue could have acted on this order by ``ts``."""
        return ts >= self.eligible_from_ns


class SimulatedBrokerAdapter(BrokerAdapter):
    """Deterministic matching engine.

    Args:
        instruments: instruments that may be traded.
        cost_model: commission, fees, slippage and impact.
        fill_simulator: how optimistic the matching is.
        starting_equity: for the account snapshot.
        order_latency_ns: delay between submission and venue eligibility.
        seed: makes every stochastic decision reproducible.
    """

    def __init__(
        self,
        instruments: dict[str, Instrument],
        cost_model: CostModel,
        fill_simulator: FillSimulator | None = None,
        starting_equity: float = 100_000.0,
        order_latency_ns: int = 1_500_000,
        cancel_latency_ns: int = 1_500_000,
        seed: int = 0,
        broker_id: str = "simulated",
    ) -> None:
        self._instruments = instruments
        self._cost_model = cost_model
        self._fills = fill_simulator or FillSimulator(FillModel.REALISTIC, seed=seed)
        self._starting_equity = starting_equity
        self._order_latency_ns = order_latency_ns
        self._cancel_latency_ns = cancel_latency_ns
        self._rng = random.Random(seed)
        self._broker_id = broker_id

        self._connected = False
        self._working: dict[str, WorkingOrder] = {}
        self._positions: dict[str, BrokerPosition] = {}
        self._quotes: dict[str, QuoteEvent] = {}
        self._order_counter = 0
        self._fill_counter = 0
        self._now: Nanos = 0
        self._realized_pnl = 0.0
        self._fees_paid = 0.0
        self._rejected_ids: dict[str, str] = {}
        # Every client order id ever accepted, retained after the order reaches a terminal
        # state.  Real venues deduplicate for at least a trading day; a registry that
        # forgets an id as soon as the order fills would let a replayed submission open a
        # second position, which is the failure EXECUTION_SPEC.md §4 exists to prevent.
        self._accepted_ids: dict[str, str] = {}

    # -- identity -----------------------------------------------------------------------

    @property
    def broker_id(self) -> str:
        return self._broker_id

    @property
    def capabilities(self) -> BrokerCapabilities:
        return BrokerCapabilities(
            order_types=frozenset(
                {OrderType.MARKET, OrderType.LIMIT, OrderType.STOP, OrderType.STOP_LIMIT}
            ),
            time_in_force=frozenset(
                {TimeInForce.DAY, TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK}
            ),
            native_cancel_replace=True,
            fractional_qty=True,
            supports_orderbook=False,
        )

    # -- lifecycle ----------------------------------------------------------------------

    def connect(self) -> None:
        self._connected = True
        _log.info("simulated_broker_connected", broker=self._broker_id)

    def disconnect(self) -> None:
        self._connected = False
        _log.info("simulated_broker_disconnected", broker=self._broker_id)

    def health_check(self) -> BrokerHealth:
        return BrokerHealth(connected=self._connected, ts=self._now, latency_ms=0.0)

    def _require_connected(self) -> None:
        if not self._connected:
            raise BrokerError(BrokerErrorCode.NOT_CONNECTED, "simulated broker is not connected")

    # -- account and positions ----------------------------------------------------------

    def get_account(self) -> AccountSnapshot:
        self._require_connected()
        unrealized = sum(p.unrealized_pnl for p in self._positions.values())
        equity = self._starting_equity + self._realized_pnl + unrealized - self._fees_paid
        return AccountSnapshot(
            account_id=f"SIM-{self._broker_id}",
            equity=equity,
            cash=equity,
            currency="USD",
            ts=self._now,
        )

    def get_positions(self) -> dict[str, BrokerPosition]:
        self._require_connected()
        return {k: v for k, v in self._positions.items() if not v.is_flat}

    def get_orders(self) -> dict[str, OrderRequest]:
        self._require_connected()
        return {cid: order.request for cid, order in self._working.items()}

    # -- order entry --------------------------------------------------------------------

    def submit_order(self, request: OrderRequest) -> OrderAck:
        """Accept an order into the book, eligible only after the order latency.

        Idempotent on ``client_order_id``: a resubmission of an id already working is
        acknowledged with the existing broker id rather than creating a second order.
        That is the venue-side half of the duplicate protection in
        ``EXECUTION_SPEC.md`` §4.
        """
        self._require_connected()

        known_broker_id = self._accepted_ids.get(request.client_order_id)
        if known_broker_id is not None:
            still_working = request.client_order_id in self._working
            _log.warning(
                "duplicate_client_order_id",
                client_order_id=request.client_order_id,
                broker_order_id=known_broker_id,
                still_working=still_working,
            )
            return OrderAck(
                client_order_id=request.client_order_id,
                broker_order_id=known_broker_id,
                accepted=True,
                ts=self._now,
                reason="IDEMPOTENT_REPLAY",
            )

        instrument = self._instruments.get(request.instrument_id)
        if instrument is None:
            return self._reject(request, BrokerErrorCode.INVALID_CONTRACT, "unknown instrument")

        if not self.capabilities.supports(request.order_type, request.time_in_force):
            return self._reject(
                request,
                BrokerErrorCode.UNSUPPORTED_ORDER_TYPE,
                f"{request.order_type.value}/{request.time_in_force.value} not supported",
            )

        snapshot = MarketSnapshot(quote=self._quotes.get(request.instrument_id))
        rejection = self._fills.should_reject(instrument, snapshot)
        if rejection is not None:
            return self._reject(request, BrokerErrorCode.VENUE_REJECT, rejection)

        self._order_counter += 1
        broker_order_id = f"SIM-{self._order_counter:08d}"
        self._accepted_ids[request.client_order_id] = broker_order_id
        self._working[request.client_order_id] = WorkingOrder(
            request=request,
            broker_order_id=broker_order_id,
            eligible_from_ns=self._now + self._order_latency_ns,
            decision_price=snapshot.mid,
            expected_price=self._expected_price(instrument, request, snapshot),
        )
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id=broker_order_id,
            accepted=True,
            ts=self._now,
        )

    def _expected_price(
        self, instrument: Instrument, request: OrderRequest, snapshot: MarketSnapshot
    ) -> float | None:
        """The model's prediction at submission, for slippage-vs-expected measurement.

        Comparing this with the realised fill is what reveals an optimistic simulator
        before it costs real money (``EXECUTION_SPEC.md`` §8).
        """
        if request.order_type is OrderType.LIMIT and request.limit_price is not None:
            return request.limit_price
        if request.order_type in (OrderType.STOP, OrderType.STOP_LIMIT):
            return request.stop_price
        touch = snapshot.ask if request.side is Side.BUY else snapshot.bid
        return touch if touch is not None else snapshot.mid

    def _reject(
        self, request: OrderRequest, code: BrokerErrorCode, reason: str
    ) -> OrderAck:
        self._rejected_ids[request.client_order_id] = reason
        _log.info(
            "simulated_order_rejected",
            client_order_id=request.client_order_id,
            instrument=request.instrument_id,
            reason=reason,
            error_code=code.value,
        )
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id="",
            accepted=False,
            ts=self._now,
            reason=reason,
            error_code=code,
        )

    def cancel_order(self, client_order_id: str) -> None:
        """Request a cancel.  It takes effect after the cancel latency.

        Modelling the delay matters: an order can still fill in the window between the
        cancel request and the venue acting on it, and a simulator that cancels instantly
        would let a strategy retract orders it could not really have retracted.
        """
        self._require_connected()
        order = self._working.get(client_order_id)
        if order is None:
            raise BrokerError(
                BrokerErrorCode.UNKNOWN_ORDER, f"no working order {client_order_id!r}"
            )
        order.cancel_pending_from_ns = self._now + self._cancel_latency_ns

    def replace_order(self, client_order_id: str, changes: OrderAmendment) -> OrderAck:
        self._require_connected()
        order = self._working.get(client_order_id)
        if order is None:
            raise BrokerError(
                BrokerErrorCode.UNKNOWN_ORDER, f"no working order {client_order_id!r}"
            )
        from dataclasses import replace as dc_replace

        updates: dict[str, float] = {}
        if changes.quantity is not None:
            if changes.quantity <= order.filled_qty:
                raise BrokerError(
                    BrokerErrorCode.INVALID_ORDER,
                    f"cannot reduce quantity to {changes.quantity} below filled "
                    f"{order.filled_qty}",
                )
            updates["quantity"] = changes.quantity
        if changes.limit_price is not None:
            updates["limit_price"] = changes.limit_price
        if changes.stop_price is not None:
            updates["stop_price"] = changes.stop_price

        order.request = dc_replace(order.request, **updates)  # type: ignore[arg-type]
        # A replace loses queue priority at every real venue, so eligibility resets.
        order.eligible_from_ns = self._now + self._order_latency_ns
        return OrderAck(
            client_order_id=client_order_id,
            broker_order_id=order.broker_order_id,
            accepted=True,
            ts=self._now,
        )

    def flatten_position(self, instrument_id: str) -> None:
        """Submit a market order closing the position, if there is one."""
        position = self._positions.get(instrument_id)
        if position is None or position.is_flat:
            return
        side = Side.SELL if position.quantity > 0 else Side.BUY
        self.submit_order(
            OrderRequest(
                client_order_id=f"FLATTEN-{instrument_id}-{self._now}",
                instrument_id=instrument_id,
                side=side,
                quantity=abs(position.quantity),
                order_type=OrderType.MARKET,
                ts_created=self._now,
            )
        )

    def flatten_all(self) -> None:
        """Close everything.  Safe to call repeatedly and while disconnected."""
        if not self._connected:
            _log.warning("flatten_all_while_disconnected", broker=self._broker_id)
            return
        for instrument_id in list(self._positions):
            self.flatten_position(instrument_id)

    # -- matching -----------------------------------------------------------------------

    def advance(self, event: Event) -> list[FillEvent]:
        """Advance the clock and match working orders against ``event``.

        Returns every fill produced.  Called by the backtest loop after the strategy has
        seen the event, so an order created from this event cannot be matched by it.
        """
        self._now = max(self._now, event.ts)
        if isinstance(event, QuoteEvent):
            self._quotes[event.instrument_id] = event
            self._mark(event.instrument_id, event.mid)

        fills: list[FillEvent] = []
        for client_order_id in list(self._working):
            order = self._working.get(client_order_id)
            if order is None or order.request.instrument_id != event.instrument_id:
                continue

            if order.cancel_pending_from_ns and self._now >= order.cancel_pending_from_ns:
                del self._working[client_order_id]
                continue
            if not order.is_eligible(self._now):
                continue

            fill = self._try_fill(order, event)
            if fill is not None:
                fills.append(fill)
                if order.remaining <= 0:
                    self._working.pop(client_order_id, None)
                elif order.request.time_in_force in (TimeInForce.IOC, TimeInForce.FOK):
                    # IOC and FOK do not rest: whatever did not fill is cancelled.
                    self._working.pop(client_order_id, None)
        return fills

    def _try_fill(self, order: WorkingOrder, event: Event) -> FillEvent | None:
        request = order.request
        instrument = self._instruments[request.instrument_id]
        snapshot = MarketSnapshot(
            quote=self._quotes.get(request.instrument_id),
            trade=event if isinstance(event, TradeEvent) else None,
        )

        decision = self._fills.match(
            instrument=instrument,
            side=request.side,
            order_type=request.order_type,
            quantity=order.remaining,
            limit_price=request.limit_price,
            stop_price=request.stop_price,
            snapshot=snapshot,
        )
        if not decision.filled or decision.quantity <= 0:
            return None

        cost = self._cost_model.compute(
            instrument=instrument,
            quantity=decision.quantity,
            fill_price=decision.price,
            spread=snapshot.spread,
            crossed_spread=decision.crossed_spread,
            reference_volume=snapshot.trade.size if snapshot.trade else None,
            rng=self._rng,
        )

        # Slippage is charged as a worse fill price rather than as a separate fee, which is
        # how it is actually experienced: the position is opened at a different level.
        slip_direction = request.side.sign
        fill_price = instrument.round_price(
            decision.price + slip_direction * cost.slippage_ticks * instrument.tick_size
        )

        order.filled_qty += decision.quantity
        self._apply_to_position(instrument, request.side, decision.quantity, fill_price)
        self._fees_paid += cost.explicit

        self._fill_counter += 1
        return FillEvent(
            instrument_id=request.instrument_id,
            exchange=instrument.exchange,
            ts_exchange=self._now,
            ts_receive=self._now,
            ts_processed=self._now,
            sequence_id=self._fill_counter,
            source=f"SIM:{self._broker_id}",
            fill_id=f"fill-{self._fill_counter:08d}",
            order_id=request.client_order_id,
            client_order_id=request.client_order_id,
            broker_fill_id=order.broker_order_id,
            strategy_id=request.strategy_id,
            side=request.side,
            quantity=decision.quantity,
            price=fill_price,
            commission=cost.commission,
            exchange_fees=cost.exchange_fees,
            is_partial=order.remaining > 0,
            liquidity_flag="TAKER" if decision.crossed_spread else "MAKER",
            expected_price=order.expected_price,
            decision_price=order.decision_price,
            spread_at_fill=snapshot.spread,
            ts_fill=self._now,
        )

    def _apply_to_position(
        self, instrument: Instrument, side: Side, quantity: float, price: float
    ) -> None:
        """Update the venue's view of the position, using average-price accounting."""
        instrument_id = instrument.instrument_id
        current = self._positions.get(
            instrument_id, BrokerPosition(instrument_id, 0.0, 0.0)
        )
        signed = quantity * side.sign
        new_qty = current.quantity + signed

        if current.quantity == 0:
            avg_price = price
        elif (current.quantity > 0) == (signed > 0):
            avg_price = (
                current.avg_price * abs(current.quantity) + price * quantity
            ) / abs(new_qty)
        else:
            closing = min(quantity, abs(current.quantity))
            sign = 1 if current.quantity > 0 else -1
            self._realized_pnl += instrument.pnl(current.avg_price, price, closing, sign)
            avg_price = price if abs(new_qty) > 0 and (new_qty > 0) != (current.quantity > 0) else current.avg_price

        if abs(new_qty) < 1e-12:
            new_qty, avg_price = 0.0, 0.0

        self._positions[instrument_id] = BrokerPosition(
            instrument_id=instrument_id,
            quantity=new_qty,
            avg_price=avg_price,
            realized_pnl=current.realized_pnl,
        )

    def _mark(self, instrument_id: str, price: float) -> None:
        position = self._positions.get(instrument_id)
        if position is None or position.is_flat or price <= 0:
            return
        instrument = self._instruments[instrument_id]
        sign = 1 if position.quantity > 0 else -1
        unrealized = instrument.pnl(position.avg_price, price, abs(position.quantity), sign)
        self._positions[instrument_id] = BrokerPosition(
            instrument_id=position.instrument_id,
            quantity=position.quantity,
            avg_price=position.avg_price,
            unrealized_pnl=unrealized,
            realized_pnl=position.realized_pnl,
        )

    # -- market data --------------------------------------------------------------------

    def subscribe_quotes(self, instrument_ids: list[str]) -> None:
        """No-op: the simulated broker is fed by the backtest event stream."""

    def subscribe_trades(self, instrument_ids: list[str]) -> None:
        """No-op: see :meth:`subscribe_quotes`."""

    def subscribe_account_updates(self) -> None:
        """No-op: account state is queried directly."""

    def is_known_order(self, client_order_id: str) -> bool:
        """Whether this id was ever accepted, working or terminal.

        Queried by the execution engine before retrying an ambiguous submission, so a
        timeout that actually arrived is never resubmitted blind.
        """
        return client_order_id in self._accepted_ids

    @property
    def working_orders(self) -> dict[str, WorkingOrder]:
        return dict(self._working)

    @property
    def now(self) -> Nanos:
        return self._now
