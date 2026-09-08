"""Order book microstructure, and the CFD boundary it enforces."""

from __future__ import annotations

import pytest

from core.events import Aggressor, OrderBookEvent, TradeEvent
from core.instruments.instrument import Instrument
from core.market_data.orderbook import DepthNamespace, OrderBookEngine
from core.util.clock import NS_PER_SEC

TS = 1_700_000_000_000_000_000


def book(
    instrument: Instrument,
    bids: list[tuple[float, float]],
    asks: list[tuple[float, float]],
    ts: int = TS,
) -> OrderBookEvent:
    return OrderBookEvent(
        instrument.instrument_id, instrument.exchange, ts, ts, ts, 1, "TEST",
        bids=tuple(bids), asks=tuple(asks),
    )


def trade(
    instrument: Instrument, price: float, size: float,
    aggressor: Aggressor = Aggressor.BUY, ts: int = TS, seq: int = 1,
) -> TradeEvent:
    return TradeEvent(
        instrument.instrument_id, instrument.exchange, ts, ts, ts, seq, "TEST",
        price=price, size=size, aggressor=aggressor,
    )


class TestCfdBoundary:
    """A broker CFD book is that broker's quoting, not centralised market liquidity."""

    def test_an_exchange_instrument_gets_the_exchange_namespace(self, mes: Instrument) -> None:
        assert OrderBookEngine(mes).namespace == DepthNamespace.EXCHANGE

    def test_a_cfd_instrument_gets_the_cfd_namespace(self, xauusd: Instrument) -> None:
        assert OrderBookEngine(xauusd).namespace == DepthNamespace.CFD

    def test_every_feature_carries_its_namespace(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)]))
        features = engine.features()
        assert features
        assert all(key.startswith("exch.") for key in features)

    def test_cfd_features_are_namespaced_separately(self, xauusd: Instrument) -> None:
        engine = OrderBookEngine(xauusd)
        engine.on_book(book(xauusd, [(2050.00, 10)], [(2050.50, 10)]))
        assert all(key.startswith("cfd.") for key in engine.features())

    def test_requesting_the_wrong_namespace_raises(self, mes: Instrument) -> None:
        """This is what stops a microstructure strategy consuming a dealer's spread policy."""
        engine = OrderBookEngine(mes)
        engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)]))
        with pytest.raises(ValueError, match="not centralised market liquidity"):
            engine.features(DepthNamespace.CFD)

    def test_requesting_the_matching_namespace_succeeds(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)]))
        assert engine.features(DepthNamespace.EXCHANGE)

    def test_the_two_namespaces_never_share_a_key(
        self, mes: Instrument, xauusd: Instrument
    ) -> None:
        exchange = OrderBookEngine(mes)
        exchange.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)]))
        cfd = OrderBookEngine(xauusd)
        cfd.on_book(book(xauusd, [(2050.00, 10)], [(2050.50, 10)]))
        assert not set(exchange.features()) & set(cfd.features())


