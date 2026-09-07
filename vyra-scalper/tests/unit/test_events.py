"""Event invariants: latency accounting, immutability and the look-ahead guard."""

from __future__ import annotations

import dataclasses

import pytest

from core.events import (
    NO_EXCHANGE_TIMESTAMP,
    Aggressor,
    BarEvent,
    DataFlag,
    FillEvent,
    OrderEvent,
    QuoteEvent,
    Side,
    Timeframe,
    TradeEvent,
)


def make_quote(**kw: object) -> QuoteEvent:
    defaults = dict(
        instrument_id="CME:MES",
        exchange="CME",
        ts_exchange=1_000,
        ts_receive=1_800,
        ts_processed=2_500,
        sequence_id=1,
        source="TEST",
        bid=5100.00,
        ask=5100.25,
        bid_size=12.0,
        ask_size=30.0,
    )
    defaults.update(kw)
    return QuoteEvent(**defaults)  # type: ignore[arg-type]


class TestLatencyAccounting:
    def test_three_intervals_are_differences_of_the_three_stamps(self) -> None:
        q = make_quote()
        assert q.exchange_to_receive_latency == 800
        assert q.receive_to_process_latency == 700
        assert q.end_to_end_latency == 1_500

    def test_missing_exchange_stamp_reports_none_not_zero(self) -> None:
        """A missing measurement must never read as a perfect measurement."""
        q = make_quote(ts_exchange=NO_EXCHANGE_TIMESTAMP)
        assert q.exchange_to_receive_latency is None
        assert q.end_to_end_latency is None
        assert q.receive_to_process_latency == 700

    def test_ordering_key_is_ts_processed(self) -> None:
        assert make_quote().ts == 2_500


class TestQuoteMaths:
    def test_mid_and_microprice(self) -> None:
        q = make_quote(bid=5100.0, ask=5100.25, bid_size=10.0, ask_size=30.0)
        assert q.mid == 5100.125
        # Weighted toward the thin side: more size on the ask pulls the microprice down.
        assert q.microprice == pytest.approx(5100.0625)
        assert q.microprice < q.mid

    def test_microprice_falls_back_to_mid_when_sizes_are_zero(self) -> None:
        q = make_quote(bid_size=0.0, ask_size=0.0)
        assert q.microprice == q.mid

    def test_crossed_book_is_detected_not_clamped(self) -> None:
        q = make_quote(bid=5100.50, ask=5100.25)
        assert q.is_crossed
        assert q.spread == pytest.approx(-0.25)

    def test_touches(self) -> None:
        q = make_quote()
        assert q.far_touch(buying=True) == 5100.25
        assert q.near_touch(buying=True) == 5100.00


class TestTradeEvent:
    def test_unknown_aggressor_contributes_no_signed_flow(self) -> None:
        """Assigning a side to an untagged print would manufacture order flow."""
        t = TradeEvent(
            "CME:MES", "CME", 0, 0, 1, 1, "TEST", price=5100.0, size=3.0,
            aggressor=Aggressor.UNKNOWN,
        )
        assert t.signed_size == 0.0

    def test_signed_size_follows_aggressor(self) -> None:
        base = dict(instrument_id="CME:MES", exchange="CME", ts_exchange=0, ts_receive=0,
                    ts_processed=1, sequence_id=1, source="TEST", price=5100.0, size=3.0)
        assert TradeEvent(**base, aggressor=Aggressor.BUY).signed_size == 3.0  # type: ignore[arg-type]
        assert TradeEvent(**base, aggressor=Aggressor.SELL).signed_size == -3.0  # type: ignore[arg-type]


class TestBarLookAheadGuard:
    def make_bar(self, closed: bool) -> BarEvent:
        return BarEvent(
            "CME:MES", "CME", 0, 0, 100, 1, "TEST",
            timeframe=Timeframe.M1, ts_open=0, ts_close=100,
            open=1.0, high=2.0, low=0.5, close=1.5, is_closed=closed,
        )

    def test_closed_bar_passes_through(self) -> None:
        bar = self.make_bar(closed=True)
        assert bar.require_closed() is bar

    def test_partial_bar_raises_when_used_as_history(self) -> None:
        with pytest.raises(ValueError, match="look-ahead guard"):
            self.make_bar(closed=False).require_closed()

    def test_structural_validity(self) -> None:
        assert self.make_bar(True).is_valid
        broken = dataclasses.replace(self.make_bar(True), high=0.1)
        assert not broken.is_valid


class TestImmutabilityAndFlags:
    def test_events_are_frozen(self) -> None:
        q = make_quote()
        with pytest.raises(dataclasses.FrozenInstanceError):
            q.bid = 1.0  # type: ignore[misc]

    def test_with_flags_returns_a_copy_and_deduplicates(self) -> None:
        q = make_quote()
        flagged = q.with_flags(DataFlag.CROSSED_BOOK, DataFlag.CROSSED_BOOK)
        assert flagged.flags == (DataFlag.CROSSED_BOOK,)
        assert q.flags == ()  # original untouched

    def test_with_processed_preserves_the_venue_stamp(self) -> None:
        q = make_quote()
        delayed = q.with_processed(9_999)
        assert delayed.ts_processed == 9_999
        assert delayed.ts_exchange == q.ts_exchange


class TestNonFiniteRejection:
    @pytest.mark.parametrize("field", ["bid", "ask", "bid_size", "ask_size"])
    def test_quote_rejects_nan(self, field: str) -> None:
        """A NaN compares false against every threshold and passes each risk check."""
        with pytest.raises(ValueError, match="must be finite"):
            make_quote(**{field: float("nan")})

    def test_trade_rejects_infinity(self) -> None:
        with pytest.raises(ValueError, match="must be finite"):
            TradeEvent("X", "X", 0, 0, 1, 1, "T", price=float("inf"), size=1.0)

    def test_fill_rejects_negative_quantity(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            FillEvent("X", "X", 0, 0, 1, 1, "T", quantity=-1.0, price=100.0)


class TestExecutionMetrics:
    def test_slippage_is_signed_by_side(self) -> None:
        buy = FillEvent("CME:MES", "CME", 0, 0, 1, 1, "T", side=Side.BUY, quantity=1.0,
                        price=5100.50, expected_price=5100.25, decision_price=5100.00)
        assert buy.slippage_vs_expected(0.25) == 1.0   # one tick worse
        assert buy.slippage_vs_decision(0.25) == 2.0
        sell = FillEvent("CME:MES", "CME", 0, 0, 1, 1, "T", side=Side.SELL, quantity=1.0,
                         price=5100.00, expected_price=5100.25)
        assert sell.slippage_vs_expected(0.25) == 1.0  # also one tick worse, for a sell

    def test_slippage_is_none_without_an_expectation(self) -> None:
        fill = FillEvent("X", "X", 0, 0, 1, 1, "T", quantity=1.0, price=100.0)
        assert fill.slippage_vs_expected(0.25) is None

    def test_order_remaining_and_fill_ratio(self) -> None:
        o = OrderEvent("X", "X", 0, 0, 1, 1, "T", quantity=4.0, filled_qty=1.0)
        assert o.remaining_qty == 3.0
        assert o.fill_ratio == 0.25

    def test_order_latency_is_none_when_a_stamp_is_missing(self) -> None:
        o = OrderEvent("X", "X", 0, 0, 1, 1, "T", ts_signal=10, ts_submitted=0)
        assert o.latency_signal_to_submit is None
