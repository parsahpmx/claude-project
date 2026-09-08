"""The shared broker-adapter contract.

Every adapter — simulated, paper, and every live venue — must pass this suite
(``EXECUTION_SPEC.md`` §9). Adding an adapter means adding it to ``ADAPTERS`` here; an
adapter that cannot pass has not implemented the contract, whatever its own tests say.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from core.brokers.base import (
    BrokerAdapter,
    BrokerError,
    BrokerErrorCode,
    OrderAmendment,
    OrderRequest,
)
from core.brokers.paper import PaperBrokerAdapter
from core.brokers.simulated import SimulatedBrokerAdapter
from core.events import FillModel, OrderType, QuoteEvent, Side
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.instruments.registry import InstrumentRegistry


def build_simulated(registry: InstrumentRegistry, config_bundle) -> SimulatedBrokerAdapter:
    instruments = {i: registry.get(i) for i in registry.ids()}
    return SimulatedBrokerAdapter(
        instruments=instruments,
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=1_000_000,
    )


def build_paper(registry: InstrumentRegistry, config_bundle) -> PaperBrokerAdapter:
    instruments = {i: registry.get(i) for i in registry.ids()}
    return PaperBrokerAdapter(
        instruments=instruments,
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=1_000_000,
    )


def build_shadow(registry: InstrumentRegistry, config_bundle) -> PaperBrokerAdapter:
    instruments = {i: registry.get(i) for i in registry.ids()}
    return PaperBrokerAdapter(
        instruments=instruments,
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=1_000_000,
        shadow=True,
    )


# Every adapter must pass this suite -- simulated, paper, shadow, and every live venue when
# one is written. An adapter that cannot has not implemented the contract.
ADAPTERS: dict[str, Callable[..., BrokerAdapter]] = {
    "simulated": build_simulated,
    "paper": build_paper,
    "shadow": build_shadow,
}


@pytest.fixture(params=list(ADAPTERS), ids=list(ADAPTERS))
def adapter(request, registry: InstrumentRegistry, config_bundle) -> BrokerAdapter:
    return ADAPTERS[request.param](registry, config_bundle)


def quote(ts: int = 1_000_000_000) -> QuoteEvent:
    return QuoteEvent(
        "CME:MES", "CME", ts, ts, ts, 1, "TEST",
        bid=5100.00, ask=5100.25, bid_size=10, ask_size=10,
    )


def market_order(client_order_id: str = "c1", qty: float = 2.0) -> OrderRequest:
    return OrderRequest(
        client_order_id=client_order_id, instrument_id="CME:MES", side=Side.BUY,
        quantity=qty, order_type=OrderType.MARKET, strategy_id="test",
        ts_created=1_000_000_000,
    )


class TestConnectionLifecycle:
    def test_operations_before_connect_are_refused(self, adapter: BrokerAdapter) -> None:
        with pytest.raises(BrokerError) as exc:
            adapter.get_account()
        assert exc.value.code is BrokerErrorCode.NOT_CONNECTED

    def test_connect_then_health_reports_connected(self, adapter: BrokerAdapter) -> None:
        adapter.connect()
        health = adapter.health_check()
        assert health.connected and health.is_healthy

    def test_disconnect_is_reflected_in_health(self, adapter: BrokerAdapter) -> None:
        adapter.connect()
        adapter.disconnect()
        assert not adapter.health_check().connected


class TestCapabilities:
    def test_capabilities_are_declared_and_self_consistent(self, adapter: BrokerAdapter) -> None:
        capabilities = adapter.capabilities
        assert capabilities.order_types, "an adapter must support at least one order type"
        assert capabilities.time_in_force, "an adapter must support at least one TIF"

    def test_an_undeclared_order_type_is_rejected_not_silently_accepted(
        self, adapter: BrokerAdapter
    ) -> None:
        """Claiming an unsupported type is the contract violation this catches."""
        adapter.connect()
        capabilities = adapter.capabilities
        unsupported = next(
            (t for t in OrderType if t not in capabilities.order_types), None
        )
        if unsupported is None:
            pytest.skip("this adapter supports every order type")
        request = OrderRequest(
            client_order_id="u1", instrument_id="CME:MES", side=Side.BUY, quantity=1.0,
            order_type=unsupported,
            limit_price=5100.0 if unsupported is not OrderType.MARKET else None,
            stop_price=5100.0 if unsupported in (OrderType.STOP, OrderType.STOP_LIMIT) else None,
        )
        ack = adapter.submit_order(request)
        assert not ack.accepted
        assert ack.error_code is BrokerErrorCode.UNSUPPORTED_ORDER_TYPE


class TestOrderEntry:
    def test_a_valid_order_is_acknowledged_with_a_broker_id(
        self, adapter: BrokerAdapter
    ) -> None:
        adapter.connect()
        adapter.advance(quote())  # type: ignore[attr-defined]
        ack = adapter.submit_order(market_order())
        assert ack.accepted
        assert ack.broker_order_id

    def test_a_working_order_appears_in_get_orders(self, adapter: BrokerAdapter) -> None:
        adapter.connect()
        adapter.advance(quote())  # type: ignore[attr-defined]
        adapter.submit_order(market_order())
        if getattr(adapter, "shadow", False):
            # Shadow mode records the order and never rests it: nothing was sent, so the
            # venue has nothing to report.
            assert adapter.get_orders() == {}
            assert adapter.shadow_records  # type: ignore[attr-defined]
            return
        assert "c1" in adapter.get_orders()

    def test_resubmitting_the_same_client_order_id_does_not_duplicate(
        self, adapter: BrokerAdapter
    ) -> None:
        """The venue-side half of duplicate protection (EXECUTION_SPEC.md §4)."""
        adapter.connect()
        adapter.advance(quote())  # type: ignore[attr-defined]
        first = adapter.submit_order(market_order())
        second = adapter.submit_order(market_order())
        assert second.accepted
        assert second.broker_order_id == first.broker_order_id
        if not getattr(adapter, "shadow", False):
            assert len(adapter.get_orders()) == 1

    def test_cancelling_an_unknown_order_raises_a_normalised_error(
        self, adapter: BrokerAdapter
    ) -> None:
        adapter.connect()
        with pytest.raises(BrokerError) as exc:
            adapter.cancel_order("never-existed")
        assert exc.value.code is BrokerErrorCode.UNKNOWN_ORDER

    def test_replacing_an_unknown_order_raises(self, adapter: BrokerAdapter) -> None:
        adapter.connect()
        with pytest.raises(BrokerError) as exc:
            adapter.replace_order("never-existed", OrderAmendment(quantity=1.0))
        assert exc.value.code is BrokerErrorCode.UNKNOWN_ORDER


class TestFlatten:
    def test_flatten_all_is_safe_when_flat(self, adapter: BrokerAdapter) -> None:
        adapter.connect()
        adapter.flatten_all()
        adapter.flatten_all()  # repeated calls must be safe

    def test_flatten_all_is_safe_while_disconnected(self, adapter: BrokerAdapter) -> None:
        """It must not raise: it is called from the kill-switch path."""
        adapter.flatten_all()

    def test_flatten_position_on_a_flat_instrument_is_a_no_op(
        self, adapter: BrokerAdapter
    ) -> None:
        adapter.connect()
        adapter.flatten_position("CME:MES")
        assert not adapter.get_positions()


class TestErrorNormalisation:
    def test_every_error_carries_a_normalised_code(self, adapter: BrokerAdapter) -> None:
        """Vendor exceptions must not escape the adapter."""
        with pytest.raises(BrokerError) as exc:
            adapter.get_positions()
        assert isinstance(exc.value.code, BrokerErrorCode)

    def test_transient_and_terminal_errors_are_distinguished(self) -> None:
        assert BrokerErrorCode.THROTTLED.is_transient
        assert BrokerErrorCode.TIMEOUT.is_transient
        assert not BrokerErrorCode.INSUFFICIENT_MARGIN.is_transient
        assert not BrokerErrorCode.INVALID_CONTRACT.is_transient


class TestDepthHonesty:
    def test_an_adapter_without_depth_refuses_to_subscribe_silently(
        self, adapter: BrokerAdapter
    ) -> None:
        """Subscribing to nothing would leave a depth strategy on stale features."""
        if adapter.capabilities.supports_orderbook:
            pytest.skip("this adapter provides real depth")
        with pytest.raises(BrokerError):
            adapter.subscribe_orderbook(["CME:MES"])
