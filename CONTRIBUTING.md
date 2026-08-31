# Contributing to Meter402

## Setup

Node 22+, pnpm 10+, Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Strict TypeScript across every package |
| `pnpm lint` | ESLint |
| `pnpm build` | Build every package |
| `pnpm format` | Prettier |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |

Scope to one package with `pnpm --filter @meter402/payments test`.

## Branches and commits

Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.

Commits: [Conventional Commits](https://www.conventionalcommits.org/). The
subject says what changed; **the body says why**. A diff shows what happened;
it cannot show what you considered and rejected, and that is the part the next
person needs.

## Definition of done

A feature is not done because the code exists. Done means:

- [ ] Implemented
- [ ] Tests pass — **actually executed, not assumed**
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] Migration included if the schema changed
- [ ] Authorization and tenant scoping considered and tested
- [ ] Input validated at the boundary
- [ ] Error states handled, including in the UI
- [ ] Observability: request ID, structured logs, no secrets logged
- [ ] Documentation updated

## Code review checklist

Correctness · Security · Tests · **Authorization** · **Tenant isolation** ·
Input validation · Error handling · Observability · Migration safety ·
Performance · Documentation.

Reviewers should push back hardest on authorization and tenant isolation.
Those are the defects that are invisible in a diff and expensive in
production.

## Non-negotiables

Do not, under any circumstances:

- Use floating-point arithmetic for money. Use `Money` from
  `@meter402/shared`. (ESLint will fail the build.)
- Weaken TypeScript strictness to silence an error. Fix the type.
- Use `any` in a payment-critical package.
- Store a plaintext API key or secret.
- Skip an authorization or tenant-scope check.
- Trust blockchain data supplied by a client.
- Invent cryptography. Use vetted libraries and standard constructions.
- Commit a secret. `.env.example` is the only environment file that may be
  committed, and it contains no real values.
- Claim tests pass without running them.
- Disable or delete a failing test to get to green.

## Testing

Payment-critical code — `packages/payments`, `packages/blockchain`,
`packages/x402`, `packages/shared` — carries a very high coverage bar. The rest
of the codebase is measured by whether the tests are meaningful, not by a
percentage. We are not optimising a coverage number.

Test the failure paths. In a payments system the interesting cases are the
rejections: wrong amount, wrong recipient, expired request, replayed
transaction, RPC outage. A suite that only covers the happy path tells you
nothing about the day it matters.

Write tests that would fail if the behaviour regressed. A test that passes
against both the correct and the broken implementation is worse than none —
it costs maintenance and buys false confidence.

## Adding a package

1. `packages/<name>/` with `package.json`, `tsconfig.json`,
   `tsconfig.build.json`, `src/index.ts`.
2. Copy the tsconfig pair from an existing package — they are identical by
   design.
3. Add workspace dependencies as `"@meter402/x": "workspace:*"`.
4. Use `catalog:` for third-party versions, never a literal range. The catalog
   in `pnpm-workspace.yaml` is the single source of version truth.

## Security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
