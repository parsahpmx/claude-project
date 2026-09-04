# Database outage

**Page.**

`/ready` failing on `database`.

## What it means

Everything is down. Meter402 is a database with payment logic attached: no
database, no authorization, no payments, no reads.

**Nothing is lost.** Every payment-critical write is a transaction guarded by
unique constraints. An interrupted write is rolled back, not half-applied, and
a payment that was mid-settlement becomes an uncertain settlement that
reconciliation resolves.

## Immediately

```bash
psql "$DATABASE_URL" -c 'select 1'
```

- **Connects** → not the database. Check the pool: connection exhaustion looks
  identical from `/ready` and is far more common. `max_connections` versus the
  sum of what the API and every worker hold.
- **Does not connect** → the database itself. Provider status page, then
  failover or restore.

## Restoring

See [BACKUPS.md](../BACKUPS.md) for the procedure and the recovery targets.

**Read the backup's timestamp before restoring.** Restoring to a point before
a settlement means the system has no record of a payment that happened on the
chain — the chain does not roll back with you. After any point-in-time
restore, reconcile every payment request between the restore point and now
against `authorizationState`.

## After recovery

1. `/ready` returns ready.
2. `backlog` on `/health/payments` — expect a spike of uncertain settlements
   from the outage window. That is the design working.
3. Confirm a worker is running to drain them.
4. Spot-check that the newest payment in the database matches the chain.

## Do not

- Do not point the API at a read replica to "stay up". Payments need
  write-consistent reads; a replica would let two requests both believe they
  won a claim.
