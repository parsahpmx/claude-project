"""Instrument definitions, sessions, symbol mapping and continuous contracts."""

from __future__ import annotations

from datetime import date, time, timedelta

import pytest

from core.config.loader import ConfigError
from core.events.enums import AssetClass
from core.instruments.continuous import (
    Adjustment,
    ContinuousContractSpec,
    ContractLeg,
    RollRule,
    build_continuous_series,
)
from core.instruments.instrument import Instrument, InstrumentError
from core.instruments.registry import InstrumentRegistry
from core.instruments.sessions import SessionCalendar, SessionSegment, TradingSession
from core.instruments.symbols import SymbolMapper, SymbolMappingError, SymbolNotMapped
from core.util.clock import from_iso


class TestInstrumentInvariants:
    def test_tick_value_identity_is_enforced_for_futures(self) -> None:
        """A wrong tick value rescales every PnL figure and is invisible on a report."""
        with pytest.raises(InstrumentError, match="tick_value"):
            Instrument("CME:MNQ", "MNQ", AssetClass.FUTURE, "CME", "USD",
                       tick_size=0.25, tick_value=5.00, multiplier=2.0, expiry_ns=1)

    def test_equity_multiplier_must_be_one(self) -> None:
        with pytest.raises(InstrumentError, match="multiplier must be 1"):
            Instrument("X:Y", "Y", AssetClass.EQUITY, "X", "USD",
                       tick_size=0.01, tick_value=0.10, multiplier=10.0)

    def test_dated_future_requires_an_expiry(self) -> None:
        with pytest.raises(InstrumentError, match="expiry_ns"):
            Instrument("CME:MES", "MES", AssetClass.FUTURE, "CME", "USD",
                       tick_size=0.25, tick_value=1.25, multiplier=5.0)

    @pytest.mark.parametrize(
        ("field", "value"),
        [("tick_size", 0.0), ("tick_value", -1.0), ("multiplier", 0.0), ("min_qty", 0.0)],
    )
    def test_non_positive_specs_are_rejected(self, field: str, value: float) -> None:
        kwargs = {"tick_size": 0.25, "tick_value": 1.25, "multiplier": 5.0, "expiry_ns": 1}
        kwargs[field] = value
        with pytest.raises(InstrumentError):
            Instrument("CME:MES", "MES", AssetClass.FUTURE, "CME", "USD", **kwargs)  # type: ignore[arg-type]


class TestInstrumentArithmetic:
    def test_futures_pnl_matches_the_exchange_convention(self, mes: Instrument) -> None:
        # 10 index points = 40 ticks; 40 x $1.25 x 2 contracts = $100.
        assert mes.pnl(5100.0, 5110.0, qty=2, sign=1) == pytest.approx(100.0)
        assert mes.pnl(5100.0, 5110.0, qty=2, sign=-1) == pytest.approx(-100.0)

    def test_es_is_ten_times_mes(self, mes: Instrument, es: Instrument) -> None:
        assert es.pnl(5100.0, 5110.0, 1, 1) == pytest.approx(10 * mes.pnl(5100.0, 5110.0, 1, 1))

    def test_equity_pnl_is_price_times_shares(self, aapl: Instrument) -> None:
        assert aapl.pnl(190.0, 191.5, qty=100, sign=1) == pytest.approx(150.0)

    def test_notional_uses_the_multiplier(self, mes: Instrument, aapl: Instrument) -> None:
        assert mes.notional(5100.0, 2) == pytest.approx(51_000.0)
        assert aapl.notional(190.0, 100) == pytest.approx(19_000.0)

    def test_quantity_rounding_never_rounds_up(self, mes: Instrument) -> None:
        assert mes.round_qty(2.9) == 2.0
        assert mes.round_qty(0.9) == 0.0

    def test_cfd_supports_fractional_lots(self, xauusd: Instrument) -> None:
        assert xauusd.round_qty(0.157) == pytest.approx(0.15)

    def test_price_rounding_lands_on_a_tick(self, mes: Instrument) -> None:
        assert mes.round_price(5100.37) == 5100.25

    def test_max_position_from_notional(self, mes: Instrument) -> None:
        assert mes.max_position_from_notional(5100.0, 51_000.0) == 2.0


