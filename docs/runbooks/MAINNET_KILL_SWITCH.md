# The kill switch

Any real-money incident where you need settlement to stop now.

## What it is

```bash
LIVE_SETTLEMENT_ENABLED=false
```

Then restart. Real settlement stops on every network. The rest of the API keeps
serving: reads work, TEST payments work, merchants can still see their data.

**It is not reachable from any merchant credential.** No API-key scope grants
it, no route exposes it. It is deployment configuration, which means turning it
off requires the access to change a deployment — deliberately a higher bar than
anything a leaked key provides.

## What it stops, and what it does not

**Stops:** new x402 verification and settlement. Every paid endpoint on a real
protocol refuses immediately.

**Does not stop:** payments already submitted to the facilitator. Those are on
their way to the chain and nothing here recalls them. They become uncertain
settlements and reconciliation resolves them — which is what you want: money
that moved should be recorded.

**Does not stop:** simulated TEST payments. No real money is involved, and
stopping them would take down every merchant's development environment during
someone else's incident.

## When to use it

- A settlement destination was changed by someone unauthorised.
- The facilitator is behaving in a way you do not understand — not down, which
  is safe, but *wrong*.
- Any credible report of money moving incorrectly.

## When not to

- A facilitator outage. Nothing is lost; the switch adds nothing.
- An RPC outage. Settlement does not depend on our RPC.
- High load. That is a scaling problem.

## Verify it took

```bash
curl -s https://your-api/health/payments | jq '.settlement, .enabledNetworks'
# → "disabled", []
```

## Turning it back on

Only after the cause is understood and fixed. Then:

1. Restore `LIVE_SETTLEMENT_ENABLED=true` and restart.
2. The startup preflight checks the facilitator supports `exact` on your
   network and **refuses to boot** if not — so a wrong URL fails loudly here.
3. Confirm `settlement: "available"`.
4. Watch `backlog.uncertainSettlements` drain.

## Mainnet

`ENABLE_BASE_MAINNET` is a second, independent switch and is **off**. Enabling
it requires `LIVE_SETTLEMENT_ENABLED` too, and the config refuses to boot if
they disagree. It stays off until `MAINNET_READINESS.md` says otherwise —
which today it does not.
