# Secret rotation

**Page** if a secret is exposed. Otherwise scheduled.

## The secrets, and what each one costs

| Secret | If exposed |
| --- | --- |
| `API_KEY_HASH_PEPPER` | Offline attack on every stored key hash becomes feasible. **Worst case here.** |
| `AUTH_SECRET` | Session tokens can be forged. Any human account can be impersonated. |
| `TEST_SIMULATOR_SECRET` | TEST settlement references can be forged. No real money. |
| `WEBHOOK_SIGNING_SECRET` | Currently unused — webhooks are not shipped. |
| `X402_FACILITATOR_API_KEY` | Someone else settles on your facilitator account. |
| `DATABASE_URL` | Everything. Treat as a full compromise. |

The config refuses to start if any two of these are equal, so one exposure
cannot quietly be several.

## `API_KEY_HASH_PEPPER` — the hard one

Key hashes are `HMAC(secret, pepper)`. Changing the pepper invalidates **every
API key at once**: no key can be re-hashed without its plaintext secret, and we
do not have those by design.

So rotating it is a migration, not a config change:

1. Announce a window. Every merchant must re-issue keys.
2. Change the pepper and restart.
3. Every existing key now fails authentication.
4. Merchants issue new keys and redeploy.

If the pepper is exposed, do it anyway — a feasible offline attack on stored
hashes is worse than a planned outage. Budget days, not hours.

## `AUTH_SECRET`

Rotating invalidates every session; people log in again. Cheap.

## `TEST_SIMULATOR_SECRET`

Rotating invalidates outstanding TEST settlement references. Developers rerun
`meter402 test-payment`. Cheapest of the lot.

## `X402_FACILITATOR_API_KEY`

Issue a new credential with the facilitator first, deploy, then revoke the old
one. Reversing that order means an outage between the two steps.

## `DATABASE_URL`

Rotate the password with the provider, then deploy. The pool reconnects; a
brief window of connection errors is expected and `/ready` will report it.

## After any rotation

```bash
curl -s https://your-api/ready
curl -s https://your-api/health/payments | jq '.settlement, .dependencies'
```

Then one real request end to end. A rotation that half-worked looks healthy
until the first customer finds it.

## Where secrets live

Not in the repository, and not in an image layer. A secret manager, injected at
runtime. `.env` is for development only and is git-ignored; `meter402 init`
refuses to write a key into it otherwise.
