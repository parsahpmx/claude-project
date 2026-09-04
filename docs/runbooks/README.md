# Runbooks

What to do at 3am.

Each of these assumes you have just been paged, know nothing about what is
happening, and need the next command rather than an explanation. Background
belongs in the design docs; these are for acting.

| Runbook | Page trigger |
| --- | --- |
| [RECONCILIATION_EXHAUSTED](RECONCILIATION_EXHAUSTED.md) | `backlog.exhausted > 0` |
| [PENDING_PAYMENTS](PENDING_PAYMENTS.md) | `backlog.oldestUnresolvedAgeSeconds > 3600`, or a rising `uncertainSettlements` |
| [FACILITATOR_OUTAGE](FACILITATOR_OUTAGE.md) | `settlement: "degraded"` with `dependencies.facilitator: false` |
| [RPC_OUTAGE](RPC_OUTAGE.md) | `dependencies.blockchain: false`, or `rpc_error` climbing |
| [DATABASE_OUTAGE](DATABASE_OUTAGE.md) | `/ready` failing on `database` |
| [API_KEY_COMPROMISE](API_KEY_COMPROMISE.md) | A merchant reports a leaked key, or `authorization_replay_attempts` spikes |
| [SETTLEMENT_DESTINATION_CHANGE](SETTLEMENT_DESTINATION_CHANGE.md) | An audited settlement change nobody recognises |
| [MAINNET_KILL_SWITCH](MAINNET_KILL_SWITCH.md) | Any real-money incident |
| [SECRET_ROTATION](SECRET_ROTATION.md) | A secret is exposed, or on schedule |

## The two facts that shape all of them

**Meter402 holds no funds.** Payments move from the payer's wallet to the
merchant's address. There is no balance to freeze, no treasury to drain, and
no incident here can lose money that is sitting with us — because none is.

**An outage is not a payment failure.** Every path in this system treats "we
could not reach a dependency" as unknown rather than failed. So the damage from
most of these incidents is delay, not loss. The exception is
`RECONCILIATION_EXHAUSTED`, which is the one where a payer may have paid for
something they did not get.

## Status quo

Alert thresholds are in [`../ALERTING.md`](../ALERTING.md) and are **guesses**
until real traffic calibrates them. **No alerting is wired to a pager**; these
runbooks describe what to do when someone notices.
