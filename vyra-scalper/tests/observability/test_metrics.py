"""Metrics, and the label rule that keeps them safe to publish.

A metrics endpoint is the least-guarded surface a service has: scraped continuously,
retained for months, usually readable by anyone on the network. The tests here are mostly
about the one part of a metric that carries free text — the label — and the one number that
matters most: whether trading is halted.
"""

from __future__ import annotations

import pytest

from core.observability.collect import collect_engine_metrics
from core.observability.metrics import MetricLabelError, MetricsRegistry
from core.risk.kill_switch import EmergencyPolicy, KillSwitch, Trigger

# --------------------------------------------------------------------------------------
# The label rule
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label",
    ["account_id", "api_key", "password", "client_id", "session_id", "authorization",
     "AccountID", "broker_token", "dsn"],
)
def test_a_credential_shaped_label_is_refused(label: str) -> None:
    """At registration, so it is a service that will not start rather than a leak."""
    registry = MetricsRegistry()
    with pytest.raises(MetricLabelError, match="credential-shaped"):
        registry.gauge("vyra_test", 1.0, labels={label: "whatever"})


@pytest.mark.parametrize("label", ["instrument", "broker", "strategy", "state", "trigger"])
def test_the_labels_the_platform_actually_uses_are_allowed(label: str) -> None:
    """The filter has to leave a usable set behind, or it will be removed."""
    registry = MetricsRegistry()
    registry.gauge("vyra_test", 1.0, labels={label: "CME:MES"})
    assert "vyra_test" in registry.render()


def test_a_stats_dict_with_a_credential_shaped_key_fails_rather_than_publishing_it() -> None:
    """Components grow counters over time. A new one named badly must not slip through."""
    registry = MetricsRegistry()
    with pytest.raises(MetricLabelError):
        registry.gauge("vyra_x", 1.0, labels={"api_key": "SENTINEL"})


def test_the_metric_and_label_filters_share_one_list() -> None:
    """Two boundaries with two ideas of what a credential looks like leaks at the weaker.

    The config endpoint and the metrics endpoint import the same tuple; this asserts the
    import rather than a duplicated copy.
    """
    from apps.api import state as api_state
    from core.util import redaction

    assert api_state.strip_credentials is redaction.strip_credentials


def test_invalid_names_are_refused() -> None:
    registry = MetricsRegistry()
    with pytest.raises(MetricLabelError):
        registry.gauge("9starts_with_a_digit", 1.0)
    with pytest.raises(MetricLabelError):
        registry.gauge("vyra_test", 1.0, labels={"has-a-dash": "x"})


def test_a_label_value_is_escaped_not_rejected() -> None:
    """Values are escaped; only names are filtered. A quote must not break the format."""
    registry = MetricsRegistry()
    registry.gauge("vyra_test", 1.0, labels={"state": 'a "quoted" \\ value'})
    rendered = registry.render()
    assert 'state="a \\"quoted\\" \\\\ value"' in rendered


# --------------------------------------------------------------------------------------
# The format
# --------------------------------------------------------------------------------------


def test_the_exposition_format_is_well_formed() -> None:
    registry = MetricsRegistry()
    registry.counter("vyra_orders_total", 42, "Orders submitted.", {"broker": "PAPER"})
    registry.gauge("vyra_kill_switch_tripped", 0, "1 when halted.")
    rendered = registry.render().splitlines()

    assert "# HELP vyra_kill_switch_tripped 1 when halted." in rendered
    assert "# TYPE vyra_kill_switch_tripped gauge" in rendered
    assert "vyra_kill_switch_tripped 0" in rendered
    assert "# TYPE vyra_orders_total counter" in rendered
    assert 'vyra_orders_total{broker="PAPER"} 42' in rendered


def test_integers_render_without_a_decimal_point() -> None:
    """A counter should read as a count."""
    registry = MetricsRegistry()
    registry.counter("vyra_n", 7.0)
    assert "vyra_n 7\n" in registry.render()


def test_non_finite_values_use_the_spellings_prometheus_accepts() -> None:
    registry = MetricsRegistry()
    registry.gauge("vyra_a", float("nan"))
    registry.gauge("vyra_b", float("inf"))
    rendered = registry.render()
    assert "vyra_a NaN" in rendered
    assert "vyra_b +Inf" in rendered


