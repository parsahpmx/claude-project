"""Paper and shadow modes.

The property that matters: **only the adapter differs from live**. Shadow goes further —
it builds the real production order and stops it at the adapter boundary, recording what
would have happened.
"""

from __future__ import annotations

import pytest

from core.brokers.base import BrokerError, BrokerErrorCode, OrderRequest
from core.brokers.paper import PaperBrokerAdapter
from core.brokers.simulated import SimulatedBrokerAdapter
from core.events import ExecutionMode, FillModel, OrderType, QuoteEvent, Side, TradeEvent
from core.execution.costs import CostModel
from core.execution.fills import FillSimulator
from core.instruments.registry import InstrumentRegistry

TS = 1_700_000_000_000_000_000


def build(registry: InstrumentRegistry, config_bundle, shadow: bool) -> PaperBrokerAdapter:
    return PaperBrokerAdapter(
        instruments={i: registry.get(i) for i in registry.ids()},
        cost_model=CostModel.from_config(config_bundle["execution"]),
        fill_simulator=FillSimulator(FillModel.REALISTIC, seed=1),
        order_latency_ns=1_000_000,
        shadow=shadow,
    )


@pytest.fixture
def paper(registry: InstrumentRegistry, config_bundle) -> PaperBrokerAdapter:
    adapter = build(registry, config_bundle, shadow=False)
    adapter.connect()
    return adapter


@pytest.fixture
def shadow(registry: InstrumentRegistry, config_bundle) -> PaperBrokerAdapter:
    adapter = build(registry, config_bundle, shadow=True)
    adapter.connect()
    return adapter


def quote(ts: int = TS) -> QuoteEvent:
    return QuoteEvent("CME:MES", "CME", ts, ts, ts, 1, "LIVE",
                      bid=5100.00, ask=5100.25, bid_size=10, ask_size=10)


def order(cid: str = "c1", qty: float = 2.0) -> OrderRequest:
    return OrderRequest(cid, "CME:MES", Side.BUY, qty, OrderType.MARKET,
                        strategy_id="vwap", ts_created=TS)


class TestPaperMode:
    def test_mode_is_paper(self, paper: PaperBrokerAdapter) -> None:
        assert paper.mode is ExecutionMode.PAPER
        assert not paper.shadow

    def test_it_uses_the_same_matching_as_the_backtester(self, paper: PaperBrokerAdapter) -> None:
        """A paper result that disagreed with a backtest over the same data is useless."""
        assert isinstance(paper, SimulatedBrokerAdapter)

    def test_an_order_fills_against_the_live_feed(self, paper: PaperBrokerAdapter) -> None:
        paper.advance(quote())
        paper.submit_order(order())
        fills = paper.advance(
            TradeEvent("CME:MES", "CME", TS + 2_000_000, TS + 2_000_000, TS + 2_000_000,
                       2, "LIVE", price=5100.25, size=5.0)
        )
        assert fills
        assert paper.get_positions()["CME:MES"].quantity == 2.0

    def test_capabilities_match_the_simulated_adapter(
        self, paper: PaperBrokerAdapter, registry, config_bundle
    ) -> None:
        """Paper must not permit order types the intended live venue would refuse."""
        simulated = SimulatedBrokerAdapter(
            {i: registry.get(i) for i in registry.ids()},
            CostModel.from_config(config_bundle["execution"]),
        )
        assert paper.capabilities.order_types == simulated.capabilities.order_types
        assert paper.capabilities.time_in_force == simulated.capabilities.time_in_force


class TestShadowMode:
    def test_mode_is_shadow(self, shadow: PaperBrokerAdapter) -> None:
        assert shadow.mode is ExecutionMode.SHADOW
        assert shadow.shadow

    def test_an_order_is_recorded_and_never_filled(self, shadow: PaperBrokerAdapter) -> None:
        shadow.advance(quote())
        ack = shadow.submit_order(order())
        assert ack.accepted
        assert ack.reason == "SHADOW_RECORDED"
        fills = shadow.advance(
            TradeEvent("CME:MES", "CME", TS + 2_000_000, TS + 2_000_000, TS + 2_000_000,
                       2, "LIVE", price=5100.25, size=50.0)
        )
        assert fills == []

    def test_the_counterfactual_is_recorded(self, shadow: PaperBrokerAdapter) -> None:
        shadow.advance(quote())
        shadow.submit_order(order())
        records = shadow.shadow_records
        assert len(records) == 1
        record = records[0]
        assert record.instrument_id == "CME:MES"
        assert record.quantity == 2.0
        assert record.bid_at_decision == 5100.00
        assert record.ask_at_decision == 5100.25
        assert record.would_have_filled_at == 5100.25  # a buy crosses to the ask

    def test_no_position_is_ever_held(self, shadow: PaperBrokerAdapter) -> None:
        """Reporting a simulated position would diverge from the account being shadowed."""
        shadow.advance(quote())
        shadow.submit_order(order())
        shadow.advance(
            TradeEvent("CME:MES", "CME", TS + 5_000_000, TS + 5_000_000, TS + 5_000_000,
                       3, "LIVE", price=5100.25, size=50.0)
        )
        assert shadow.get_positions() == {}

    def test_equity_never_moves(self, shadow: PaperBrokerAdapter) -> None:
        shadow.advance(quote())
        before = shadow.get_account().equity
        shadow.submit_order(order())
        assert shadow.get_account().equity == before

    def test_a_replayed_order_id_records_once(self, shadow: PaperBrokerAdapter) -> None:
        """Double-counting would flatter the counterfactual in exactly the wrong direction."""
        shadow.advance(quote())
        first = shadow.submit_order(order())
        second = shadow.submit_order(order())
        assert second.broker_order_id == first.broker_order_id
        assert len(shadow.shadow_records) == 1

    def test_cancelling_an_unknown_order_still_raises(self, shadow: PaperBrokerAdapter) -> None:
        with pytest.raises(BrokerError) as exc:
            shadow.cancel_order("never-existed")
        assert exc.value.code is BrokerErrorCode.UNKNOWN_ORDER

    def test_flatten_all_is_a_no_op(self, shadow: PaperBrokerAdapter) -> None:
        shadow.flatten_all()
        assert shadow.get_positions() == {}


class TestLiveConnectionBehaviour:
    """The behaviour a live adapter has and a backtest adapter does not."""

    def test_a_quiet_feed_is_reported_as_unhealthy(
        self, registry: InstrumentRegistry, config_bundle
    ) -> None:
        """A live socket can be open while delivering nothing."""
        adapter = PaperBrokerAdapter(
            instruments={i: registry.get(i) for i in registry.ids()},
            cost_model=CostModel.from_config(config_bundle["execution"]),
            heartbeat_timeout_s=0.0,
        )
        adapter.connect()
        adapter.advance(quote())
        health = adapter.health_check()
        assert not health.connected
        assert "no market data" in health.message

    def test_a_live_feed_is_healthy(self, paper: PaperBrokerAdapter) -> None:
        paper.advance(quote())
        assert paper.health_check().is_healthy

    def test_health_before_any_data_says_so(self, paper: PaperBrokerAdapter) -> None:
        health = paper.health_check()
        assert health.connected
        assert "no market data yet" in health.message

    def test_disconnect_is_reported(self, paper: PaperBrokerAdapter) -> None:
        paper.disconnect()
        assert not paper.health_check().connected

    def test_submit_latency_is_measured(self, paper: PaperBrokerAdapter) -> None:
        paper.advance(quote())
        paper.submit_order(order())
        assert paper.health_check().latency_ms is not None