class TestDerivedQuantities:
    def test_spread_mid_and_microprice(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        snapshot = engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 30)]))
        assert snapshot is not None
        assert snapshot.spread == pytest.approx(0.25)
        assert snapshot.mid == pytest.approx(5100.125)
        # More size on the offer pulls the microprice toward the bid.
        assert snapshot.microprice < snapshot.mid

    def test_book_imbalance_is_signed_and_bounded(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        bid_heavy = engine.on_book(book(mes, [(5100.00, 90)], [(5100.25, 10)]))
        assert bid_heavy is not None
        assert bid_heavy.book_imbalance == pytest.approx(0.8)

        engine = OrderBookEngine(mes)
        ask_heavy = engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 90)]))
        assert ask_heavy is not None
        assert ask_heavy.book_imbalance == pytest.approx(-0.8)

    def test_depth_imbalance_uses_more_than_the_top(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, levels=3)
        snapshot = engine.on_book(
            book(mes,
                 [(5100.00, 10), (5099.75, 10), (5099.50, 80)],
                 [(5100.25, 10), (5100.50, 10), (5100.75, 10)])
        )
        assert snapshot is not None
        assert snapshot.book_imbalance == pytest.approx(0.0)   # top of book is even
        assert snapshot.depth_imbalance > 0.5                  # depth is not

    def test_an_empty_side_yields_no_snapshot(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        assert engine.on_book(book(mes, [], [(5100.25, 10)])) is None


class TestOrderFlow:
    def test_delta_accumulates_by_aggressor(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        engine.on_trade(trade(mes, 5100.25, 5, Aggressor.BUY))
        engine.on_trade(trade(mes, 5100.00, 3, Aggressor.SELL, seq=2))
        assert engine.cumulative_delta == pytest.approx(2.0)

    def test_an_untagged_print_contributes_no_delta(self, mes: Instrument) -> None:
        """Assigning a side would manufacture order flow that was never observed."""
        engine = OrderBookEngine(mes)
        engine.on_trade(trade(mes, 5100.25, 10, Aggressor.UNKNOWN))
        assert engine.cumulative_delta == 0.0

    def test_trade_imbalance_is_none_when_nothing_is_tagged(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        engine.on_trade(trade(mes, 5100.25, 10, Aggressor.UNKNOWN))
        assert engine.trade_imbalance is None

    def test_trade_velocity_uses_the_window(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, window_seconds=10.0)
        for i in range(20):
            engine.on_trade(trade(mes, 5100.25, 1, ts=TS + i * NS_PER_SEC // 10, seq=i))
        assert engine.trade_velocity == pytest.approx(2.0)

    def test_old_trades_leave_the_window(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, window_seconds=1.0)
        engine.on_trade(trade(mes, 5100.25, 1, ts=TS, seq=1))
        engine.on_trade(trade(mes, 5100.25, 1, ts=TS + 10 * NS_PER_SEC, seq=2))
        assert engine.window_delta == pytest.approx(1.0)  # only the recent one


class TestLiquidityStructure:
    def test_a_wall_is_detected(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, levels=3, wall_multiple=3.0)
        engine.on_book(
            book(mes,
                 [(5100.00, 10), (5099.75, 12), (5099.50, 200)],
                 [(5100.25, 10), (5100.50, 11), (5100.75, 9)])
        )
        walls = engine.liquidity_walls()
        assert len(walls) == 1
        assert walls[0].price == 5099.50
        assert walls[0].is_bid

    def test_an_even_book_has_no_walls(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, levels=3)
        engine.on_book(
            book(mes,
                 [(5100.00, 10), (5099.75, 10), (5099.50, 10)],
                 [(5100.25, 10), (5100.50, 10), (5100.75, 10)])
        )
        assert engine.liquidity_walls() == ()

    def test_large_trade_detection_needs_history(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        assert not engine.is_large_trade(1000.0)  # no baseline yet
        for i in range(30):
            engine.on_trade(trade(mes, 5100.25, 2.0, seq=i))
        assert engine.is_large_trade(50.0)
        assert not engine.is_large_trade(3.0)

    def test_absorption_is_none_without_trades(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes)
        engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)]))
        assert engine.absorption() is None


class TestRates:
    def test_arrivals_and_cancellations_are_tracked(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, levels=2, window_seconds=10.0)
        engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)], ts=TS))
        engine.on_book(book(mes, [(5100.00, 20)], [(5100.25, 5)], ts=TS + NS_PER_SEC))
        assert engine.order_arrival_rate > 0     # the bid grew
        assert engine.cancellation_rate > 0      # the ask shrank

    def test_rates_decay_out_of_the_window(self, mes: Instrument) -> None:
        engine = OrderBookEngine(mes, levels=2, window_seconds=1.0)
        engine.on_book(book(mes, [(5100.00, 10)], [(5100.25, 10)], ts=TS))
        engine.on_book(book(mes, [(5100.00, 20)], [(5100.25, 20)], ts=TS + NS_PER_SEC))
        engine.on_book(
            book(mes, [(5100.00, 20)], [(5100.25, 20)], ts=TS + 60 * NS_PER_SEC)
        )
        assert engine.order_arrival_rate == 0.0


class TestValidation:
    @pytest.mark.parametrize(
        ("kwargs", "match"),
        [
            ({"levels": 0}, "levels must be at least 1"),
            ({"wall_multiple": 1.0}, "wall_multiple must exceed 1"),
            ({"window_seconds": 0.0}, "window_seconds must be positive"),
        ],
    )
    def test_invalid_configuration_is_refused(
        self, mes: Instrument, kwargs: dict, match: str
    ) -> None:
        with pytest.raises(ValueError, match=match):
            OrderBookEngine(mes, **kwargs)

    def test_features_are_empty_before_any_book(self, mes: Instrument) -> None:
        assert OrderBookEngine(mes).features() == {}
