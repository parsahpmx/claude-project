# Reconciliation exhausted

**Page. Any hour.**

`GET /health/payments` → `backlog.exhausted > 0`.

## What it means

The reconciliation worker tried every attempt (12, over roughly six hours of
backoff) and still cannot say whether a payment settled. By construction
nothing else will resolve it — `EXHAUSTED` exists precisely to mean "a human
must look".

Each row is potentially a payer who paid and was not served. This is the one
incident in the product where money may have moved without a service being
delivered.

## Immediately

```sql
SELECT id, payment_request_id, chain_id, payer_address, authorization_nonce,
       amount_minor_units, attempts, last_result, created_at
FROM settlement_reconciliations
WHERE status = 'EXHAUSTED'
ORDER BY created_at;
```

`last_result` says what the worker could not get past. Almost always one of:

**"rpc unreachable" / oracle unavailable.** The chain was never readable.
Check `dependencies.blockchain` and [RPC_OUTAGE](RPC_OUTAGE.md). If the RPC is
healthy now, requeue (below) — the worker will resolve it on the next pass.

**"Authorization was consumed but the transaction could not be located yet."**
The chain says the money moved but the worker could not find the transaction.
The payment is real; the provenance is missing. Widen the log search window
(`lookbackBlocks` on the oracle) and requeue.

**"authorization was not accepted (…)"** The chain says settled, but
`authorizePayment` refused. Read the reason in the parentheses — the common
one is `TRANSACTION_ALREADY_USED`, meaning that transaction already settled a
different payment request. That is a genuine anomaly. **Stop and escalate; do
not requeue.**

## To requeue, once you know why

```sql
UPDATE settlement_reconciliations
SET status = 'PENDING', attempts = 0, next_attempt_at = now()
WHERE id = '<reconciliation id>';
```

Resetting `attempts` gives it the full backoff again. Do this only after the
underlying cause is fixed; otherwise it will exhaust again in six hours and
page someone else.

## To confirm what actually happened, independently

The authoritative answer is on the chain, not in our database:

```
authorizationState(payer_address, authorization_nonce)  # on the USDC contract
```

`true` means the money moved. `false` past `valid_before` means it never can.

## If a payer paid and was not served

Meter402 cannot refund — it never held the funds. The merchant must. Give them
the payer address, the amount, and the transaction hash, and record the
resolution against the payment request.

## Do not

- Do not mark a row `RESOLVED_FAILED` to clear the alert. That asserts the
  payment did not happen, and if you are wrong a payer is told their money
  vanished.
- Do not re-run `/settle`. Reconciliation never does, and neither should you:
  that is how one payment becomes two charges.