class TestDepthAvailability:
    def test_exchange_instruments_have_real_depth(self, mes: Instrument, aapl: Instrument) -> None:
        assert mes.supports_exchange_depth
        assert aapl.supports_exchange_depth

    def test_cfd_depth_is_not_market_liquidity(self, xauusd: Instrument) -> None:
        """Broker CFD 'depth' is that broker's quoting; strategies must not conflate it."""
        assert not xauusd.supports_exchange_depth


class TestSessionCalendar:
    @pytest.fixture
    def cme(self) -> SessionCalendar:
        session = TradingSession(
            session_id="cme",
            timezone="America/Chicago",
            segments=(SessionSegment(time(17, 0), time(16, 0), "GLOBEX"),),
            weekdays=frozenset({1, 2, 3, 4, 5}),
            holidays=frozenset({date(2024, 12, 25)}),
            early_closes={date(2024, 12, 24): time(12, 0)},
        )
        return SessionCalendar(session)

    def test_open_during_the_overnight_session(self, cme: SessionCalendar) -> None:
        assert cme.is_open(from_iso("2024-03-18T02:00:00Z"))  # Sun 21:00 CT -> Mon session

    def test_friday_evening_has_no_saturday_session(self, cme: SessionCalendar) -> None:
        assert not cme.is_open(from_iso("2024-03-15T22:30:00Z"))

    def test_trading_date_belongs_to_the_session_not_the_calendar_day(
        self, cme: SessionCalendar
    ) -> None:
        """Sunday 21:00 CT is Monday's trading date; bucketing it as Sunday would reset
        the daily-loss limit in the middle of a live position."""
        assert cme.session_date(from_iso("2024-03-18T02:00:00Z")) == date(2024, 3, 18)

    def test_holiday_cancels_the_window_that_opened_the_previous_evening(
        self, cme: SessionCalendar
    ) -> None:
        assert not cme.is_open(from_iso("2024-12-25T15:00:00Z"))

    def test_venue_reopens_on_the_holiday_evening_for_the_next_session(
        self, cme: SessionCalendar
    ) -> None:
        assert cme.is_open(from_iso("2024-12-25T23:30:00Z"))

    def test_early_close_truncates_the_session(self, cme: SessionCalendar) -> None:
        assert cme.is_open(from_iso("2024-12-24T17:00:00Z"))       # 11:00 CT
        assert not cme.is_open(from_iso("2024-12-24T19:00:00Z"))   # 13:00 CT, after close

    def test_next_open_skips_the_weekend(self, cme: SessionCalendar) -> None:
        nxt = cme.next_open(from_iso("2024-03-16T18:00:00Z"))
        assert nxt == from_iso("2024-03-17T22:00:00Z")             # Sun 17:00 CT

    def test_minutes_into_session_is_none_when_closed(self, cme: SessionCalendar) -> None:
        assert cme.minutes_into_session(from_iso("2024-03-16T18:00:00Z")) is None

    def test_us_equities_rth_bounds(self, registry: InstrumentRegistry) -> None:
        cal = registry.calendar("NASDAQ:AAPL")
        assert cal.is_open(from_iso("2024-03-15T14:00:00Z"))       # 10:00 ET
        assert not cal.is_open(from_iso("2024-03-15T21:00:00Z"))   # 17:00 ET


class TestNoTradeWindows:
    def test_opening_and_closing_windows_block_entries(
        self, registry: InstrumentRegistry
    ) -> None:
        open_ts = from_iso("2024-03-15T13:30:00Z")
        assert registry.is_blocked_window("NASDAQ:AAPL", open_ts + 15_000_000_000) == (
            "OPENING_AUCTION_NOISE"
        )
        assert registry.is_blocked_window("NASDAQ:AAPL", from_iso("2024-03-15T15:00:00Z")) is None
        assert registry.is_blocked_window("NASDAQ:AAPL", from_iso("2024-03-15T19:59:00Z")) == (
            "CLOSING_AUCTION_RISK"
        )


