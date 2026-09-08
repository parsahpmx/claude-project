"""Position reconciliation: the broker is truth, our book is a belief."""

from __future__ import annotations

import pytest

from core.brokers.base import BrokerError, BrokerErrorCode, BrokerPosition
from core.brokers.simulated import SimulatedBrokerAdapter
from core.execution.costs import CostModel
from core.instruments.registry import InstrumentRegistry
from core.portfolio.portfolio import Portfolio
from core.portfolio.reconciliation import (
    DivergenceKind,
    PositionReconciler,
    ReconciliationConfig,
)
from core.risk.kill_switch import EmergencyPolicy, KillSwitch, Trigger
from core.util.clock import NS_PER_SEC, from_iso

TS = from_iso("2024-03-05T15:00:00Z")


@pytest.fixture
def harness(registry: InstrumentRegistry, config_bundle):
    instruments = {i: registry.get(i) for i in registry.ids()}
    calendars = {i: registry.calendar(i) for i in registry.ids()}
    broker = SimulatedBrokerAdapter(instruments, CostModel.from_config(config_bundle["execution"]))
    broker.connect()
    portfolio = Portfolio(100_000.0, instruments, calendars)
    switch = KillSwitch(EmergencyPolicy.HOLD, min_trip_seconds=0)
    reconciler = PositionReconciler(
        broker, portfolio, instruments, switch,
        ReconciliationConfig.from_config(config_bundle["execution"].section("reconciliation")),
    )
    return reconciler, portfolio, broker, switch


def set_broker_position(broker: SimulatedBrokerAdapter, qty: float, avg: float = 5100.0) -> None:
    broker._positions["CME:MES"] = BrokerPosition("CME:MES", qty, avg)


def set_our_position(portfolio: Portfolio, qty: float, avg: float = 5100.0) -> None:
    position = portfolio.position("CME:MES")
    position.quantity = qty
    position.avg_price = avg


class TestAgreement:
    def test_both_flat_is_clean(self, harness) -> None:
        reconciler, _, _, switch = harness
        result = reconciler.reconcile(TS)
        assert result.is_clean
        assert not switch.is_tripped

    def test_matching_positions_are_clean(self, harness) -> None:
        reconciler, portfolio, broker, switch = harness
        set_our_position(portfolio, 5.0)
        set_broker_position(broker, 5.0)
        assert reconciler.reconcile(TS).is_clean
        assert not switch.is_tripped

    def test_a_price_difference_inside_tolerance_is_clean(self, harness) -> None:
        """A venue rounds and accrues differently; a tick of difference is expected."""
        reconciler, portfolio, broker, _ = harness
        set_our_position(portfolio, 5.0, avg=5100.00)
        set_broker_position(broker, 5.0, avg=5100.25)  # exactly one tick
        assert reconciler.reconcile(TS).is_clean


class TestCriticalDivergences:
    def test_a_position_we_do_not_know_about_trips_the_switch(self, harness) -> None:
        """The most dangerous case, and the one iterating only our own book would miss."""
        reconciler, _, broker, switch = harness
        set_broker_position(broker, 3.0)
        result = reconciler.reconcile(TS)
        assert not result.is_clean
        assert result.divergences[0].kind is DivergenceKind.UNKNOWN_POSITION
        assert result.tripped_kill_switch
        assert switch.trip_record is not None
        assert switch.trip_record.trigger is Trigger.UNKNOWN_POSITION

    def test_a_phantom_position_trips_the_switch(self, harness) -> None:
        reconciler, portfolio, _, switch = harness
        set_our_position(portfolio, 4.0)
        result = reconciler.reconcile(TS)
        assert result.divergences[0].kind is DivergenceKind.PHANTOM_POSITION
        assert switch.trip_record.trigger is Trigger.RECONCILIATION_FAILURE

    def test_a_quantity_mismatch_trips_the_switch(self, harness) -> None:
        reconciler, portfolio, broker, switch = harness
        set_our_position(portfolio, 5.0)
        set_broker_position(broker, 3.0)
        result = reconciler.reconcile(TS)
        divergence = result.divergences[0]
        assert divergence.kind is DivergenceKind.QTY_MISMATCH
        assert divergence.quantity_delta == -2.0
        assert switch.is_tripped

    def test_a_tripped_switch_blocks_new_entries(self, harness) -> None:
        reconciler, _, broker, switch = harness
        set_broker_position(broker, 3.0)
        reconciler.reconcile(TS)
        assert not switch.allows_new_entries()

    def test_an_average_price_mismatch_does_not_halt(self, harness) -> None:
        """Both sides agree the position exists; only the bookkeeping differs."""
        reconciler, portfolio, broker, switch = harness
        set_our_position(portfolio, 5.0, avg=5100.00)
        set_broker_position(broker, 5.0, avg=5150.00)
        result = reconciler.reconcile(TS)
        assert result.divergences[0].kind is DivergenceKind.AVG_PRICE_MISMATCH
        assert not result.tripped_kill_switch
        assert not switch.is_tripped


