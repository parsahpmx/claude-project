# Observability

What the platform exports, and what should wake somebody up.

The paging integration is out of scope — there is no Alertmanager here — but a threshold
nobody wrote down is a threshold nobody can alert on, so the numbers are recorded now,
next to the metric that carries them.

## Endpoint

`GET /metrics`, Prometheus text exposition format, **authenticated** (viewer role).

Most `/metrics` endpoints are left open on the argument that they carry nothing sensitive.
That is a statement about the labels, and it is true only while every label stays clean.
Requiring a token costs one line of scrape config and removes the need for that assumption
to hold forever.

Label *names* are filtered through the same credential list as the config endpoint
(`core.util.redaction`), and a credential-shaped label is a `MetricLabelError` at
registration — a service that will not start, rather than one that quietly publishes an
account id. Label *values* are escaped but not inspected: a secret cannot be recognised by
looking at it. What can be recognised is the field that conventionally holds one.

Keep label values low-cardinality — an instrument id, a broker id, a state name. The
cardinality rule and the credential rule are the same rule: anything unique per account or
per session belongs in neither.

## What to alert on

| Condition | Severity | Why |
|---|---|---|
| `vyra_kill_switch_tripped == 1` | page | Trading is halted. Somebody or something decided that; find out which. |
| `vyra_kill_switch_state_unreadable == 1` | page | Trading is halted **and nobody declared it**. The switch could not read its own state and failed closed. This is an outage, not a risk event, and it needs a different response. |
| `vyra_feed_silence_ms > vyra_feed_heartbeat_timeout_ms` | page, and auto-trip `MARKET_DATA_STALE` | An open socket that stopped delivering. Alert against the feed's *own* timeout, never a fixed number — a 1s heartbeat and a 30s heartbeat are both healthy, at different numbers. |
| `vyra_feed_state < 0` for > 60s | page | Any of the unhealthy states. `STALE` (-2) is the dangerous one; `UNKNOWN` (-3) means the feed could not answer, which is not a passing health check either. |
| `vyra_feed_state == 0` | none | `NOT_ATTACHED`: nothing is subscribed. Normal in a research deployment, wrong in a live one — alert on it only where a feed is expected. |
| `rate(vyra_guard_blocked_submissions[5m]) > 0` while `vyra_kill_switch_tripped == 0` | page | The venue boundary is refusing orders that the kill switch says should be allowed. The two disagree, which should be impossible. |
| `vyra_guard_read_failures` increasing | page | The guard could not read halt state and failed closed on each attempt. |
| `vyra_halt_source_fail_closed` increasing | page | Halt state could not be established. Trading has stopped for a reason nobody chose. |
| `vyra_halt_source_stale_epochs_rejected > 0` | investigate | A stale halt state was offered and refused. The refusal is correct; something is replaying or restoring old cache values. |
| `rate(vyra_feed_malformed[5m]) > 0` | investigate | A protocol mismatch with the venue. Frames are dropped, not guessed at, so this is silent data loss until somebody looks. |
| `vyra_feed_dropped_full_queue` increasing | investigate | The engine is consuming slower than the feed produces. The oldest events are being dropped. |
| order round-trip p99 > 500 ms | investigate | The execution engine already logs `abnormal_latency` at this threshold. |

## What is deliberately not exported

**Anything per-account or per-session.** Account identifiers, order ids, and client ids are
all high-cardinality *and* identifying — the two reasons to keep something out of a label
happen to coincide.

**Anything the engine does not already count.** Every metric here reads a counter a
component already keeps. A metric computed separately from the number the engine acts on is
a metric that will eventually disagree with it, and the disagreement gets discovered during
an incident.

**Latency histograms.** Not yet: the execution engine keeps a rolling list of round-trip
times but does not bucket them, and exporting a mean would invite somebody to alert on a
number that hides the tail. It goes in when the buckets do.

## Not built

OpenTelemetry traces, Grafana dashboards, and the paging integration itself. The structured
log schema (`core.util.logging`) was designed so exporters need no engine change, and this
exporter is the first one; a trace exporter would read the same fields.
