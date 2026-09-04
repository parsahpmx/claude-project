# Facilitator outage

**Ticket** under 15 minutes. **Page** beyond that, while settlement is enabled.

`/health/payments` → `settlement: "degraded"`, `dependencies.facilitator: false`.

## What it means

The external service that submits settlements is not answering. Paid endpoints
fail for every merchant on this deployment while it lasts.

**No payment has been lost.** `verify` failing means nothing was charged.
`settle` failing means the outcome is unknown, the payer is told to retry
rather than told they failed, and the payment is queued for reconciliation.
That is the design working; the cost is delay.

## Check

```bash
curl -s "$X402_FACILITATOR_URL/supported"
curl -s https://your-api/health/payments | jq '.dependencies, .backlog'
```

- **`/supported` answers, payments still fail** → not an outage. Check
  `verify_rejected` with reasons; the facilitator may have changed behaviour.
- **`/supported` does not answer** → a real outage. Check their status page.
- **`backlog.uncertainSettlements` climbing** → the outage started mid-settle
  for some payments. → [PENDING_PAYMENTS](PENDING_PAYMENTS.md)

## Options

**Wait.** Usually right. Nothing is lost and the queue drains on recovery.

**Fail over**, if a second facilitator is configured for the same scheme and
network. Change `X402_FACILITATOR_URL` and restart; the startup preflight
refuses to boot against one that does not support `exact` on your chain, so a
wrong URL fails loudly rather than silently.

**Switch off real settlement** (`LIVE_SETTLEMENT_ENABLED=false`) if the outage
is long and you would rather refuse payments cleanly than have every request
time out. Merchants see `LIVE_SETTLEMENT_UNAVAILABLE` instead of latency.

## Do not

- Do not retry `/settle` by hand to "push it through". Reconciliation
  determines what already happened; re-settling is how a payer is charged
  twice.
- Do not mark queued payments failed to clear the backlog.
