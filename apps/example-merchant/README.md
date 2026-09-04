# Example merchant

A paid API in one file. `POST /research` costs 0.03 USDC.

```bash
export METER402_API_KEY=...       # from `meter402 init`
export METER402_URL=http://127.0.0.1:4100
pnpm --filter @meter402/example-merchant start
```

Then, from another terminal:

```bash
curl -X POST http://127.0.0.1:3000/research -H 'content-type: application/json' -d '{"topic":"agent payments"}'
# → 402, with a payment challenge

meter402 test-payment <paymentRequestId>
# → prints a meter402-payment header

curl -X POST http://127.0.0.1:3000/research \
  -H 'content-type: application/json' \
  -H 'meter402-payment: <the header from above>' \
  -d '{"topic":"agent payments"}'
# → 200, with the result and the receipt
```

The interesting thing about `src/server.ts` is how little of it is about
payments: two imports, one client, one `preHandler`. The `research` function
has no idea it is being paid for.
