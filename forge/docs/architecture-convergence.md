# Architecture convergence — Stack A → Stack B

**Written at:** `efe8858` · **Date:** 2026-09-07
**Status of the Phase 0 two-stack finding: CONFIRMED**, with one material
addition that changes the plan — see *Data that would require migration*.

---

## The finding, re-confirmed

The Phase 0 audit said FORGE contains two parallel, largely disconnected
stacks. Re-checked against the repository at `efe8858`, that is accurate.

| | **Stack A** | **Stack B** |
|---|---|---|
| Frontend | `apps/web` — **48 routes** | `apps/beta` — **26 routes** |
| Backend | `apps/api` — Fastify, 10 route modules | Next.js server layer |
| Database | `@forge/db` — Drizzle, **53 tables** | Supabase Postgres — **27 tables** |
| Auth | own `forge_session` cookie, 32 random bytes, SHA-256 hashed at rest | Supabase Auth via `@supabase/ssr` |
| Authorization | app-layer guards (`apps/api/src/auth/guards.ts`) | Postgres RLS, 53 policies |
| Deployed | **no** — no deployment config in the repository | the verified product |
| Verified | unit/integration tests only | routes, auth flow, activity flow, RLS 21/21 |

**Verified by inspection:** `apps/beta` imports `@forge/db` nowhere;
`apps/api/src` references Supabase nowhere. The only shared code is
`@forge/core` (domain engines) and `@forge/contracts`.

### The addition that changes everything

**Stack A has no production data and no production deployment.**

- No `vercel.json`, `Dockerfile`, `fly.toml` or deploy workflow anywhere in the
  repository.
- The only `DATABASE_URL` is a commented `localhost:5432` line in
  `.env.example`. No `.env` file points at a remote host.
- In CI, `apps/api` runs against an ephemeral Postgres service container.

Phase 0 framed convergence as a migration. It is not. **There is nothing to
migrate.** Stack A is a local- and CI-only artifact: a large, working,
well-tested *design and domain reference* that has never held a real user's
data. That reduces convergence from a data-migration programme to a
port-and-delete exercise, and removes the entire class of risk around dual
writes, ID mapping and cutover windows.

---

## What exists in Stack A

**`apps/web` — 48 routes.** Substantially larger than Stack B, and it contains
whole product areas Stack B has never had:

- **Coach suite (9 routes):** `/coach`, `/coach/clients`,
  `/coach/clients/[memberId]`, `/coach/programs`, `/coach/calendar`,
  `/coach/check-ins`, `/coach/messages`, `/coach/analytics`, `/coach/payments`
- **Member app (18 routes):** `/app/{ai,calendar,challenges,community,equipment,
  help,messages,notifications,nutrition,onboarding,plan,profile,programs,
  progress,recovery,settings,workouts}`
- **Marketing (14 routes):** blog, coaching, equipment, nutrition, recovery,
  programs, stories, for-coaches, pricing, training
- `/design-system`, `/assessment`, `/workout/[dayId]`, own `/signin`, `/signup`

**`apps/api` — Fastify.** Route modules: `auth`, `member`, `coach`, `coaching`,
`training`, `community`, `commerce`, `catalog`, `ai`, `schemas`.

**`@forge/db` — 53 Drizzle tables** across `identity` (7), `coaching` (11),
`training` (11), `community` (9), `commerce` (8), `nutrition` (7).

## What exists in Stack B

`apps/beta` — 26 routes (9 public, 15 guarded, 2 dynamic), Supabase Auth,
27 tables with RLS on all of them, 53 policies, `private.rls_selftest()` at
21/21, PostGIS. This is the stack that has actually been exercised: routes
swept, auth flow driven, activity recorded end to end, guard now deny-by-default.

---

## Duplicated capabilities

