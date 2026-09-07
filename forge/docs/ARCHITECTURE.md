# Architecture

## The shape

```
                    ┌──────────────────────────────────────────┐
   browser ────────▶│  apps/web  (Next.js 15, App Router)      │
                    │  marketing · member app · coach workspace │
                    └───────────────────┬──────────────────────┘
                                        │  /api/*  (same-origin rewrite)
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  apps/api  (Fastify 5)                    │
                    │  auth · plans · training · nutrition ·    │
                    │  coaching · community · commerce · AI     │
                    └───────┬───────────────────────┬──────────┘
                            │                       │
              ┌─────────────▼──────────┐  ┌─────────▼─────────────┐
              │  packages/core         │  │  packages/db          │
              │  the domain, pure      │  │  Drizzle · Postgres   │
              └────────────────────────┘  └───────────────────────┘
```

## Four decisions that shape everything else

### 1. The domain is pure, and it is the only place decisions are made

`@forge/core` has no I/O, no framework and no database import. It holds every
rule that decides something: which programme suits an answer sheet, what load
comes next, whether today is a push day, what to eat, which coach to rank
first, whether that set was a personal record.

The API and both web surfaces are renderers over those functions. That is what
makes a coach's view of a client and the client's own view of themselves
agree — they are the same function, not two implementations of one policy.

It also means the interesting rules are unit-testable without a server. The 86
domain tests run in 40ms and cover the parts a bug would actually hurt: that a
beginner asking for six days is capped at four, that no session ever asks for a
bar the member does not own, that nutrition never drops below a floor, that no
progression step moves a load more than 10%, and that FORGE AI routes every
medical phrasing to a professional.

### 2. The web app is a pure client of the API

There is no second data path. `apps/web` never imports `@forge/db`; every page
fetches through `/api/*`, which Next rewrites to the API. If an endpoint does
not exist, the page cannot render it — which keeps the API honest about what it
actually serves, and means the mobile client that does not exist yet has
nothing left to discover.

Same-origin also keeps the session cookie first-party in every environment: no
CORS preflight on navigation, no `SameSite` surprises, no per-environment
cookie domain.

### 3. Editorial content is code; member activity is data

The twelve programmes, the movement library, the challenge definitions, the
recovery catalogue and the pricing tiers live in `@forge/core` as typed
constants. They ship with a release, they are reviewed in a diff, and the
marketing site and the scheduler read the *same* record — so a card on the
homepage cannot promise something the plan never delivers.

What lives in Postgres is what a member did: their plan, their sets, their
meals, their check-ins, their messages.

### 4. Postgres everywhere, including on a laptop with nothing installed

The same schema, the same migrations and the same SQL run in every environment.
In production that is a Postgres server; in development and CI it is PGlite,
which is Postgres compiled to WebAssembly running in-process.

That is why `pnpm test` needs no Docker and no service to start, and why a
`text[]` column, a partial index or an `ON DELETE CASCADE` cannot behave one
way in tests and another in production. An SQLite development database would
have been easier and would have let exactly those bugs through.

## Authorisation

Every member-scoped query carries `principal.userId` in its `WHERE` clause.
There is no "load by id, then check ownership" path anywhere in the API,
because that pattern only ever fails open.

The coach workspace goes further: every read is joined through `coach_clients`,
so a coach can only see members who are actually their clients. No endpoint
takes a member id and trusts it. Thirteen of the 53 API tests exist purely to
prove those boundaries hold — including that one member cannot open another's
session, that a coach cannot open a client who is not theirs, and that private
coach notes never appear in the member's own view.

## Sessions

The browser holds 32 random bytes. The database holds its SHA-256. A leaked
backup cannot be replayed as a live session, and an engineer reading the
sessions table cannot impersonate a member. Login runs a password verification
even when no user matches, so a wrong email and a wrong password take the same
time and the endpoint cannot be used to enumerate accounts.

## Money and load

Both are integers. Prices are cents; loads are grams. `102.5 kg` is `102500`,
and `$49.00` is `4900`. Conversion happens at the display edge and nowhere else.
Coach ratings are stored as tenths for the same reason — 4.9 is `49`, so a
rating cannot round up on one screen and down on another.

## A bug this architecture caught

Phase intensity bias — a Foundation week prescribing 85% of a member's true
working load — was being folded back into the stored working load after every
session. Compounded over a block, a member who hit every prescribed rep for
twelve weeks ended *lighter* than they started: a demo deadlift had decayed
from 42.5kg to 17.5kg.

Because the rule lived in one pure function, the fix was one concept
(`workingLoadFrom`, which divides the bias back out), applied at the two call
sites that persist a load, and locked in by two tests — one unit test on the
arithmetic and one database test asserting that no seeded working load sits
below 90% of that member's best lift. Had progression logic been spread across
the API route and the seed independently, it would have been two different bugs
with two different fixes and no shared guard.