class TestSymbolMapper:
    @pytest.fixture
    def mapper(self) -> SymbolMapper:
        m = SymbolMapper()
        m.register("IBKR", {"CFD:XAUUSD": "XAUUSD", "CME:MES": "MES"})
        m.register("MT5", {"CFD:XAUUSD": "GOLD"})
        m.register("OANDA", {"CFD:XAUUSD": "XAU_USD"})
        return m

    def test_the_same_metal_has_three_names(self, mapper: SymbolMapper) -> None:
        assert mapper.to_broker("IBKR", "CFD:XAUUSD") == "XAUUSD"
        assert mapper.to_broker("MT5", "CFD:XAUUSD") == "GOLD"
        assert mapper.to_broker("OANDA", "CFD:XAUUSD") == "XAU_USD"

    def test_reverse_mapping_is_exact(self, mapper: SymbolMapper) -> None:
        assert mapper.to_canonical("MT5", "GOLD") == "CFD:XAUUSD"

    def test_unmapped_symbol_raises_rather_than_guessing(self, mapper: SymbolMapper) -> None:
        with pytest.raises(SymbolNotMapped, match="no MT5 mapping"):
            mapper.to_broker("MT5", "CME:MES")

    def test_unknown_inbound_symbol_is_surfaced(self, mapper: SymbolMapper) -> None:
        with pytest.raises(SymbolNotMapped, match="unknown symbol"):
            mapper.to_canonical("IBKR", "GOLD")

    def test_ambiguous_table_is_refused_at_registration(self) -> None:
        with pytest.raises(SymbolMappingError, match="ambiguous"):
            SymbolMapper().register("BAD", {"A": "X", "B": "X"})

    def test_universe_validation_lists_every_gap_at_once(self, mapper: SymbolMapper) -> None:
        with pytest.raises(SymbolNotMapped, match="CME:MES"):
            mapper.validate_universe("MT5", ["CFD:XAUUSD", "CME:MES"])

    def test_built_from_the_shipped_broker_config(self, config_bundle) -> None:
        mapper = SymbolMapper.from_config(config_bundle["brokers"].section("brokers").data)
        assert mapper.to_broker("mt5", "CFD:XAUUSD") == "GOLD"
        assert mapper.to_broker("oanda", "FX:EURUSD") == "EUR_USD"
        assert mapper.to_canonical("ibkr", "MES") == "CME:MES"


