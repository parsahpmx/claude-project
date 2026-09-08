"""The kill switch at the venue boundary.

The rule under test is not "the guard blocks orders" but a narrower pair: an order that can
*open or increase* exposure is refused while halted, and everything that *reduces* exposure
is not. A guard that blocked cancels would make tripping the switch more dangerous than
leaving it armed.

The most important test here is the one where the halt source raises. A guard that fails
open in that case is worse than no guard: it reports protection it is not providing.
"""

from __future__ import annotations

import pytest

from core.brokers.base import (
    BrokerError,
    BrokerErrorCode,
    OrderRequest,
)
from core.brokers.guard import GuardedBrokerAdapter, LocalHaltSource
from core.brokers.paper import PaperBrokerAdapter
from core.events import FillModel, OrderType, QuoteEvent, Side
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.instruments.registry import InstrumentRegistry
from core.risk.kill_switch import EmergencyPolicy, KillSwitch, Trigger

INSTRUMENT = "CME:MES"


@pytest.fixture
def paper(registry: InstrumentRegistry, config_bundle) -> PaperBrokerAdapter:
    adapter = PaperBrokerAdapter(
        instruments={i: registry.get(i) for i in registry.ids()},
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=1_000_000,
    )
    adapter.connect()
    return adapter


def order(client_order_id: str = "c1", reduce_only: bool = False) -> OrderRequest:
    return OrderRequest(
        client_order_id=client_order_id,
        instrument_id=INSTRUMENT,
        side=Side.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
        strategy_id="test",
        ts_created=1_000_000_000,
        reduce_only=reduce_only,
    )


def quote(ts: int = 1_000_000_000) -> QuoteEvent:
    return QuoteEvent(
        INSTRUMENT, "CME", ts, ts, ts, 1, "TEST",
        bid=5100.00, ask=5100.25, bid_size=10, ask_size=10,
    )


class ExplodingSource:
    """A halt source that cannot answer — a dead cache, a corrupt file, a network split."""

    description = "exploding source"

    def is_halted(self) -> bool:
        raise ConnectionError("halt state store is unreachable")

    def allows_risk_reducing_exit(self) -> bool:
        raise ConnectionError("halt state store is unreachable")


# --------------------------------------------------------------------------------------
# The rule
# --------------------------------------------------------------------------------------


def test_an_armed_switch_lets_orders_through(paper: PaperBrokerAdapter) -> None:
    switch = KillSwitch()
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    paper.advance(quote())
    ack = guarded.submit_order(order())
    assert ack.accepted
    assert guarded.stats.passed == 1
    assert guarded.stats.blocked_submissions == 0


def test_a_tripped_switch_refuses_an_entry(paper: PaperBrokerAdapter) -> None:
    switch = KillSwitch()
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    paper.advance(quote())
    switch.trip(Trigger.MANUAL, "test")

    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(order())
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE
    assert guarded.stats.blocked_submissions == 1


def test_the_refusal_is_never_retried(paper: PaperBrokerAdapter) -> None:
    """The one error a retry must not eventually get past."""
    assert not BrokerErrorCode.KILL_SWITCH_ACTIVE.is_transient


def test_a_reduce_only_order_passes_under_a_flattening_policy(
    paper: PaperBrokerAdapter,
) -> None:
    switch = KillSwitch(emergency_policy=EmergencyPolicy.FLATTEN_IMMEDIATELY)
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    paper.advance(quote())
    switch.trip(Trigger.MANUAL, "test")

    ack = guarded.submit_order(order(reduce_only=True))
    assert ack.accepted, "a flattening policy must be able to flatten"


def test_a_reduce_only_order_is_refused_under_hold(paper: PaperBrokerAdapter) -> None:
    """HOLD says do nothing, usually because execution itself is unreliable."""
    switch = KillSwitch(emergency_policy=EmergencyPolicy.HOLD)
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    paper.advance(quote())
    switch.trip(Trigger.MANUAL, "test")

    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(order(reduce_only=True))
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE
    assert guarded.stats.blocked_reduce_only == 1


def test_an_order_of_unstated_intent_is_treated_as_an_entry(
    paper: PaperBrokerAdapter,
) -> None:
    """The default must be the refusing side.

    ``reduce_only`` defaults to False, so a caller that forgets to set it gets the strict
    treatment rather than an accidental exemption.
    """
    assert OrderRequest(
        client_order_id="c",
        instrument_id=INSTRUMENT,
        side=Side.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
    ).reduce_only is False


