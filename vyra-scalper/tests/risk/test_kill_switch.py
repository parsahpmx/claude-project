"""Kill switch: no automatic recovery, and a restart comes back tripped."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.risk.kill_switch import (
    EmergencyPolicy,
    KillSwitch,
    KillSwitchState,
    Trigger,
)
from core.util.clock import NS_PER_SEC

T0 = 1_700_000_000_000_000_000


@pytest.fixture
def switch(tmp_path: Path) -> KillSwitch:
    return KillSwitch(EmergencyPolicy.HOLD, min_trip_seconds=60, state_file=tmp_path / "ks.json")


class TestTripping:
    def test_starts_armed(self, switch: KillSwitch) -> None:
        assert switch.state is KillSwitchState.ARMED
        assert switch.allows_new_entries()

    def test_trip_blocks_new_entries(self, switch: KillSwitch) -> None:
        switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "loss limit", ts=T0)
        assert switch.is_tripped
        assert not switch.allows_new_entries()

    def test_first_cause_is_preserved_across_further_triggers(self, switch: KillSwitch) -> None:
        """During an incident review the first cause is the one that matters."""
        switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "loss", ts=T0)
        switch.trip(Trigger.BROKER_DISCONNECTED, "disconnect", ts=T0 + NS_PER_SEC)
        assert switch.trip_record is not None
        assert switch.trip_record.trigger is Trigger.DAILY_LOSS_EXCEEDED
        assert len(switch.history) == 2

    @pytest.mark.parametrize("trigger", list(Trigger))
    def test_every_specified_trigger_trips(self, switch: KillSwitch, trigger: Trigger) -> None:
        switch.trip(trigger, "test", ts=T0)
        assert switch.is_tripped


class TestEmergencyPolicy:
    def test_hold_suppresses_even_exits(self, tmp_path: Path) -> None:
        """HOLD means do nothing: flattening into a broken feed can be worse."""
        switch = KillSwitch(EmergencyPolicy.HOLD, 0, tmp_path / "k.json")
        switch.trip(Trigger.MARKET_DATA_STALE, "stale", ts=T0)
        assert not switch.allows_risk_reducing_exit()
        assert not switch.should_flatten_now()

    def test_flatten_immediately_permits_exits(self, tmp_path: Path) -> None:
        switch = KillSwitch(EmergencyPolicy.FLATTEN_IMMEDIATELY, 0, tmp_path / "k.json")
        switch.trip(Trigger.DRAWDOWN_EXCEEDED, "dd", ts=T0)
        assert switch.allows_risk_reducing_exit()
        assert switch.should_flatten_now()
        assert not switch.allows_new_entries()  # entries are never permitted


class TestRecovery:
    def test_no_force_parameter_exists(self) -> None:
        """There must be no automated path that clears a tripped switch."""
        assert "force" not in KillSwitch.reset.__code__.co_varnames

    def test_reset_requires_an_operator(self, switch: KillSwitch) -> None:
        switch.trip(Trigger.MANUAL, "test", ts=T0)
        with pytest.raises(ValueError, match="operator identity"):
            switch.reset("", "reason", ts=T0 + 120 * NS_PER_SEC)

    def test_reset_requires_a_reason(self, switch: KillSwitch) -> None:
        switch.trip(Trigger.MANUAL, "test", ts=T0)
        with pytest.raises(ValueError, match="reason"):
            switch.reset("alice", "  ", ts=T0 + 120 * NS_PER_SEC)

    def test_reset_refused_while_the_condition_persists(self, switch: KillSwitch) -> None:
        switch.trip(Trigger.BROKER_DISCONNECTED, "down", ts=T0)
        with pytest.raises(ValueError, match="has not been cleared"):
            switch.reset("alice", "trying", ts=T0 + 120 * NS_PER_SEC, condition_cleared=False)
        assert switch.is_tripped

    def test_reset_refused_before_the_minimum_trip_duration(self, switch: KillSwitch) -> None:
        """Prevents a reflexive reset straight back into the same condition."""
        switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "loss", ts=T0)
        with pytest.raises(ValueError, match="minimum"):
            switch.reset("alice", "reviewed", ts=T0 + 10 * NS_PER_SEC)

    def test_successful_reset_is_recorded_with_the_operator(self, switch: KillSwitch) -> None:
        switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "loss", ts=T0)
        record = switch.reset("alice", "reviewed and position closed", ts=T0 + 120 * NS_PER_SEC)
        assert switch.state is KillSwitchState.ARMED
        assert record.operator == "alice"
        assert record.is_reset

    def test_reset_of_an_armed_switch_is_an_error(self, switch: KillSwitch) -> None:
        with pytest.raises(ValueError, match="not tripped"):
            switch.reset("alice", "why", ts=T0)


class TestPersistence:
    def test_restart_comes_back_tripped(self, tmp_path: Path) -> None:
        """A crash loop must never look like a clean start."""
        path = tmp_path / "ks.json"
        KillSwitch(EmergencyPolicy.HOLD, 60, path).trip(Trigger.DRAWDOWN_EXCEEDED, "dd", ts=T0)
        restarted = KillSwitch(EmergencyPolicy.HOLD, 60, path)
        assert restarted.is_tripped
        assert restarted.trip_record is not None
        assert restarted.trip_record.trigger is Trigger.DRAWDOWN_EXCEEDED

    def test_unreadable_state_file_fails_safe_to_tripped(self, tmp_path: Path) -> None:
        """'I do not know whether I was halted' must resolve to 'halted'."""
        path = tmp_path / "ks.json"
        path.write_text("{ this is not json")
        assert KillSwitch(EmergencyPolicy.HOLD, 60, path).is_tripped

    def test_history_survives_a_restart(self, tmp_path: Path) -> None:
        path = tmp_path / "ks.json"
        first = KillSwitch(EmergencyPolicy.HOLD, 0, path)
        first.trip(Trigger.MANUAL, "one", ts=T0)
        first.reset("alice", "done", ts=T0 + NS_PER_SEC)
        second = KillSwitch(EmergencyPolicy.HOLD, 0, path)
        second.trip(Trigger.MANUAL, "two", ts=T0 + 2 * NS_PER_SEC)
        assert len(second.history) == 3
        assert len(json.loads(path.read_text())["history"]) == 3

    def test_no_state_file_means_armed(self, tmp_path: Path) -> None:
        assert KillSwitch(EmergencyPolicy.HOLD, 60, tmp_path / "absent.json").state is (
            KillSwitchState.ARMED
        )
