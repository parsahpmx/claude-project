# RPC outage

**Ticket** while failover is absorbing it. **Page** if reconciliation stalls.

`dependencies.blockchain: false`, or `rpc_error` climbing.

## What it means

Meter402 cannot read the chain. Two consequences, and they are not equally bad:

**Settlement still works.** The facilitator submits transactions; it does not
need our RPC. Payments continue.

**Reconciliation stops.** The worker's only source of truth is
`authorizationState` on the token contract. With no RPC it cannot conclude
anything, so it retries — which is correct, and means uncertain payments
accumulate until the RPC returns.

## Check

```bash
curl -s -X POST "$BASE_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

- **Answers** → the problem is not reachability. Rate limiting is the usual
  next suspect; check for 429s in the logs.
- **Does not answer** → configure `SECONDARY_BASE_RPC_URL` and restart. With a
  secondary configured the provider fails over automatically behind circuit
  breakers.

## While it lasts

Nothing to do about payments. Watch `backlog.uncertainSettlements`: if it
climbs past a few dozen, or anything approaches the 12-attempt limit, add
capacity or extend the deadline before rows start reaching `EXHAUSTED` — an
exhausted row needs a human, and a hundred of them need a bad afternoon.

## Do not

- Do not conclude payments failed because the chain is unreadable. It is a fact
  about our connectivity, not about the payment. Telling a payer their valid
  payment failed makes them pay twice.