def test_replace_is_refused_while_halted(paper: PaperBrokerAdapter) -> None:
    """A replace can raise quantity; the guard cannot see the resting order to tell."""
    from core.brokers.base import OrderAmendment

    switch = KillSwitch()
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    paper.advance(quote())
    switch.trip(Trigger.MANUAL, "test")

    with pytest.raises(BrokerError) as caught:
        guarded.replace_order("c1", OrderAmendment(quantity=5.0))
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE


# --------------------------------------------------------------------------------------
# What a halt must never block
# --------------------------------------------------------------------------------------


def test_cancel_and_flatten_survive_a_halt(paper: PaperBrokerAdapter) -> None:
    """Reducing exposure is always permitted.

    A switch that stranded open positions at a venue would make tripping it the more
    dangerous choice, and an operator who learns that stops tripping it.
    """
    switch = KillSwitch()
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    paper.advance(quote())
    guarded.submit_order(order("c1"))
    switch.trip(Trigger.MANUAL, "test")

    guarded.cancel_order("c1")  # must not raise
    guarded.flatten_position(INSTRUMENT)
    guarded.flatten_all()


def test_reads_survive_a_halt(paper: PaperBrokerAdapter) -> None:
    """An operator investigating a halt needs to see account and position state."""
    switch = KillSwitch()
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    switch.trip(Trigger.MANUAL, "test")

    assert guarded.get_account().account_id
    assert guarded.get_positions() == {}
    assert guarded.health_check().connected


# --------------------------------------------------------------------------------------
# Failing closed
# --------------------------------------------------------------------------------------


def test_an_unreadable_halt_source_blocks_entries(paper: PaperBrokerAdapter) -> None:
    """The test that matters most.

    A guard that failed open here would report protection it is not providing — worse than
    no guard, because someone would rely on it.
    """
    guarded = GuardedBrokerAdapter(paper, ExplodingSource())
    paper.advance(quote())

    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(order())
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE
    assert guarded.stats.read_failures == 1


def test_an_unreadable_halt_source_blocks_even_exits(paper: PaperBrokerAdapter) -> None:
    """If the switch cannot be read, the emergency policy cannot be read either.

    Sending flattening orders on the assumption that the policy permits them would be
    guessing, and guessing with orders is the thing the switch exists to stop.
    """
    guarded = GuardedBrokerAdapter(paper, ExplodingSource())
    paper.advance(quote())

    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(order(reduce_only=True))
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE


def test_an_unreadable_halt_source_still_allows_cancellation(
    paper: PaperBrokerAdapter,
) -> None:
    """Cancelling needs no permission from a store that is down."""
    switch_backed = GuardedBrokerAdapter(paper, LocalHaltSource(KillSwitch()))
    paper.advance(quote())
    switch_backed.submit_order(order("c1"))

    guarded = GuardedBrokerAdapter(paper, ExplodingSource())
    guarded.cancel_order("c1")
    guarded.flatten_all()


def test_a_source_whose_description_raises_does_not_break_the_refusal(
    paper: PaperBrokerAdapter,
) -> None:
    """The refusal path must not itself throw. It runs when things are already wrong."""

    class NoDescription:
        def is_halted(self) -> bool:
            return True

        def allows_risk_reducing_exit(self) -> bool:
            return False

        @property
        def description(self) -> str:
            raise RuntimeError("no description available")

    guarded = GuardedBrokerAdapter(paper, NoDescription())
    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(order())
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE


# --------------------------------------------------------------------------------------
# Structure
# --------------------------------------------------------------------------------------


def test_the_guard_forwards_no_unknown_attribute(paper: PaperBrokerAdapter) -> None:
    """No ``__getattr__`` catch-all.

    A delegating wrapper that forwarded unknown attributes would forward the next outbound
    method someone adds to an adapter, silently un-guarding it. Every forward is written
    out, so adding an abstract method to the contract breaks construction of the guard
    until somebody decides whether a halt should block it.
    """
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(KillSwitch()))
    assert hasattr(paper, "advance")
    assert not hasattr(guarded, "advance")
