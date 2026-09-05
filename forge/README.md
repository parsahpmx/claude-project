# FORGE

**BUILD YOUR STRONGEST SELF.**

Training, nutrition, recovery and real coaching — personalised around you.

FORGE is a complete, working product: a public marketing site, a subscription
funnel, a member application, a coach workspace, a REST API, a Postgres schema
and the domain engines that decide what a member should train today and why.

---

## What is actually here

| Surface | Routes | State |
| --- | --- | --- |
| Marketing site | 17 | Working, served from the live catalogue |
| Assessment & checkout funnel | 3 | Working end to end, creates a real account and plan |
| Member application | 18 | Working, backed by the member's own data |
| Workout player | 1 | Working — logs sets, detects records, drives progression |
| Coach workspace | 8 | Working, scoped to that coach's own clients |
| Design system | 1 | Every component, token and state, live |

**158 automated tests pass** (86 domain, 19 database, 53 API integration), four
packages typecheck under `strict` with `noUncheckedIndexedAccess`, ESLint is
clean, and the production build succeeds with no warnings.

Every screen is also verified in a real browser rather than only by status code.
The sweep drives all 43 routes signed out, as a member and as a coach, at 390px
and 1280px, against the production build, and checks four things: console and
page errors, failed network requests, horizontal overflow (measured by scrolling
the document, not by reading element boxes — a box inside an `overflow-x: auto`
container is not page overflow), and the full WCAG 2.1 AA rule set via axe-core.
All four come back clean.

That last one is worth stating plainly because it did not start clean. The first
axe run found 166 failing contrast nodes across 42 routes behind a design that
had been eyeballed and documented as accessible. See `docs/ACCESSIBILITY.md` for
the three rules that came out of fixing them.

## Quick start

Requires Node 22+ and pnpm 10+. **No database server and no Docker.**

```bash
cd forge
pnpm install
pnpm dev
```

That starts the API on `:4000` and the web app on `:3000`. On first boot the
API creates an in-process Postgres (PGlite), applies the migrations and loads
the demo dataset.

Open <http://localhost:3000> and sign in:

| Role | Email | Password |
| --- | --- | --- |
| Member | `alex@forge.fit` | `ForgeDemo!2026` |
| Coach | `maya.roberts@forge.fit` | `ForgeDemo!2026` |

## Verify it

```bash
pnpm typecheck   # strict TypeScript, all four packages
pnpm test        # 158 tests
pnpm lint        # ESLint, zero warnings
pnpm build       # production build of every package
```

## Repository layout

```
forge/
  apps/
    api/         Fastify REST API — auth, plans, training, nutrition,
                 coaching, community, commerce, coach workspace, FORGE AI
    web/         Next.js 15 — marketing site, member app, coach workspace,
                 design system, mobile shell
  packages/
    core/        The domain. Pure functions, no I/O, no framework:
                 assessment, programming, progression, readiness, nutrition,
                 progress, coaching, challenges, pricing, FORGE AI
    db/          Drizzle schema (43 tables), migrations, connection factory,
                 password hashing and the seed
  docs/          Architecture, design system, API contract, accessibility
```

## How it fits together

The web app is a **pure client of the API**. There is no second path into the
database from the browser tier: if an endpoint does not exist, the page cannot
render it. Next.js rewrites `/api/*` to the API so the session cookie stays
first-party in every environment.

Everything that *decides* something lives in `@forge/core` as a pure function —
what to train today, how heavy, whether today is a push day, what to eat, who
to match with, whether that was a personal record. The API and both web
surfaces are renderers over those functions, which is what keeps a coach's view
of a client and the client's own view of themselves in agreement.

The programme catalogue, movement library, challenge definitions and pricing
are **code**, because they are editorial content that ships with a release. What
lives in the database is what a member *did* with them.

## Design principles

These are enforced by types, database constraints and tests rather than by
convention.

1. **The five questions.** Every screen answers at least one of: what should I
   do today, why am I doing it, am I making progress, what should I do next,
   who can help me. A screen that answers none of them does not ship.
2. **Never invent data.** Readiness with no inputs is `null`, not 50. FORGE AI
   says "I don't have that" rather than guessing. Missed sessions stay visible
   as missed.
3. **Loads are integer grams.** `102.5 kg` is `102500`. No float money, no float
   loads, and unit conversion happens only at the display edge.
4. **Nutrition has a floor.** Goal adjustment is bounded at ±20%, with a hard
   floor at 1,500 kcal and never below the member's own resting requirement —
   enforced in the domain, where every client hits it.
5. **Challenges measure actions, not outcomes.** The metric union has no way to
   express a weight-loss competition.
6. **Medical questions go to professionals.** FORGE AI routes every injury,
   pain, pregnancy or medication question to a qualified provider, with no
   "but generally speaking". The gate is deliberately over-broad.
7. **Colour is never the only signal.** Every status carries a glyph and a word.

## Known limitations

Stated plainly, because a prototype that hides them is worse than one that does
not have the features at all.

- **No photography or video.** Outbound egress is blocked in the build
  environment, so every image is generated deterministically from its key —
  layered gradients with a grain overlay, the same key always producing the same
  composition. `Media` takes a `src` the moment real assets exist; no layout
  changes.
- **No web fonts,** for the same reason. The display face falls back through
  Archivo Black → Arial Black → Helvetica Neue.
- **Payments are not connected.** Checkout computes and states the real
  recurring-billing disclosure and creates a real subscription record; no card
  is charged and none is stored.
- **Video calling is not connected.** The session layout, agenda and metric
  panel are real; the media transport is not.
- **Notification delivery is not wired up.** The preference model is.
- **The Stitch designs could not be fetched.** `stitch.withgoogle.com` is
  blocked by the environment's egress proxy, so the visual identity here is
  built from the written brand direction in the brief rather than from those
  screens. See `docs/DESIGN_SYSTEM.md`.

## Documentation

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | How the pieces fit, and why each boundary is where it is |
| [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md) | Tokens, components, the generated imagery system |
| [API](docs/API.md) | The HTTP contract |
| [ACCESSIBILITY](docs/ACCESSIBILITY.md) | What is guaranteed, and how it is checked |
| [PRODUCT](docs/PRODUCT.md) | The screen map, the funnel and the twelve-week roadmap |

## Licence

Demonstration product. Not affiliated with any existing fitness company; the
brand, copy, programmes, coaches and members are original and fictional.
