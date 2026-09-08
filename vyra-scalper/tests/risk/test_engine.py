"""Risk engine: each limit binds independently and names its own reason."""

from __future__ import annotations

from datetime import date

import pytest

from core.config.loader import ConfigBundle
from core.events import Side, StalenessState
from core.instruments.registry import InstrumentRegistry
from core.portfolio.portfolio import Portfolio
from core.risk.engine import MarketState, RiskAction, RiskEngine
from core.risk.kill_switch import EmergencyPolicy, KillSwitch, Trigger
from core.risk.limits import RiskLimits
from core.risk.reasons import ALL_REASONS, Reason
from core.signals.signal import EntryType, Signal, SignalIntent
from core.util.clock import NS_PER_SEC, from_iso

TS = from_iso("2024-03-05T15:00:00Z")


@pytest.fixture
def harness(config_bundle: ConfigBundle, registry: InstrumentRegistry):
    instruments = {i: registry.get(i) for i in registry.ids()}
    calendars = {i: registry.calendar(i) for i in registry.ids()}
    limits = RiskLimits.from_config(config_bundle["risk"])
    portfolio = Portfolio(100_000.0, instruments, calendars)
    switch = KillSwitch(EmergencyPolicy.HOLD, min_trip_seconds=0)
    engine = RiskEngine(limits, portfolio, registry, switch)
    portfolio.start_session(date(2024, 3, 5))
    return engine, portfolio, switch, limits


def signal(
    signal_id: str = "s1",
    entry: float = 5100.0,
    stop: float = 5095.0,
    confidence: float = 1.0,
    intent: SignalIntent = SignalIntent.ENTER,
    side: Side = Side.BUY,
    ts: int = TS,
    instrument: str = "CME:MES",
) -> Signal:
    return Signal(
        signal_id=signal_id, strategy_id="vwap", instrument_id=instrument, direction=side,
        intent=intent, ts=ts, entry_type=EntryType.MARKETABLE_LIMIT,
        suggested_entry=entry, suggested_stop=stop, confidence=confidence,
    )


CLEAN = MarketState(ts=TS, spread_ticks=1.0, atr_ticks=10.0, top_of_book_size=20.0)


class TestApproval:
    def test_clean_signal_is_approved_at_the_risk_budget(self, harness) -> None:
        engine, _, _, _ = harness
        decision = engine.evaluate(signal(), CLEAN)
        assert decision.action is RiskAction.APPROVE
        assert decision.approved_qty == 10.0
        assert decision.sizing is not None
        assert decision.risk_amount == pytest.approx(250.0)
        assert decision.sizing.risk_at_stop == pytest.approx(250.0)

    def test_approvals_are_recorded_too(self, harness) -> None:
        """An audit trail of only refusals cannot prove a limit was evaluated."""
        engine, _, _, _ = harness
        engine.evaluate(signal("a"), CLEAN)
        engine.evaluate(signal("b", stop=5099.75), CLEAN)
        assert [d.action for d in engine.decisions] == [RiskAction.APPROVE, RiskAction.REJECT]

    def test_every_reason_code_emitted_is_a_declared_one(self, harness) -> None:
        engine, _, _, _ = harness
        for i, market in enumerate(
            [CLEAN, MarketState(ts=TS, spread_ticks=99.0), MarketState(ts=TS, atr_ticks=0.1)]
        ):
            decision = engine.evaluate(signal(f"s{i}"), market)
            assert set(decision.reason_codes) <= ALL_REASONS


class TestMarketConditionGates:
    @pytest.mark.parametrize(
        ("market", "reason"),
        [
            (MarketState(ts=TS, spread_ticks=99.0), Reason.MAX_SPREAD),
            (MarketState(ts=TS, staleness=StalenessState.STALE), Reason.STALE_MARKET_DATA),
            (MarketState(ts=TS, is_session_open=False), Reason.SESSION_RESTRICTED),
            (MarketState(ts=TS, news_blackout=True), Reason.NEWS_BLACKOUT),
            (MarketState(ts=TS, atr_ticks=0.1), Reason.VOLATILITY_LIMIT),
            (MarketState(ts=TS, atr_ticks=99_999.0), Reason.VOLATILITY_LIMIT),
            (MarketState(ts=TS, expected_slippage_ticks=99.0), Reason.MAX_EXPECTED_SLIPPAGE),
            (MarketState(ts=TS, top_of_book_size=0.0), Reason.MIN_LIQUIDITY),
            (MarketState(ts=TS, blocked_window_reason="OPENING"), Reason.SESSION_RESTRICTED),
        ],
    )
    def test_each_gate_binds_with_its_own_reason(self, harness, market, reason) -> None:
        engine, _, _, _ = harness
        decision = engine.evaluate(signal(f"s-{reason}"), market)
        assert decision.action is RiskAction.REJECT
        assert decision.reason_codes == (reason,)

    def test_unknown_market_state_does_not_block(self, harness) -> None:
        """A gate with no measurement must not fire; it has nothing to judge."""
        engine, _, _, _ = harness
        decision = engine.evaluate(signal(), MarketState(ts=TS))
        assert decision.action is RiskAction.APPROVE

    def test_tighter_per_instrument_spread_limit_wins(self, harness) -> None:
        """MES tolerates 2 ticks; the global limit of 4 must not override that."""
        engine, _, _, _ = harness
        decision = engine.evaluate(signal(), MarketState(ts=TS, spread_ticks=3.0))
        assert decision.reason_codes == (Reason.MAX_SPREAD,)


