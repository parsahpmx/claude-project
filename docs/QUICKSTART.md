# Quickstart

Turn an existing API route into a paid AI-agent service.

You will finish with a route that returns `402 Payment Required` to an unpaid
caller, serves a paid one, and produces a receipt. Target: **under 10 minutes.**

Nothing here requires you to know anything about blockchains. If you find
yourself needing to, that is a bug in this document — please say so.

---

## Before you start

- Node 22+
- pnpm 10+
- A running Meter402 API. To run one locally:

  ```bash
  git clone <this repository> && cd claude-project
  pnpm install
  cp .env.example .env          # then fill in the secrets it names
  docker compose up -d          # Postgres and Redis
  pnpm db:migrate
  pnpm --filter @meter402/api dev
  ```

  It listens on `http://127.0.0.1:4000` by default.

Everything below assumes `METER402_URL` is that address. Adjust if yours
differs.

---

## 1. Set up your project

From the directory of the app you want to monetise:

```bash
export METER402_URL=http://127.0.0.1:4000
npx meter402 init --api-url "$METER402_URL" --path /research --price 0.03
```

This creates an organization, a project, a priced endpoint, and a **TEST** API
key. It writes two files:

- `.meter402.json` — identifiers only. Safe to commit.
- `.env` — your API key. **Not** safe to commit, and `init` refuses to write it
  unless `.env` is already in your `.gitignore`.

It finishes by printing the code for step 2.

---

## 2. Protect your route

```bash
pnpm add @meter402/sdk
```

**Express**

```ts
import { createMeter402 } from '@meter402/sdk';
import { protect } from '@meter402/sdk/express';

const meter = createMeter402({
  apiKey: process.env.METER402_API_KEY!,
  baseUrl: process.env.METER402_URL!,
});

app.post('/research', protect(meter, { price: '0.03' }), researchHandler);
```

**Fastify**

```ts
import { protect } from '@meter402/sdk/fastify';

app.post(
  '/research',
  { preHandler: protect(meter, { price: '0.03' }) },
  researchHandler,
);
```

**Next.js** (App Router)

```ts
import { withMeter402 } from '@meter402/sdk/next';

export const POST = withMeter402(meter, { price: '0.03' }, async (request) => {
  return Response.json({ result: await research() });
});
```

Your handler does not change. It runs only when the request has been paid for.

---

## 3. Check the setup

```bash
npx meter402 doctor
```

Every line is something that could be wrong; every failure says what to do
about it. It exits non-zero when something is broken, so you can put it in CI.

---

## 4. Start your app, and get a 402

```bash
curl -X POST http://localhost:3000/research
```

```
HTTP/1.1 402 Payment Required

{
  "error": "PAYMENT_REQUIRED",
  "payment": {
    "paymentRequestId": "preq_01J...",
    "amount": "30000",
    "asset": { "symbol": "USDC", "decimals": 6 },
    ...
  }
}
```

`amount` is in the asset's smallest unit — `30000` is 0.03 USDC, because USDC
has 6 decimals. You never do this arithmetic yourself; it is shown so the
number is not a surprise.

---

## 5. Pay it

```bash
npx meter402 test-payment preq_01J...
```

This drives the TEST simulator. No real money exists in a TEST project and this
command refuses to run against a LIVE credential at all.

It prints a header to use.

---

## 6. Retry, and be served

```bash
curl -X POST http://localhost:3000/research \
  -H 'meter402-payment: <the header from step 5>'
```

```
HTTP/1.1 200 OK

{ "topic": "...", "summary": "..." }
```

Your handler ran. Try the same proof twice — the second attempt is refused,
because one payment buys one request.

---

## 7. See what happened

```bash
npx meter402 payments
npx meter402 receipts
```

---

## That's it

You have a paid endpoint. What you did not have to know: CAIP-2 chain
identifiers, Base chain IDs, USDC decimals, EIP-3009, EIP-712, facilitator
APIs, replay protection, transaction finality, or anything about a payment
state machine. Meter402 owns all of that.

## Two things worth knowing before production

**TEST is not LIVE.** Everything above is simulated. A TEST project is
structurally incapable of producing a mainnet payment instruction, which is
why the quickstart is safe to run without thinking about it.

**Base mainnet is disabled.** Meter402 does not currently support real-money
settlement on mainnet — see [`MAINNET_READINESS.md`](MAINNET_READINESS.md) for
what would have to be true first. If you are evaluating for production, read
that document before anything else.

## Where to go next

| I want to… | Read |
| --- | --- |
| See a complete working merchant | `apps/example-merchant` |
| See an agent that pays | `apps/example-agent` |
| Charge for an MCP tool | `apps/example-mcp-server` |
| Understand the HTTP contract | [`API.md`](API.md) |
| Understand how payment works | [`PAYMENTS.md`](PAYMENTS.md) |
| Know what is not production-ready | [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md) |

## When something goes wrong

| Symptom | Cause |
| --- | --- |
| `No Meter402 endpoint is registered for POST /research` | The path your framework sees is not the one you registered. Run `meter402 endpoints` to see what exists; pass `path:` to `protect()` if your router is mounted under a prefix. |
| `Price mismatch` at startup | Your code and Meter402 disagree about the price. Change one deliberately — a price is what agents agreed to pay, so it is never adjusted for you. |
| Every request returns 503 | Your app cannot reach Meter402. `meter402 doctor` will say so. The SDK fails closed on purpose: an outage that served requests for free would mean anyone who can degrade us gets your API for nothing. |
| `test-payment` refuses | You are using a LIVE credential. The simulator is TEST-only. |
| The proof works once, then 409 | Working as intended. One payment buys one request. |
