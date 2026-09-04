# Backup and restore

## Status

**Untested.** The procedure below is written and has not been exercised —
there is no deployed environment to exercise it against. A backup procedure
nobody has restored from is a hypothesis, and this document says so rather
than implying otherwise.

Restoring successfully into a scratch database is a launch requirement; see
[`LAUNCH_READINESS.md`](LAUNCH_READINESS.md).

## What is worth backing up

One PostgreSQL database. Everything Meter402 knows is in it: organizations,
projects, keys, endpoints, prices, payment requests, payments, receipts, audit
events, and the reconciliation queue.

Redis holds nothing durable — rate-limit counters, which regenerate.

**The chain is not backed up and does not need to be.** Settlement records live
on Base. That is the useful half of the "restore" story: if our database and
the chain disagree, the chain is right, and reconciliation exists to make ours
agree with it.

## Targets

| | Target | Why |
| --- | --- | --- |
| **RPO** — data we can afford to lose | **5 minutes** | The window in which a payment could be settled on-chain with no local record. Reconciliation can recover those from `authorizationState`, so the real cost is delay rather than loss. |
| **RTO** — time to be serving again | **1 hour** | Long enough to restore and verify without rushing; short enough that agents' retries have not all given up. |

Both are proposals. Neither has been measured.

## Schedule

- **Continuous:** point-in-time recovery (WAL archiving), giving the 5-minute
  RPO. Managed Postgres providers do this; self-hosted needs it configured.
- **Daily:** a full `pg_dump`, retained 30 days.
- **Weekly:** one retained 12 months.

## Taking one

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" \
  > "meter402-$(date -Is).dump"
```

Encrypt at rest. The dump contains API key *hashes* (peppered HMAC, not
reversible without the pepper) and every merchant's settlement address. Not
catastrophic, and not something to leave in a public bucket either.

## Restoring

```bash
createdb meter402_restore
pg_restore --no-owner --no-acl --dbname meter402_restore meter402-<timestamp>.dump

# Prove it before pointing anything at it.
psql meter402_restore -c 'SELECT count(*) FROM payments;'
psql meter402_restore -c 'SELECT max(created_at) FROM payments;'
psql meter402_restore -c "SELECT count(*) FROM settlement_reconciliations WHERE status <> 'RESOLVED_CONFIRMED';"
```

## After any point-in-time restore, reconcile against the chain

**This is the step that matters, and it is easy to skip.**

Restoring to a point in the past means the database has no record of anything
that happened after it — but the chain does. Payments settled in that window
exist on Base and not in the restored database.

1. Note the restore point.
2. Find every payment request created before it that is not `CONFIRMED`.
3. For each, ask the token contract:
   `authorizationState(payer_address, authorization_nonce)`.
4. `true` means the money moved and the restored database is wrong.
5. Enqueue those for reconciliation; the worker records them properly.

The reconciliation worker was built for exactly this shape of problem, so this
is a matter of enqueuing rather than of writing anything by hand.

## What restoring cannot fix

**Nothing on the chain rolls back.** A payment that settled stays settled. A
restore that loses the local record does not un-take the payer's money — it
only makes us forget, which is why step 4 above is not optional.

## Testing this

Quarterly, into a scratch database, timed. Record the actual restore time
against the RTO. A backup nobody has restored from is not a backup.