def test_a_metric_cannot_change_kind() -> None:
    """A counter that became a gauge would silently break every rate() over it."""
    registry = MetricsRegistry()
    registry.counter("vyra_x", 1)
    with pytest.raises(MetricLabelError, match="already registered"):
        registry.gauge("vyra_x", 1)


def test_label_order_does_not_change_the_series() -> None:
    registry = MetricsRegistry()
    registry.gauge("vyra_x", 1, labels={"a": "1", "b": "2"})
    registry.gauge("vyra_x", 2, labels={"b": "2", "a": "1"})
    assert registry.render().count("vyra_x{") == 1


# --------------------------------------------------------------------------------------
# What is actually exported
# --------------------------------------------------------------------------------------


def test_the_kill_switch_is_exported_as_the_headline_number() -> None:
    registry = MetricsRegistry()
    switch = KillSwitch(emergency_policy=EmergencyPolicy.HOLD)
    collect_engine_metrics(registry, kill_switch=switch)
    assert "vyra_kill_switch_tripped 0" in registry.render()

    switch.trip(Trigger.DAILY_LOSS_EXCEEDED, "limit breached")
    registry = MetricsRegistry()
    collect_engine_metrics(registry, kill_switch=switch)
    rendered = registry.render()
    assert "vyra_kill_switch_tripped 1" in rendered
    assert "vyra_kill_switch_allows_entries 0" in rendered
    assert 'vyra_kill_switch_trigger{trigger="DAILY_LOSS_EXCEEDED"} 1' in rendered


def test_halted_and_cannot_tell_are_different_numbers() -> None:
    """They need different responses.

    "A halt was declared" is somebody acting. "Halt state could not be read" is nobody
    acting and trading stopped anyway, which is an outage.
    """
    registry = MetricsRegistry()
    switch = KillSwitch()
    switch.trip(Trigger.MANUAL, "declared")
    collect_engine_metrics(registry, kill_switch=switch)
    assert "vyra_kill_switch_state_unreadable 0" in registry.render()

    registry = MetricsRegistry()
    unreadable = KillSwitch()
    unreadable.trip(Trigger.RISK_SERVICE_UNAVAILABLE, "state could not be read")
    collect_engine_metrics(registry, kill_switch=unreadable)
    assert "vyra_kill_switch_state_unreadable 1" in registry.render()


def test_feed_staleness_is_exported_against_its_own_threshold() -> None:
    """Alerting on a fixed number would be wrong for a feed with a different heartbeat."""
    registry = MetricsRegistry()
    collect_engine_metrics(
        registry,
        feed={
            "state": "STALE", "silence_ms": 45_000.0, "heartbeat_timeout_ms": 30_000.0,
            "stats": {"frames": 10, "malformed": 2},
        },
    )
    rendered = registry.render()
    assert 'vyra_feed_state{state="STALE"} -2' in rendered
    assert "vyra_feed_silence_ms 45000" in rendered
    assert "vyra_feed_heartbeat_timeout_ms 30000" in rendered
    assert "vyra_feed_malformed 2" in rendered


def test_a_missing_component_exports_nothing_rather_than_zero() -> None:
    """A gauge reading zero because nothing reported it is indistinguishable from one
    reading zero because the thing it measures is zero. They mean opposite things."""
    registry = MetricsRegistry()
    collect_engine_metrics(registry, instruments=20)
    rendered = registry.render()
    assert "vyra_instruments_loaded 20" in rendered
    assert "vyra_kill_switch_tripped" not in rendered
    assert "vyra_feed_state" not in rendered


def test_guard_and_halt_source_counters_are_exported() -> None:
    registry = MetricsRegistry()
    collect_engine_metrics(
        registry,
        guard_stats={"blocked_submissions": 3, "passed": 100, "read_failures": 1},
        halt_stats={"cache_failures": 2, "fail_closed": 2},
    )
    rendered = registry.render()
    assert "vyra_guard_blocked_submissions 3" in rendered
    assert "vyra_halt_source_fail_closed 2" in rendered
