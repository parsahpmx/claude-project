# Meter402

**Billing infrastructure for autonomous software.**

Add machine-native payments to any API or MCP server. An agent calls your
endpoint, receives a payment challenge, pays in USDC on Base, and gets served —
in one request cycle, with no account, card, or human in the loop.

```ts
import { meter402 } from '@meter402/sdk';

app.get(
  '/research',
  meter402({ price: '0.03', currency: 'USDC' }),
  async (req, res) => res.send(await research()),
);
```

> **Project status: early development.** Phases 0–3 are complete and tested:
> the payment domain core, identity and tenancy, billing objects, and a real
> **x402 v2** integration using EIP-3009 signed authorizations on Base Sepolia.
> An independent x402 client can meet a 402, sign an authorization, and be
> served.
>
> **What has not happened: no payment has ever settled on a real chain.**
> Settlement is exercised against a test double, because the development
> environment has no network access to a testnet RPC or a hosted facilitator.
> Independent *client* conformance is verified against the official reference
> library; independent *facilitator* conformance is not.
>
> Consequently **Meter402 does not claim x402 compatibility** — the accurate
> claim is "wire-conformant against the official reference library, pending
> facilitator and testnet verification". **Base mainnet is disabled** behind
> two independent configuration gates and is **NOT READY**; see
> [`docs/MAINNET_READINESS.md`](docs/MAINNET_READINESS.md).
>
> The SDK shown above is the target interface and is **not yet implemented** —
> see [`docs/ROADMAP.md`](docs/ROADMAP.md) for what exists today. This README
> marks planned surfaces explicitly rather than describing them as if they
> shipped.

---

## Why

Buying things on the internet assumes a human: an account, a credit card, a
subscription, an API key issued by hand, an invoice, an approval. Autonomous
software can't work through any of that.

What it needs is: discover a price, decide, pay, get a verifiable receipt,
proceed. Meter402 is the infrastructure for the middle of that loop.

## Architecture in one paragraph

Meter402 sits in the **authorization path, not the data path**. The middleware
decides whether a request may proceed; your handler produces the response, and
that response never transits our infrastructure. We never take custody of
funds either — payments move directly from the agent's wallet to your
settlement address, and we verify independently that it happened. Those two
decisions shape everything else: they keep customer content private, keep a
Meter402 compromise from exposing merchant data, and keep custody out of the
threat model entirely.

## Repository layout

```
apps/
  api/                Fastify control plane (modular monolith)
packages/
  shared/             Money, IDs, errors, chain/asset registry
  payments/           State machine, authorization, protocol adapter interface
  blockchain/         RPC providers, failover, ERC-20 verification
  x402/               x402 protocol adapter
  pricing/            Pricing strategies
  database/           Drizzle schema, migrations, seed
  config/             Validated environment loading
docs/                 Design documents
```

Full target structure, including planned packages, is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Local development

Requires Node 22+, pnpm 10+, and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d          # Postgres + Redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Verify everything:

```bash
pnpm test         # unit and integration tests
pnpm typecheck    # strict TypeScript, all packages
pnpm lint
pnpm build
```

## Design principles

These are enforced by types, database constraints, and lint rules rather than
by convention — a rule you have to remember is not a control.

1. **No floating-point money.** Every amount is a `bigint` count of minor
   units. `$0.03` is exactly `30000n`. ESLint fails the build on `parseFloat`
   or `Math.round` in money code.
2. **Never trust a client's payment claim.** An agent supplies one thing: a
   transaction hash. Amount, recipient, token, and chain all come from our own
   record, and the chain is read independently.
3. **One transaction settles one request.** Enforced by a database `UNIQUE`
   constraint, not an application check that could race.
4. **Payments never move backwards.** A frozen transition table; all 100
   ordered status pairs are asserted in tests.
5. **An outage is not a failure.** If our RPC providers are unreachable we
   don't know what happened, so the payment holds at `PENDING`. Telling an
   agent its valid payment failed would make it pay twice.
6. **TEST can never touch LIVE.** A test project is structurally incapable of
   producing a mainnet payment instruction.

## Documentation

| Document | What it covers |
| --- | --- |
| [PRODUCT_REQUIREMENTS](docs/PRODUCT_REQUIREMENTS.md) | What we're building, for whom, and what would falsify the thesis |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System design and architecture decision records |
| [PAYMENTS](docs/PAYMENTS.md) | Money representation, state machine, verification |
| [DATABASE](docs/DATABASE.md) | Schema, conventions, indexing |
| [SECURITY](docs/SECURITY.md) | Engineering security standards |
| [THREAT_MODEL](docs/THREAT_MODEL.md) | Adversary analysis with mitigation status |
| [API](docs/API.md) | HTTP contract |
| [ROADMAP](docs/ROADMAP.md) | Phases, exit criteria, and release gates |

## What Meter402 is not

Not a bank, exchange, custodian, or stablecoin issuer, and it holds no
regulatory approval. It never takes custody of funds. There is no token, and
there will not be one.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: please follow
[SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

Proprietary. The SDK, protocol adapters, examples, and CLI are intended to be
open-sourced; the hosted control plane is not.
