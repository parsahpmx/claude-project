"""Tripping the kill switch against a session that is actually trading.

Every other kill-switch test calls ``trip()`` and then submits. That proves the rule but
not the timing, and the timing is the claim being made: *no order is accepted after the
trip*. This drives a real submission loop on one thread and trips the switch from another,
then checks the two timelines against each other.

It is a concurrency test, so it is written to fail loudly rather than flakily: the assertion
is on ordering between recorded timestamps, not on how many orders happened to get through.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import pytest

from core.brokers.base import BrokerError, BrokerErrorCode, OrderRequest
from core.brokers.guard import GuardedBrokerAdapter, LocalHaltSource
from core.brokers.paper import PaperBrokerAdapter
from core.events import FillModel, OrderType, QuoteEvent, Side
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.instruments.registry import InstrumentRegistry
from core.risk.kill_switch import EmergencyPolicy, KillSwitch, Trigger
from core.util.clock import now_ns

INSTRUMENT = "CME:MES"


@dataclass(frozen=True, slots=True)
class Attempt:
    """One submission, and what the venue boundary did with it."""

    ts: int
    accepted: bool
    blocked_by_switch: bool


def _quote(ts: int) -> QuoteEvent:
    return QuoteEvent(
        INSTRUMENT, "CME", ts, ts, ts, 1, "TEST",
        bid=5100.00, ask=5100.25, bid_size=10, ask_size=10,
    )


def test_no_order_is_accepted_after_the_trip(
    registry: InstrumentRegistry, config_bundle
) -> None:
    """The claim: in-flight calls are the last ones.

    A submission that *started* before the trip may legitimately complete after it — that
    is what "in flight" means. What must never happen is a submission that *starts* after
    the trip and is accepted. The assertion is written that way round.
    """
    paper = PaperBrokerAdapter(
        instruments={i: registry.get(i) for i in registry.ids()},
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=0,
    )
    paper.connect()
    paper.advance(_quote(1_000_000_000))

    switch = KillSwitch(emergency_policy=EmergencyPolicy.HOLD)
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))

    attempts: list[Attempt] = []
    stop = threading.Event()
    started = threading.Event()

    def submit_forever() -> None:
        counter = 0
        while not stop.is_set():
            counter += 1
            request = OrderRequest(
                client_order_id=f"load-{counter}",
                instrument_id=INSTRUMENT,
                side=Side.BUY,
                quantity=1.0,
                order_type=OrderType.MARKET,
                strategy_id="load",
                ts_created=now_ns(),
            )
            # Stamped before the call, so an attempt that began before the trip and
            # finished after it is still attributed to before.
            began = now_ns()
            try:
                ack = guarded.submit_order(request)
                attempts.append(Attempt(began, ack.accepted, False))
            except BrokerError as exc:
                attempts.append(
                    Attempt(began, False, exc.code is BrokerErrorCode.KILL_SWITCH_ACTIVE)
                )
            started.set()
            time.sleep(0.001)

    worker = threading.Thread(target=submit_forever, name="submitter")
    worker.start()
    try:
        assert started.wait(timeout=5.0), "the submission loop never started"
        time.sleep(0.05)
        trip_ts = now_ns()
        switch.trip(Trigger.MANUAL, "halt under load")
        time.sleep(0.05)
    finally:
        stop.set()
        worker.join(timeout=5.0)
    assert not worker.is_alive()

    before = [a for a in attempts if a.ts < trip_ts]
    after = [a for a in attempts if a.ts >= trip_ts]

    assert before, "no orders were submitted before the trip; the test proved nothing"
    assert any(a.accepted for a in before), "the venue was refusing before the trip too"
    assert after, "no orders were attempted after the trip; the test proved nothing"

    accepted_after = [a for a in after if a.accepted]
    assert not accepted_after, (
        f"{len(accepted_after)} order(s) were accepted after the switch tripped"
    )
    assert all(a.blocked_by_switch for a in after), (
        "an order after the trip failed for a reason other than the kill switch"
    )
    # Not an equality. One submission can straddle the trip: it begins before (so it is
    # counted in `before` by its start stamp) and reads halt state after, so the guard
    # blocks it. That is the in-flight case working correctly, and asserting equality here
    # would make this test fail roughly whenever the timing lands that way.
    assert len(after) <= guarded.stats.blocked_submissions <= len(after) + 1


def test_the_guard_keeps_refusing_while_a_reset_is_refused(
    registry: InstrumentRegistry, config_bundle
) -> None:
    """A halt does not decay.

    The switch refuses a reset that comes too soon, and the guard must go on refusing for
    exactly as long — a boundary that quietly re-opened before the switch cleared would be
    the most dangerous kind of disagreement between two components.
    """
    paper = PaperBrokerAdapter(
        instruments={i: registry.get(i) for i in registry.ids()},
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=0,
    )
    paper.connect()
    paper.advance(_quote(1_000_000_000))

    switch = KillSwitch(min_trip_seconds=60.0)
    guarded = GuardedBrokerAdapter(paper, LocalHaltSource(switch))
    switch.trip(Trigger.MANUAL, "halt")

    with pytest.raises(ValueError, match="minimum"):
        switch.reset(operator="alice", reason="too soon", condition_cleared=True)

    request = OrderRequest(
        client_order_id="after-refused-reset",
        instrument_id=INSTRUMENT,
        side=Side.BUY,
        quantity=1.0,
        order_type=OrderType.MARKET,
        strategy_id="load",
        ts_created=now_ns(),
    )
    with pytest.raises(BrokerError) as caught:
        guarded.submit_order(request)
    assert caught.value.code is BrokerErrorCode.KILL_SWITCH_ACTIVE