| Capability | Stack A | Stack B | Notes |
|---|---|---|---|
| Marketing site | 14 routes | 9 routes | Stack A's is richer (blog, stories) |
| Sign in / sign up | `/signin`, `/signup` | `/login`, `/signup` | **Two auth implementations** |
| Onboarding | `/app/onboarding` | `/onboarding` | Different flows |
| Activities | `/app/progress` | `/activities`, `/activity/[id]` | Stack B's is verified |
| Programs / training | `/app/programs`, `/app/plan` | `/programs`, `/training` | |
| Community | `/app/community`, `/app/challenges` | `/community`, `/feed` | |
| Profile / settings | `/app/profile`, `/app/settings` | `/you`, `/settings/privacy` | |
| Design system | own tokens + components | own tokens + components | **Two token sets** |
| Domain engines | `@forge/core` | `@forge/core` | **Shared — not duplicated** |

The two auth implementations are the sharpest duplication: `forge_session`
opaque tokens versus Supabase JWT cookies. They cannot interoperate, and a
person signed into one is anonymous to the other.

## Dependencies

Stack A alone pulls in **Fastify** (+ cookie, cors, helmet, rate-limit,
sensible), **pino**, **drizzle-orm**, **drizzle-kit**, **postgres**,
**@electric-sql/pglite**. All leave the tree when Stack A does.

Shared and staying: `@forge/core`, `@forge/contracts`, zod, typescript,
vitest, eslint.

Stack B alone: `@supabase/ssr`, `@supabase/supabase-js`, `maplibre-gl`, `clsx`.

`@forge/core` is consumed by both and must keep working throughout. It is the
one package where a careless change breaks both stacks at once.

## Migration risks

**R1 — Losing design work by deleting too early (likely, low impact if
managed).** Stack A's coach suite and member app represent real UX thinking.
Deleting before porting throws it away. *Mitigation: Stack A is not deleted in
Phase 1, and no route is removed until its Stack B equivalent is verified.*

**R2 — `@forge/core` regressions (medium).** Both stacks import it, so a change
made for Stack B can break Stack A's 53 tests. *Mitigation: CI runs the whole
workspace; `@forge/core`'s 86 tests must stay green.*

**R3 — Rebuilding authorization ad hoc while porting (high impact).** Porting
`/coach/*` before the authorization foundation exists guarantees role checks
scattered through components. *Mitigation: this is precisely why Phase 1 builds
authorization first, and why no coach/gym/admin UI is built yet.*

**R4 — Schema drift between the two models (medium).** Stack A's 53 Drizzle
tables and Stack B's 27 Supabase tables model overlapping domains differently.
Porting a screen without re-modelling its data produces a half-translated
schema. *Mitigation: port domain by domain, schema first, never screen first.*

**R5 — Two-token-set divergence (low, cosmetic).** Already happening.
*Mitigation: Phase 4 consolidates; until then Stack A's tokens are frozen.*

**Explicitly not a risk:** data loss, cutover downtime, dual-write consistency,
ID remapping — all of which require production data Stack A does not have.

## Features worth preserving

Preserve as **design and domain reference**, to be re-implemented on Stack B
when its phase arrives — not lifted as code, because the data layer differs:

1. **Coach suite** (`apps/web/src/app/coach/*`) — the clients list, the client
   detail tabs, check-ins and programme assignment. Phase 8's reference.
2. **Workout player** (`/workout/[dayId]`) — Phase 5's reference.
3. **Nutrition and recovery screens** — Phase 5/later reference.
4. **Marketing depth** (blog, stories, equipment, `[slug]` routes) — the SEO
   surface Part 65 wants.
5. **`apps/api` route modules** — a worked API surface for coaching, commerce
   and community; useful as a specification of endpoints even though the
   transport will be Server Actions rather than Fastify.
6. **`@forge/core`** — already shared. Nothing to do.

## Data that would require migration

**None.**

Stack A has never run outside a developer machine or a CI job. Its Postgres is
created and destroyed per CI run. There are no user accounts, no activities, no
coaching relationships and no payments in it.

The only real user data in the project is in the **Supabase project**: 3 auth
users (one real owner account, two `@forge.test` fixtures), 34 activities, 159
splits, 96 strength sets, 6 programmes, 4 challenges, 3 goals. That data is
already on Stack B and stays where it is.

## Recommended retirement sequence

Incremental, reversible, and never leaving the repository unbuildable.

