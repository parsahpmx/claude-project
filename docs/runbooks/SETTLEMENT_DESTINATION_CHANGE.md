# Unexpected settlement destination change

**Page. Treat as an active attack until proven otherwise.**

An audited settlement change nobody recognises.

## Why this is the worst one

A settlement destination is where a merchant's money goes. Changing it is the
single highest-value action in the product — it redirects every future payment
without touching a payment.

Which is why it is human-only, RBAC-gated, and audited in the same transaction
as the change. Those controls mean an unexplained change is not a bug: it is a
compromised human account.

## Immediately

Find it:

```sql
SELECT actor_user_id, action, resource_id, metadata, created_at
FROM audit_events
WHERE action LIKE 'settlement%'
ORDER BY created_at DESC LIMIT 50;
```

The metadata carries the old and new addresses.

**If the change is not recognised by the named user:**

1. Set the destination back to the known-good address.
2. Disable that user's account.
3. Check what else the session did:

```sql
SELECT action, resource_type, resource_id, created_at
FROM audit_events
WHERE actor_user_id = '<user>' ORDER BY created_at DESC LIMIT 200;
```

4. Check whether payments settled to the wrong address in the window:

```sql
SELECT id, amount_minor_units, reference, confirmed_at
FROM payments
WHERE project_id = '<project>' AND confirmed_at > '<change time>';
```

Those funds went to the attacker's address, on-chain, and **cannot be
recovered by Meter402** — we never held them. Involve the merchant
immediately; this is their loss and their decision.

5. Consider the kill switch while you establish scope.
   → [MAINNET_KILL_SWITCH](MAINNET_KILL_SWITCH.md)

## If it was legitimate

Record who, when, and why against the audit event. An unexplained entry in
this table will page someone again in three months.

## Current status

Base mainnet is disabled, so a real-money version of this incident is not
currently possible. It is written now because the day it becomes possible is
not the day to start writing it.