class TestLossLimitsAndHalt:
    def test_daily_loss_breach_halts_and_trips_the_switch(self, harness) -> None:
        engine, portfolio, switch, _ = harness
        portfolio._equity = 97_000.0  # -3% against a 2% limit
        decision = engine.evaluate(signal(), CLEAN)
        assert decision.action is RiskAction.HALT
        assert decision.reason_codes == (Reason.KILL_SWITCH_ACTIVE,)
        assert switch.is_tripped
        assert switch.trip_record.trigger is Trigger.DAILY_LOSS_EXCEEDED

    def test_the_next_order_is_blocked_after_a_halt(self, harness) -> None:
        engine, portfolio, _, _ = harness
        portfolio._equity = 97_000.0
        engine.evaluate(signal("first"), CLEAN)
        portfolio._equity = 100_000.0  # recovery does not un-halt anything
        assert engine.evaluate(signal("second"), CLEAN).action is RiskAction.HALT

    def test_drawdown_breach_halts(self, harness) -> None:
        engine, portfolio, switch, _ = harness
        portfolio._peak_equity = 120_000.0
        portfolio._session_start_equity = 100_000.0
        portfolio._equity = 100_000.0  # 16.7% below peak, limit is 8%
        assert engine.evaluate(signal(), CLEAN).action is RiskAction.HALT
        assert switch.trip_record.trigger is Trigger.DRAWDOWN_EXCEEDED

    def test_dead_market_data_halts(self, harness) -> None:
        engine, _, switch, _ = harness
        market = MarketState(ts=TS, staleness=StalenessState.DEAD)
        assert engine.evaluate(signal(), market).action is RiskAction.HALT
        assert switch.trip_record.trigger is Trigger.MARKET_DATA_STALE

    def test_equity_drift_trips_without_a_new_order(self, harness) -> None:
        """A position drifting through the limit must halt on its own."""
        engine, portfolio, switch, _ = harness
        portfolio._equity = 97_000.0
        assert engine.check_equity_update(TS) is True
        assert switch.is_tripped


class TestSessionCounters:
    def test_max_trades_per_session(self, harness) -> None:
        engine, _, _, limits = harness
        for i in range(limits.max_trades_per_session):
            engine.on_trade_closed("vwap", net_pnl=10.0, ts=TS)
        decision = engine.evaluate(signal(), CLEAN)
        assert decision.reason_codes == (Reason.MAX_TRADES_PER_SESSION,)

    def test_consecutive_losses_report_the_cause_not_the_cooldown(self, harness) -> None:
        """A loss streak also starts a cooldown; the reported reason must name the cause."""
        engine, _, _, limits = harness
        for _ in range(limits.max_consecutive_losses):
            engine.on_trade_closed("vwap", net_pnl=-50.0, ts=TS)
        decision = engine.evaluate(signal(), CLEAN)
        assert decision.reason_codes == (Reason.MAX_CONSECUTIVE_LOSSES,)

    def test_a_win_resets_the_loss_streak(self, harness) -> None:
        engine, _, _, _ = harness
        engine.on_trade_closed("vwap", net_pnl=-50.0, ts=TS)
        engine.on_trade_closed("vwap", net_pnl=10.0, ts=TS)
        assert engine.state_for("vwap").consecutive_losses == 0

    def test_cooldown_after_a_loss_blocks_then_expires(self, harness) -> None:
        engine, _, _, limits = harness
        engine.on_trade_closed("vwap", net_pnl=-50.0, ts=TS)
        blocked = engine.evaluate(signal("during"), CLEAN)
        assert blocked.reason_codes == (Reason.COOLDOWN_ACTIVE,)
        later = TS + int(limits.cooldown_after_loss_seconds * NS_PER_SEC) + NS_PER_SEC
        after = engine.evaluate(signal("after", ts=later), MarketState(ts=later, spread_ticks=1.0))
        assert after.action is RiskAction.APPROVE

    def test_session_reset_clears_trade_count_but_not_loss_streak(self, harness) -> None:
        engine, _, _, _ = harness
        engine.on_trade_closed("vwap", net_pnl=-50.0, ts=TS)
        engine.start_session(date(2024, 3, 6))
        state = engine.state_for("vwap")
        assert state.trades_this_session == 0
        assert state.consecutive_losses == 1


