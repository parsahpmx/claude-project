"""Turning engine state into metrics.

Everything here reads counters components already keep. Nothing instruments the hot path a
second time: a metric computed separately from the number the engine acts on is a metric
that will eventually disagree with it, and the disagreement will be discovered during an
incident.

The four families the platform is required to export, and why each one:

* **Kill-switch state.** The single most important number: whether the platform may trade.
  Exported as a gauge, and as a second gauge saying *why* it cannot be read, because "halted"
  and "cannot tell, so halted" need different responses.
* **Feed staleness.** Silence, in milliseconds, against the heartbeat timeout. An open socket
  that stopped delivering is the failure every naive check calls healthy.
* **Order flow.** Submissions, rejections, and refusals at the venue boundary. A drop in
  order flow with no refusals is a strategy problem; a drop with refusals is a halt.
* **Latency.** Round-trip times the execution engine already records.
"""

from __future__ import annotations

from typing import Any

from core.observability.metrics import MetricsRegistry

__all__ = ["collect_engine_metrics"]

# Documented thresholds. They are not enforced here — this module exports, it does not
# decide — but a threshold nobody wrote down is a threshold nobody can alert on, and the
# numbers below are the ones the specifications already use.
#
#   vyra_feed_silence_ms       > vyra_feed_heartbeat_timeout_ms  -> page, and auto-trip
#                                                                   MARKET_DATA_STALE
#   vyra_feed_state != 1 (CONNECTED) for > 60s                   -> page
#   vyra_kill_switch_tripped == 1                                -> page immediately
#   vyra_kill_switch_state_unreadable == 1                       -> page immediately;
#                                                                   trading is halted and
#                                                                   nobody declared it
#   vyra_guard_blocked_submissions increasing                    -> expected during a halt,
#                                                                   investigate otherwise
#   vyra_order_latency_ms p99    > 500                           -> investigate; the
#                                                                   execution engine already
#                                                                   logs abnormal_latency at
#                                                                   this threshold
FEED_STALENESS_PAGE_MS = 30_000.0
ORDER_LATENCY_WARN_MS = 500.0

_FEED_STATES: dict[str, float] = {
    "CONNECTED": 1.0,
    "CONNECTING": 0.5,
    "RESYNCING": 0.5,
    "NOT_ATTACHED": 0.0,
    "DISCONNECTED": -1.0,
    "STALE": -2.0,
    "UNKNOWN": -3.0,
    "FAILED": -4.0,
}


def collect_engine_metrics(
    registry: MetricsRegistry,
    kill_switch: Any = None,
    feed: dict[str, Any] | None = None,
    guard_stats: dict[str, int] | None = None,
    halt_stats: dict[str, int] | None = None,
    instruments: int | None = None,
    runs_available: int | None = None,
) -> None:
    """Populate ``registry`` from whatever the caller has.

    Every argument is optional because not every process has every component. A missing
    component exports nothing rather than exporting a zero — a gauge reading zero because
    nothing reported it is indistinguishable from one reading zero because the thing it
    measures is zero, and the two mean opposite things.
    """
    if kill_switch is not None:
        registry.gauge(
            "vyra_kill_switch_tripped",
            1.0 if kill_switch.is_tripped else 0.0,
            "1 when trading is halted. The single number to alert on.",
        )
        registry.gauge(
            "vyra_kill_switch_allows_entries",
            1.0 if kill_switch.allows_new_entries() else 0.0,
            "1 when new positions may be opened.",
        )
        registry.gauge(
            "vyra_kill_switch_history_entries",
            float(len(kill_switch.history)),
            "Trips and resets recorded in the audit trail.",
        )
        record = kill_switch.trip_record
        # The trigger goes in a label rather than the metric name: an operator wants to see
        # which condition halted trading without a separate metric per condition.
        registry.gauge(
            "vyra_kill_switch_state_unreadable",
            1.0 if (record is not None and record.trigger.value == "RISK_SERVICE_UNAVAILABLE")
            else 0.0,
            "1 when the platform is halted because halt state could not be read, rather "
            "than because a halt was declared. Needs a different response.",
        )
        if record is not None:
            registry.gauge(
                "vyra_kill_switch_trigger",
                1.0,
                "The condition that halted trading, as a label.",
                labels={"trigger": record.trigger.value},
            )

    if feed is not None:
        state = str(feed.get("state", "UNKNOWN"))
        registry.gauge(
            "vyra_feed_state",
            _FEED_STATES.get(state, -3.0),
            "1 connected, 0 not attached, negative for every way of being unhealthy. "
            "STALE is its own value: an open socket that stopped delivering.",
            labels={"state": state},
        )
        silence = feed.get("silence_ms")
        if isinstance(silence, int | float):
            registry.gauge(
                "vyra_feed_silence_ms",
                float(silence),
                "Milliseconds since the last frame of any kind, heartbeats included.",
            )
        timeout = feed.get("heartbeat_timeout_ms")
        if isinstance(timeout, int | float):
            registry.gauge(
                "vyra_feed_heartbeat_timeout_ms",
                float(timeout),
                "Silence beyond which the feed is treated as down. Alert on silence "
                "exceeding this, not on a fixed number.",
            )
        stats = feed.get("stats")
        if isinstance(stats, dict):
            registry.observe_all(
                "vyra_feed", stats, "Frames, events, and everything dropped or malformed."
            )

    if guard_stats is not None:
        registry.observe_all(
            "vyra_guard",
            guard_stats,
            "Outbound calls the venue-boundary guard allowed or refused.",
        )

    if halt_stats is not None:
        registry.observe_all(
            "vyra_halt_source",
            halt_stats,
            "How halt state was resolved: cache, durable store, or failing closed.",
        )

    if instruments is not None:
        registry.gauge(
            "vyra_instruments_loaded", float(instruments), "Instruments in the registry."
        )
    if runs_available is not None:
        registry.gauge(
            "vyra_runs_available", float(runs_available), "Completed runs on disk."
        )
