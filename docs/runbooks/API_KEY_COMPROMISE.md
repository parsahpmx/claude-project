# API key compromise

**Page** if it is a LIVE key. **Ticket** for TEST.

A merchant reports a leaked key, one appears in a public repository, or
`authorization_replay_attempts` spikes from one credential.

## What a stolen key can and cannot do

Worth knowing before you panic, because the answer is narrower than it looks.

**Can:** authorize requests against that project's endpoints, read that
project's payments and receipts, drive the TEST simulator (TEST keys only).

**Cannot:** change where money goes. Settlement destinations are human-only —
no API-key scope grants it, and the capability does not exist for machines.
That is the property that turns this from a treasury incident into an
operational one.

**Cannot:** reach another project or another organization. The project comes
from the credential; there is no ID to substitute.

**Cannot:** create or reprice endpoints. Also human-only.

## Immediately

Revoke. It takes effect on the very next request — there is no cache and no
grace period.

```bash
curl -X DELETE "https://your-api/v1/projects/$PROJECT/api-keys/$KEY_ID" \
  -H "authorization: Bearer $SESSION"
```

Or rotate, if the merchant needs continuity: rotation issues a new secret and
kills the old one in the same transaction.

## Then assess

```sql
SELECT id, status, amount_minor_units, created_at
FROM payments
WHERE project_id = '<project>' AND created_at > '<when the key leaked>'
ORDER BY created_at DESC;
```

An attacker with a merchant's key can *authorize* requests, which spends
payments that agents made. Each such payment bought a request the payer did
not get. Reconcile with the merchant.

Also check the audit log for anything the key touched:

```sql
SELECT action, resource_type, resource_id, created_at
FROM audit_events
WHERE actor_type = 'api_key' AND actor_id = '<key id>'
ORDER BY created_at DESC;
```

## Tell the merchant

- Which key, when revoked, and what it could reach.
- That their settlement destination could not have been changed by it.
- To check whether the leak also exposed anything else in the same file — a
  key in a committed `.env` is rarely alone.

## Prevention that is already in place

`meter402 init` refuses to write a key into `.env` unless `.env` is
git-ignored, and `meter402 doctor` warns when it is not. If this key came from
a committed `.env`, that is worth saying in the postmortem: the tooling tries
to prevent exactly this.
