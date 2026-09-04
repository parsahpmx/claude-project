# Payments stuck unresolved

**Page** when the oldest is over an hour, or the count is climbing.

`backlog.oldestUnresolvedAgeSeconds > 3600`, or `uncertainSettlements` rising
by more than 10 in 15 minutes.

## What it means

Payments whose outcome nobody knows. The worker is retrying; each is a payer
who may have paid and not been served, and each is bounded — after 12 attempts
it becomes `EXHAUSTED`, which is [its own runbook](RECONCILIATION_EXHAUSTED.md).

A steady small number is normal. **Rising** means uncertainty is being produced
faster than it is resolved, which compounds.

## Check, in order

**Is the worker running at all?** The single most common cause. It is a
separate process (`pnpm --filter @meter402/api worker`); if nobody deployed it,
nothing resolves anything.

```sql
SELECT max(last_attempt_at) FROM settlement_reconciliations;
```

Older than a few minutes with a non-empty queue means no worker.

**Can the worker read the chain?** `dependencies.blockchain` on
`/health/payments`. An unreachable RPC produces exactly this shape: nothing
resolves, everything retries. → [RPC_OUTAGE](RPC_OUTAGE.md)

**Is the facilitator producing new uncertainty?** `verify_unavailable` and
`settle_uncertain` climbing means the queue is being filled faster than
drained. → [FACILITATOR_OUTAGE](FACILITATOR_OUTAGE.md)

**Is one payment failing repeatedly?**

```sql
SELECT payment_request_id, attempts, last_result
FROM settlement_reconciliations
WHERE status = 'PENDING' ORDER BY attempts DESC LIMIT 20;
```

A single row with high `attempts` is a specific problem. Many rows with
`attempts = 1` is a dependency problem.

## To drain faster

Run more workers. They partition the queue with `FOR UPDATE SKIP LOCKED`, so
adding processes is safe and needs no coordination.

## Do not

- Do not delete rows to clear the backlog. Each is a payment whose outcome is
  unknown; deleting it makes it unknown *forever*.
- Do not shorten the backoff to "resolve faster". The backoff exists because
  the thing being waited on is usually a chain or a provider that is not ready.