class TestExposureCaps:
    def test_caps_reduce_rather_than_reject(self, harness) -> None:
        """A portfolio near a limit should trade smaller, not stop and start."""
        engine, _, _, limits = harness
        loose = RiskLimits(
            **{**{f: getattr(limits, f) for f in limits.__dataclass_fields__},
               "max_risk_per_trade_pct": 0.02}
        )
        engine._limits = loose
        decision = engine.evaluate(signal(), CLEAN)
        assert decision.action is RiskAction.REDUCE
        assert decision.binding_limit == Reason.MAX_INSTRUMENT_EXPOSURE
        assert 0 < decision.approved_qty < decision.requested_qty

    def test_correlated_group_shares_one_budget(self, harness, registry) -> None:
        """MES and ES are the same bet at two sizes."""
        engine, portfolio, _, _ = harness
        assert engine.limits.group_for("CME:MES") == engine.limits.group_for("CME:ES")


class TestExits:
    def test_exit_is_approved_for_the_open_quantity(self, harness) -> None:
        engine, portfolio, _, _ = harness
        position = portfolio.position("CME:MES")
        position.quantity = 7.0
        position.avg_price = 5100.0
        decision = engine.evaluate(signal("x", intent=SignalIntent.EXIT, side=Side.SELL,
                                          entry=5100.0, stop=5105.0), CLEAN)
        assert decision.action is RiskAction.APPROVE
        assert decision.approved_qty == 7.0

    def test_exit_is_not_blocked_by_market_condition_gates(self, harness) -> None:
        """Refusing to close because the spread widened would strand accepted risk."""
        engine, portfolio, _, _ = harness
        position = portfolio.position("CME:MES")
        position.quantity = 3.0
        position.avg_price = 5100.0
        decision = engine.evaluate(
            signal("x", intent=SignalIntent.EXIT, side=Side.SELL, entry=5100.0, stop=5105.0),
            MarketState(ts=TS, spread_ticks=99.0, staleness=StalenessState.STALE),
        )
        assert decision.action is RiskAction.APPROVE

    def test_exit_with_no_position_is_rejected(self, harness) -> None:
        engine, _, _, _ = harness
        decision = engine.evaluate(
            signal("x", intent=SignalIntent.EXIT, side=Side.SELL, entry=5100.0, stop=5105.0), CLEAN
        )
        assert decision.action is RiskAction.REJECT

    def test_hold_policy_suppresses_exits_while_halted(self, harness) -> None:
        engine, portfolio, switch, _ = harness
        position = portfolio.position("CME:MES")
        position.quantity = 3.0
        position.avg_price = 5100.0
        switch.trip(Trigger.MARKET_DATA_STALE, "stale", ts=TS)
        decision = engine.evaluate(
            signal("x", intent=SignalIntent.EXIT, side=Side.SELL, entry=5100.0, stop=5105.0), CLEAN
        )
        assert decision.action is RiskAction.HALT


class TestFailClosed:
    def test_an_internal_failure_rejects_rather_than_approves(
        self, harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An engine that cannot evaluate does not approve."""
        engine, _, _, _ = harness
        decision = engine.evaluate(signal(instrument="CME:MES"), CLEAN)
        assert decision.action is RiskAction.APPROVE  # baseline

        def explode(*args: object, **kwargs: object) -> bool:
            raise RuntimeError("check exploded")

        # Patched on the class: RiskEngine uses __slots__, so per-instance assignment is
        # correctly refused.
        monkeypatch.setattr(RiskEngine, "_spread_exceeded", explode)
        broken = engine.evaluate(signal("boom"), CLEAN)
        assert broken.action is RiskAction.REJECT
        assert broken.reason_codes == (Reason.RISK_CHECK_ERROR,)
        assert broken.detail["error_type"] == "RuntimeError"

    def test_a_duplicate_signal_id_is_refused(self, harness) -> None:
        engine, _, _, _ = harness
        engine.evaluate(signal("same"), CLEAN)
        repeat = engine.evaluate(signal("same"), CLEAN)
        assert repeat.reason_codes == (Reason.DUPLICATE_SIGNAL,)
