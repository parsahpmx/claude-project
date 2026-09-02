# Alerting

What to page on, what to ticket, and what to leave alone.

Every threshold below is stated against a signal the system actually emits
today — `/health/payments`, or a counter in `paymentMetrics`. A runbook that
alerts on a metric nobody publishes is worse than no runbook, because it reads
as coverage.

## The principle

Meter402 sits between an agent's money and a merchant's service. Almost
everything that breaks costs someone a request; a small number of things cost
someone money, or take money without delivering. **Only the second kind wakes a
human.**

That distinction, not severity in the abstract, is what sorts the table below.

## Signals

`GET /health/payments` returns:

```jsonc
{
  "settlement": "available" | "degraded" | "disabled",
  "enabledNetworks": ["eip155:84532"],
  "dependencies": { "facilitator": true, "blockchain": true },
  "backlog": {
    "pendingSettlements": 0,        // authorized, outcome still open
    "reconciliationBacklog": 0,     // jobs queued or in flight
    "exhausted": 0,                 // jobs the worker gave up on
    "uncertainSettlements": 0,      // total unknown-outcome payments
    "oldestUnresolvedAgeSeconds": null
  },
  "metrics": { /* paymentMetrics counters */ }
}
```

`backlog` is `{ "unavailable": true }` when the database could not be read.
That is itself a signal — see the table.

## Page (wake someone, any hour)

| Condition | Why it cannot wait |
| --- | --- |
| `backlog.exhausted > 0` | The worker tried every attempt and still cannot say whether money moved. By construction nothing else will resolve it — EXHAUSTED exists precisely to mean "a human must look". Each row is one payer who may have paid for nothing. |
| `backlog.oldestUnresolvedAgeSeconds > 3600` | An uncertain settlement has outlived every backoff the worker has. Either the chain is unreachable to us or something is wrong with reconciliation itself. |
| `backlog.uncertainSettlements > 20`, or up by more than 10 in 15 minutes | Individual uncertainty is expected and handled. A *rising* count means uncertainty is being produced faster than it is resolved, which is a failure mode that compounds. |
| `authorization_replay_attempts` rising steadily | Someone is presenting the same authorization repeatedly. The guard holds, but a sustained rate is an attack in progress and worth a human deciding whether to use the kill switch. |
| `settlement: "degraded"` for more than 15 minutes while `settlementEnabled` | Paid endpoints are failing for every merchant on the deployment. |

## Ticket (business hours)

| Condition | Why it can wait |
| --- | --- |
| `settlement: "degraded"` under 15 minutes | Facilitator and RPC blips are normal. The payment path already treats an unreachable dependency as "not the payer's fault" and does not fail a payment that may be valid. |
| `reconciliation_retry` elevated with `uncertainSettlements` flat | The worker is doing its job: retrying without concluding anything. Worth understanding, not worth waking for. |
| `rpc_error` elevated with settlement still `available` | Failover is absorbing it. |
| `backlog: { unavailable: true }` while `/ready` is healthy | The health endpoint could not read the backlog but the database is otherwise fine. A bug in the query rather than an incident. |
| `reconciliation_definitive_failure` above its usual rate | Authorizations expiring unused. Usually agents abandoning payment, occasionally a client bug worth telling a merchant about. |
| `wrong_amount_attempts`, `wrong_recipient_attempts`, `wrong_network_attempts` rising | All are rejected before money moves. A rise usually means a broken client, not an attacker; a *sharp* rise from one source is worth looking at. |

## Do not alert

- `settlement: "disabled"`. That is a configuration, and a deployment with
  settlement off is perfectly healthy. Alerting on it teaches operators to
  ignore this endpoint.
- A single `reconciliation_retry`. One retry is the design working.
- `pendingSettlements > 0` on its own. Payments in flight are what a working
  system looks like. The number that matters is how long the *oldest* has been
  in flight, which is the row above.

## The threshold that will need tuning first

`uncertainSettlements > 20` is a guess. It is calibrated against nothing,
because this deployment has never processed real traffic — see
`docs/MAINNET_READINESS.md`. Replace it with a multiple of the observed steady
state once there is one, and treat the first month's numbers as data rather
than as a baseline to defend.

## What is deliberately not here

Alerts on Payment or Receipt *counts* — "settlements dropped 40% hour over
hour" and similar. Those are business metrics, and paging on them trains
operators to treat quiet Sundays as incidents.

Alerts on individual merchants. Everything above is deployment-wide, matching
what `/health/payments` exposes: the endpoint carries volumes and ages, never
identifiers, so that an operational dashboard cannot become a leak of who is
paying whom.