class TestAdoption:
    def test_the_broker_is_adopted_as_truth(self, harness) -> None:
        reconciler, portfolio, broker, _ = harness
        set_our_position(portfolio, 5.0)
        set_broker_position(broker, 3.0)
        reconciler.reconcile(TS)
        assert portfolio.position("CME:MES").quantity == 3.0

    def test_a_phantom_position_is_flattened_in_our_book(self, harness) -> None:
        reconciler, portfolio, _, _ = harness
        set_our_position(portfolio, 4.0)
        reconciler.reconcile(TS)
        assert portfolio.position("CME:MES").quantity == 0.0
        assert portfolio.position("CME:MES").avg_price == 0.0

    def test_an_unknown_position_is_adopted_not_ignored(self, harness) -> None:
        reconciler, portfolio, broker, _ = harness
        set_broker_position(broker, 3.0, avg=5105.0)
        reconciler.reconcile(TS)
        position = portfolio.position("CME:MES")
        assert position.quantity == 3.0
        assert position.avg_price == 5105.0

    def test_adoption_is_never_silent(self, harness) -> None:
        """Every overwrite emits an auditable risk event."""
        reconciler, portfolio, broker, _ = harness
        set_our_position(portfolio, 5.0)
        set_broker_position(broker, 3.0)
        result = reconciler.reconcile(TS)
        assert result.risk_events
        event = result.risk_events[0]
        assert event.kind == DivergenceKind.QTY_MISMATCH.value
        assert event.severity == "CRITICAL"
        assert event.is_halt

    def test_adoption_can_be_disabled(self, harness, registry, config_bundle) -> None:
        instruments = {i: registry.get(i) for i in registry.ids()}
        _, portfolio, broker, switch = harness
        reconciler = PositionReconciler(
            broker, portfolio, instruments, switch,
            ReconciliationConfig(adopt_broker_on_mismatch=False),
        )
        set_our_position(portfolio, 5.0)
        set_broker_position(broker, 3.0)
        reconciler.reconcile(TS)
        assert portfolio.position("CME:MES").quantity == 5.0  # left alone, but halted


class TestBrokerFailure:
    def test_a_failed_query_trips_the_switch(self, harness, monkeypatch) -> None:
        """We cannot verify what we own, so we stop."""
        reconciler, _, broker, switch = harness

        def boom() -> dict[str, BrokerPosition]:
            raise BrokerError(BrokerErrorCode.NOT_CONNECTED, "socket closed")

        monkeypatch.setattr(broker, "get_positions", boom)
        result = reconciler.reconcile(TS)
        assert result.error == "socket closed"
        assert result.tripped_kill_switch
        assert switch.trip_record.trigger is Trigger.RECONCILIATION_FAILURE

    def test_a_failed_query_does_not_raise_into_the_event_loop(self, harness, monkeypatch) -> None:
        reconciler, _, broker, _ = harness

        def boom() -> dict[str, BrokerPosition]:
            raise BrokerError(BrokerErrorCode.TIMEOUT, "timed out")

        monkeypatch.setattr(broker, "get_positions", boom)
        reconciler.reconcile(TS)  # must not raise


class TestScheduling:
    def test_the_first_run_is_always_due(self, harness) -> None:
        reconciler, _, _, _ = harness
        assert reconciler.is_due(TS)

    def test_not_due_before_the_interval_elapses(self, harness) -> None:
        reconciler, _, _, _ = harness
        reconciler.reconcile(TS)
        assert not reconciler.is_due(TS + 5 * NS_PER_SEC)

    def test_due_again_after_the_interval(self, harness) -> None:
        reconciler, _, _, _ = harness
        reconciler.reconcile(TS)
        interval = int(reconciler.config.interval_seconds * NS_PER_SEC)
        assert reconciler.is_due(TS + interval + 1)


class TestMultipleInstruments:
    def test_every_divergence_is_reported_not_just_the_first(self, harness) -> None:
        reconciler, portfolio, broker, _ = harness
        set_our_position(portfolio, 5.0)
        set_broker_position(broker, 3.0)
        broker._positions["CME:ES"] = BrokerPosition("CME:ES", 2.0, 5100.0)
        result = reconciler.reconcile(TS)
        kinds = {d.instrument_id: d.kind for d in result.divergences}
        assert kinds["CME:MES"] is DivergenceKind.QTY_MISMATCH
        assert kinds["CME:ES"] is DivergenceKind.UNKNOWN_POSITION