**Step 0 — Freeze (now, Phase 1).** No new product functionality in `apps/web`
or `apps/api`. Bug fixes and dependency security updates only. Both keep
building and keep their tests green. *Nothing is deleted.*

**Step 1 — Authorization foundation on Stack B (Phase 1, this phase).** Must
precede any port of coach/gym/admin surfaces.

**Step 2 — Port by domain, schema first.** For each domain, in phase order:
design the Supabase schema with RLS → write the RLS tests → build the Stack B
screens → verify → **only then** delete the Stack A routes for that domain.
Each domain is an independent, revertible commit.

**Step 3 — Marketing last.** It is the least risky and the most SEO-sensitive;
move it when the app surface is settled so redirects are written once.

**Step 4 — Retire `apps/api`.** When no Stack B feature needs a Fastify
endpoint. Removes Fastify, pino and the second auth implementation.

**Step 5 — Retire `@forge/db` and `apps/web`.** When no route lacks a Stack B
equivalent. Removes Drizzle and pglite. Delete `apps/web` last, after a final
sweep that every route either has an equivalent or a deliberate redirect.

**Gate for every step:** the full workspace — typecheck, lint, tests, build —
stays green, and no Stack B capability regresses.

## Capabilities that should NOT be migrated

- **`apps/api`'s session authentication.** Supabase Auth replaces it entirely.
  Porting it would mean maintaining two auth systems permanently. Delete, do
  not translate.
- **`apps/api`'s app-layer authorization guards.** Superseded by the permission
  model plus RLS. RLS is a stronger guarantee than a middleware check.
- **Drizzle as an ORM layer.** Stack B queries PostgREST through
  `@supabase/supabase-js` so that RLS applies to every read. Introducing
  Drizzle against Supabase would open a path that bypasses RLS — exactly the
  thing Rule 5 forbids. `drizzle-kit` may remain useful for schema authoring
  only if migrations stay the source of truth; the default should be plain SQL
  migrations, as Stack B already does.
- **Stack A's second design-token set.** Consolidate, do not merge.
- **`/design-system` on Stack A.** Stack B needs its own; the old one is a
  reference, not an artefact to move.
- **Anything in `apps/web` whose Stack B equivalent is already verified**
  (activities, goals, privacy settings, maps) — re-implementing those would be
  regression, not progress.

## Target ownership of each domain

| Domain | Owner | Status |
|---|---|---|
| Identity, sessions, auth | **Stack B** — Supabase Auth | Live; recovery added this phase |
| Authorization, roles, tenancy | **Stack B** — new, this phase | Being built |
| Profiles, privacy, private zones | **Stack B** | Live |
| Activities, tracks, streams, splits | **Stack B** | Live, verified |
| Goals | **Stack B** | Live, verified, regression-tested |
| Routes, maps, PostGIS | **Stack B** | Live; tiles NOT VERIFIED |
| Training, programmes, plans | **Stack B** | Partial |
| Community, clubs, challenges, feed | **Stack B** | Partial |
| Exercises, workout templates/sessions | **Stack B** — greenfield | Phase 5 |
| Coach profiles, clients, programming | **Stack B** — greenfield | Phase 8; Stack A is reference only |
| Organizations, gyms, memberships | **Stack B** — greenfield | Phase 9 |
| Classes and bookings | **Stack B** — greenfield | Phase 9 |
| Access control / QR | **Stack B** — greenfield | Phase 10 |
| Messaging | **Stack B** — greenfield | Phase 8 |
| Nutrition, habits | **Stack B** — greenfield | Phase 5+; Stack A is reference |
| Payments, entitlements | **Stack B** — greenfield | Phase 12 |
| AI | **Stack B** — greenfield | Phase 11; **not started, deliberately** |
| Marketing and SEO | **Stack B** | Port last |
| Domain engines | **`@forge/core`** — shared | Stable; both stacks depend on it |

## Decision

**Converge on Stack B.** It holds the security model, the only real data, and
every verified capability. Stack A is frozen, kept building, mined for design,
and retired domain by domain behind the gates above.

The Phase 0 recommendation stands. The new evidence — no production data, no
deployment — makes it cheaper and safer than Phase 0 assumed, and means the
correct framing is *port and delete*, not *migrate*.