class TestContinuousContracts:
    @pytest.fixture
    def legs(self) -> list[ContractLeg]:
        d0 = date(2024, 3, 1)
        days = [d0 + timedelta(days=i) for i in range(20)]
        front = ContractLeg(
            "MESH24", "H24", from_iso("2024-03-15T00:00:00Z"),
            {d: 100.0 + i for i, d in enumerate(days)},
            {d: 1000.0 - 40 * i for i, d in enumerate(days)},
        )
        back = ContractLeg(
            "MESM24", "M24", from_iso("2024-06-21T00:00:00Z"),
            {d: 105.0 + i for i, d in enumerate(days)},
            {d: 100.0 + 60 * i for i, d in enumerate(days)},
        )
        return [front, back]

    def test_volume_crossover_rolls_once_confirmed(self, legs: list[ContractLeg]) -> None:
        spec = ContinuousContractSpec("MES", RollRule.VOLUME_CROSSOVER, Adjustment.NONE,
                                      crossover_confirm_days=2)
        series = build_continuous_series(legs, spec)
        assert len(series.rolls) == 1
        roll = series.rolls[0]
        assert roll.from_contract == "MESH24" and roll.to_contract == "MESM24"
        assert roll.gap == pytest.approx(5.0)

    def test_back_adjustment_lifts_history_and_leaves_the_present_raw(
        self, legs: list[ContractLeg]
    ) -> None:
        d0 = date(2024, 3, 1)
        spec = ContinuousContractSpec("MES", RollRule.VOLUME_CROSSOVER,
                                      Adjustment.BACK_ADJUST_DIFF, crossover_confirm_days=2)
        series = build_continuous_series(legs, spec)
        assert series.prices_by_date[d0] == pytest.approx(105.0)          # 100 + 5 gap
        last = d0 + timedelta(days=19)
        assert series.prices_by_date[last] == pytest.approx(124.0)        # untouched
        assert series.active_contract_by_date[last] == "MESM24"

    def test_ratio_adjustment_preserves_returns(self, legs: list[ContractLeg]) -> None:
        spec = ContinuousContractSpec("MES", RollRule.VOLUME_CROSSOVER,
                                      Adjustment.BACK_ADJUST_RATIO, crossover_confirm_days=2)
        series = build_continuous_series(legs, spec)
        d0 = date(2024, 3, 1)
        assert series.prices_by_date[d0] == pytest.approx(100.0 * 116.0 / 111.0)

    def test_calendar_roll_uses_expiry(self, legs: list[ContractLeg]) -> None:
        spec = ContinuousContractSpec("MES", RollRule.CALENDAR_DAYS_BEFORE_EXPIRY,
                                      Adjustment.NONE, days_before_expiry=5)
        series = build_continuous_series(legs, spec)
        assert series.rolls[0].roll_date == date(2024, 3, 10)

    def test_adjusted_series_is_refused_by_the_execution_path(
        self, legs: list[ContractLeg]
    ) -> None:
        """A back-adjusted price is a price no venue ever quoted."""
        spec = ContinuousContractSpec("MES", RollRule.VOLUME_CROSSOVER,
                                      Adjustment.BACK_ADJUST_DIFF, crossover_confirm_days=2)
        with pytest.raises(ValueError, match="research-only"):
            build_continuous_series(legs, spec).require_unadjusted()

    def test_crossover_without_volume_data_refuses_to_fall_back_silently(self) -> None:
        d = date(2024, 3, 1)
        legs = [
            ContractLeg("A", "H24", 1, {d: 100.0}),
            ContractLeg("B", "M24", 2, {d: 105.0}),
        ]
        spec = ContinuousContractSpec("X", RollRule.VOLUME_CROSSOVER, Adjustment.NONE)
        with pytest.raises(ValueError, match="refusing to fall back"):
            build_continuous_series(legs, spec)

    def test_legs_must_be_in_expiry_order(self) -> None:
        d = date(2024, 3, 1)
        legs = [ContractLeg("B", "M24", 2, {d: 1.0}), ContractLeg("A", "H24", 1, {d: 1.0})]
        with pytest.raises(ValueError, match="ascending expiry order"):
            build_continuous_series(legs, ContinuousContractSpec(
                "X", RollRule.CALENDAR_DAYS_BEFORE_EXPIRY, Adjustment.NONE))


class TestRegistryFromShippedConfig:
    def test_every_shipped_instrument_loads(self, registry: InstrumentRegistry) -> None:
        assert len(registry) == 20
        assert len(registry.by_asset_class(AssetClass.FUTURE)) == 7
        assert len(registry.by_asset_class(AssetClass.EQUITY)) == 6

    def test_unknown_instrument_lists_what_is_known(self, registry: InstrumentRegistry) -> None:
        with pytest.raises(ConfigError, match="unknown instrument"):
            registry.get("CME:NOPE")

    def test_contracts_are_never_stitched_implicitly(self, registry: InstrumentRegistry) -> None:
        with pytest.raises(ConfigError, match="never stitched implicitly"):
            registry.continuous_spec("SI")

    def test_dangling_session_reference_fails_at_startup(self) -> None:
        inst = Instrument("X:Y", "Y", AssetClass.EQUITY, "X", "USD", 0.01, 0.01, 1.0,
                          session_id="does_not_exist")
        with pytest.raises(ConfigError, match="unknown sessions"):
            InstrumentRegistry({inst.instrument_id: inst}, {})
