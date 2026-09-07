# Platform audit — Phase 0

**Audited commit:** `12ab074` · **Date:** 2026-09-07 · **Baseline:** 210 tests passing, typecheck clean, lint clean, production build clean.

This is a survey of what exists before any platform work begins. Nothing in the
application was changed to produce it. Every claim is marked **VERIFIED** (I ran
it and saw the result) or **NOT VERIFIED** (I could not, and why) — the target
architecture is large enough that guessing here would cost more than it saves.

**Environment note.** The build sandbox cannot reach `*.supabase.co` over HTTP
(the egress proxy answers 403 to CONNECT), and every tunnel provider is
blocked. However the **Supabase MCP connection reaches the project
server-side**, so all database claims below are live reads from the real
project, not inferences from migration files.

---

## 1. Current architecture

The repository holds **two unrelated products**. The root is Meter402 (x402
payments, blockchain, MCP) with its own `apps/*` and `packages/*`. FORGE is a
**separate nested pnpm workspace** under `forge/`, invisible to the root
workspace globs.

Inside `forge/`, there are **two parallel and largely disconnected stacks**:

| | Stack A — "V1" | Stack B — "beta" |
|---|---|---|
| Frontend | `apps/web` (50 pages) | `apps/beta` (26 pages) |
| Backend | `apps/api` (Fastify) | Next.js server layer |
| Database | `@forge/db` (Drizzle → own Postgres) | Supabase Postgres |
| Auth | `apps/api/src/auth/session.ts` | Supabase Auth + `@supabase/ssr` |
| Authorization | app-layer guards | Postgres RLS |
| Shared | `@forge/core` (domain engines) | `@forge/core`, `@forge/contracts` |

They share only the domain engine package. **They do not share a database, a
user table, or a session.** A person who signs up in `apps/beta` does not exist
in `apps/api`'s database and vice versa.

This is the single most important fact for planning. Stack A contains roughly
twice the UI surface (including member and coach screens the target
architecture wants) but sits on the stack that is *not* the strategic one.
Stack B is the smaller, newer, security-hardened one.

**Verified:** `apps/api/src` has zero `supabase` references; `apps/web/src` has
one, in a design-system demo page. Confirmed by grep at the audited commit.

### Versions

Next 15.5.9 · React 19.2 · TypeScript 5.9.3 (`strict: true`,
`noUncheckedIndexedAccess: true`) · Tailwind **3.4.18** · `@supabase/ssr` 0.7 ·
`@supabase/supabase-js` 2.58 · Zod 3.25 · Vitest 3.2 · MapLibre GL 5.9 ·
Drizzle 0.45 · Fastify 5.12. Versions are centralised in a pnpm `catalog:`,
which is a genuine strength — there is one place to change a version.

---

## 2. Current database schema

**Live read from project `xhbhlpegfnswhbodhbqp` (Postgres 17.6, ap-south-1,
ACTIVE_HEALTHY).**

- **27 tables in `public`**
- **0 tables without RLS** — VERIFIED by query, not by reading migrations
- **53 policies**
- **12 migrations**, `0001`–`0012`, mirrored in `supabase/migrations/`
- Extensions: `postgis` ✅, `citext`, `pg_trgm`, `pgcrypto`, `uuid-ossp`,
  `pg_stat_statements`, `supabase_vault`, `plpgsql`
- **`pgvector` is NOT installed** — required before any RAG work

Domains present: identity (`profiles`, `privacy_settings`, `private_zones`),
social (`follows`, `blocks`, `activity_kudos`, `activity_comments`), activities
(`activities`, `activity_tracks`, `activity_streams`, `activity_splits`,
`activity_best_efforts`, `strength_sets`, `exercise_prs`), routes (`routes`,
`saved_routes`), training (`programs`, `plans`, `plan_days`, `plan_exercises`,
`goals`), community (`clubs`, `club_members`, `events`, `event_rsvps`,
`challenges`, `challenge_participants`).

The privacy split is the schema's best idea and must survive any migration:
`activities.map_polyline` holds the **sanitized** line others may see, while
`activity_tracks.track` and `activity_streams.*` hold real geometry and are
**owner-only, with no visibility branch in the policy at all**.

### Domains entirely absent

Nothing exists for: organizations, gyms, locations, memberships, entitlements,
access control/QR, classes and bookings, coach profiles and coach-client
relationships, exercises library, workout templates/sessions/sets, messaging,
habits, nutrition, notifications, payments, AI, audit logs, moderation.

That is roughly **80% of the target domain model**, and all of it is greenfield
rather than migration.

---

## 3. Current authentication flow

Server-side, cookie-based, via `@supabase/ssr`.

- `src/middleware.ts` → `src/lib/supabase/middleware.ts::updateSession`
- Uses **`getUser()`**, which revalidates the token with Supabase rather than
  trusting cookie contents. This is the correct choice and should not regress.
- **Fails closed**: if Supabase is unreachable the visitor is treated as signed
  out, so an outage cannot admit anyone to a protected page.
- `src/app/auth/callback/route.ts` calls `exchangeCodeForSession`.

**Implemented:** email/password sign-in, sign-up, sign-out, session refresh.

**Not implemented — VERIFIED absent by grep:**
- **No password reset.** No `resetPasswordForEmail` anywhere. A user who
  forgets their password today has no recovery path at all.
- **No OAuth.** No `signInWithOAuth`; Google, Apple and GitHub are absent.
- No MFA, no account deletion, no provider linking.

**Live auth state:** 3 users. Two are `@forge.test` fixtures that have never
signed in. One is a real owner account that **has** signed in — so real
Supabase auth demonstrably works end to end at least once, though that was a
human action, not something this audit exercised.

---

## 4. Current routes

**26 routes in `apps/beta`**, all verified rendering in the prior pass.

- **Public (9):** `/`, `/features`, `/how-it-works`, `/pricing`, `/about`,
  `/privacy`, `/terms`, `/login`, `/signup`
- **Guarded (15):** `/home`, `/feed`, `/maps`, `/training`, `/community`,
  `/you`, `/activities`, `/activities/new`, `/goals`, `/programs`, `/progress`,
  `/routes`, `/routes/new`, `/settings/privacy`, `/onboarding`
- **Dynamic:** `/activity/[id]`, `/route/[id]`
- **Route handler:** `/auth/callback`

Server actions: `(auth)/actions.ts`, `onboarding/actions.ts`,
`activities/new/actions.ts`, `settings/privacy/actions.ts`.

Absent entirely: `/coach/*`, `/gym/*`, `/admin/*`, `/workouts`, `/classes`,
`/messages`, `/profile`, `/settings` (beyond privacy).

---

## 5. Current features

Working and verified: signup/login/logout, onboarding, home dashboard (week
totals, load balance, consistency, recent activities, goals), activity list and
detail, manual activity recording with validation, goals with progress, routes
list, map view with graceful tile failure, feed, community (clubs and
challenges, read-only), privacy settings, programs and training week view.

Deliberately absent and honest about it: route builder, plan generation.

Domain engines in `@forge/core` (86 tests) cover session load (Foster sRPE),
load balance 7d/28d, consistency, effort score, Epley 1RM.

---

## 6. Current technical debt

Ranked by cost to the target architecture.

**D1 — Two stacks, one product.** The largest item. Every future feature has to
choose a stack, and choosing wrong doubles the work. `apps/web`'s 50 pages
include coach screens that Phase 8 wants, but on the non-strategic stack.

**D2 — Guard is fail-open by omission.** `PROTECTED` in
`lib/supabase/middleware.ts` is an explicit **allowlist of protected prefixes**.
Any route not in that array is public. Adding `/coach`, `/gym` or `/admin`
without editing that array ships them unauthenticated. See §7.

**D3 — No authorization model.** Middleware answers "is there a session",
never "may this person do this". There are no roles, no organizations, no
permission table. Everything in Parts 7 and 34 of the target depends on this.

**D4 — No E2E tests.** VERIFIED: Playwright appears in no `package.json` in the
repository. The prior task list recorded "E2E tests" as complete; what exists
are Vitest unit and integration tests. There is no browser-level regression net.

**D5 — Component system too small for the target.** Eight hand-rolled
primitives (`Button`, `ButtonLink`, `Card`, `Metric`, `Badge`, `EmptyState`,
`ErrorState`, `Skeleton`). No dialog, sheet, dropdown, tabs, toast, popover or
combobox — all of which classes, coach panel and admin need. No shadcn/ui, no
Radix, no Lucide.

**D6 — Feature flags are an env string.** `FORGE_DISABLED_FEATURES` parsed in
two page files. No per-user, per-org or percentage rollout — insufficient for
the staged rollout Part 94 describes.

**D7 — Fixture accounts in the production database.** Two `@forge.test` users.

**D8 — Duplicated `apps/web` design system.** A second token set and component
library, diverging from `apps/beta`'s.

---

## 7. Security risks

**S1 — Guard fail-open by omission (P1) — FIXED, see Phase 1 log.** As D2. The
failure mode is silent: a new protected route simply serves to anonymous users,
with no error to notice.

Demonstrated rather than argued. Adding a real page at `src/app/(app)/coach/`
containing a marker string and requesting it signed out returned that marker to
an anonymous client under the old policy. Comparing the two policies as pure
decisions over eleven routes the target architecture will add
(`/coach`, `/gym`, `/admin`, `/workouts`, `/classes`, `/messages`, `/profile`,
`/billing`, …): **11/11 would have been served anonymously; 0/11 are now.**

**S2 — No password reset (P1).** Users have no recovery path; support would
have to intervene manually, which is itself an account-takeover risk.

**S3 — Leaked-password protection disabled (P2).** Supabase advisor, real and
actionable. Enable HaveIBeenPwned checking in Auth settings. **Configuration,
not code** — see §12 for the exact step.

**S4 — `public.rls_auto_enable()` advisor warning — FALSE POSITIVE, no action.**
The advisor reports a `SECURITY DEFINER` function executable by `anon` and
`authenticated`. I tested it: it returns `event_trigger`, is owned by
`postgres`, is attached to one event trigger, and Postgres refuses to invoke it
— `NOT CALLABLE: trigger functions can only be called as triggers`. It is a
Supabase **platform** object, not application code. Recording it so nobody
spends time "fixing" a platform object or, worse, treats the advisor as clean
without understanding why.

**S5 — No rate limiting** on login, signup or server actions in `apps/beta`.
(`apps/api` has `@fastify/rate-limit`, but that is the other stack.)

**S6 — Security headers are partial (P2).** `next.config.ts` already sets
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a
`Permissions-Policy` — VERIFIED present on a live response. Missing are
**Content-Security-Policy** and **Strict-Transport-Security**. CSP is the one
that needs care: an over-restrictive policy breaks OAuth redirects and map tile
loading, so it should land with those integrations rather than before them.

**S7 — No audit logging.** Nothing records who changed what.

**S8 — Map style URL is a development demo endpoint**, rate-limited and not for
production traffic.

### Confirmed good — do not regress

- **No service-role key anywhere in application code.** VERIFIED by grep across
  the repository: the only matches are legitimate SQL `grant` statements in
  migrations. `config.ts` reads only `NEXT_PUBLIC_*`.
- **RLS on 100% of public tables**, 53 policies.
- **`private.rls_selftest()` — 21/21 passing, run live during this audit.**
  Covers cross-user read, cross-user write, forged inserts, and anonymous
  access.
- Owner-only policies on raw GPS with no visibility branch.
- `getUser()` over `getSession()`; middleware fails closed.

### RLS coverage gap

The selftest proves **member-vs-member** isolation. It cannot prove
**cross-organization** isolation, because organizations do not exist yet. It
also runs in SQL by impersonating roles, not through authenticated HTTP —
so PostgREST-level enforcement is inferred, not exercised. Both gaps close in
Phase 3.

---

## 8. UX risks

- **No `/settings` beyond privacy** — no account, units, notifications or
  profile editing.
- **No global loading boundaries.** `Skeleton` exists but there are no
  `loading.tsx` route boundaries.
- **No toast/confirmation layer.** Recording an activity redirects with no
  success confirmation; destructive actions have no confirm step.
- **Home is close to card-soup** already; Part 102 explicitly warns against it.
- **Empty states are uneven** — good on goals, thin elsewhere.

---

## 9. Accessibility risks

**The authenticated pages have never had a contrast audit.** The prior pass
checked overflow and console errors only. This matters specifically because V1
was documented as accessible and a machine check then found **166 contrast
failures** — the same assumption must not be made twice.

- No `axe` or any a11y tooling in any `package.json` — VERIFIED absent.
- No automated a11y gate in CI.
- Keyboard navigation, focus visibility, screen-reader correctness and ARIA
  on authenticated pages: **NOT VERIFIED**.
- Known good: charts ship a `<details>` table view; progress bars carry
  `role="progressbar"` with `aria-valuenow`; forms use a `Field` component with
  `aria-invalid`/`aria-describedby`; errors use `role="alert"`.

---

## 10. Performance risks

- **No performance budget or measurement.** LCP/CLS/INP: NOT VERIFIED.
- MapLibre is dynamically imported (good), but no other route-level code
  splitting is deliberate.
- No `EXPLAIN ANALYZE` has been run against production-like data. Row counts
  are tiny (34 activities), so today's queries prove nothing about scale.
- Feed pagination is correctly cursor-based (`started_at <`), not offset — a
  good decision already made.
- No caching layer; every authenticated page is `force-dynamic`.
- No image optimisation strategy; no `next/image` usage to speak of.

---

## 11. Dependency risks

- **Tailwind 3.4 vs the target's Tailwind 4 + current shadcn.** shadcn's newer
  registry assumes v4 tokens. This is the one upgrade with real blast radius —
  it would touch every component and the whole token layer. Part 5 says to
  defer if it would destabilise; **recommendation: defer to Phase 4** and adopt
  shadcn components onto Tailwind 3.4 where compatible rather than upgrading
  first.
- **React 19 + Next 15** are current; no pressure.
- **Zod 3.25** — Zod 4 exists; migration is mechanical but touches every schema.
  Not urgent.
- **Drizzle + Fastify** are load-bearing only for Stack A. If Stack A is
  retired, both leave the dependency tree.
- `pnpm audit --audit-level high` passes in CI today.

---

## 12. Proposed migration path

The governing decision is **D1**. Recommendation: **converge on Stack B
(Supabase)** and retire Stack A progressively, because Stack B holds the
security model (RLS, 21/21 proven) and the strategic database, and re-creating
that on Stack A would be strictly more work than re-creating Stack A's screens
on Stack B.

Not a rewrite — Stack A keeps running and keeps its tests green until each
capability has a verified replacement.

**Phase 1 — harden Stack B (no new domains).** Invert the route guard to
deny-by-default (S1). Add password reset (S2). Add security headers and rate
limiting (S5, S6). Add Playwright plus an axe sweep and close the authenticated
contrast gap (D4, §9). Add a script to purge `@forge.test` accounts (D7).

**Phase 2 — production auth.** OAuth for Google, Apple and GitHub against a
staging project; session-robustness matrix from Part 10.

**Phase 3 — authorization and tenancy.** `organizations`,
`organization_members`, `organization_roles`, `role_permissions`; a permission
check that middleware and server actions share; extend `rls_selftest` to
cross-tenant; add API-level RLS tests. **This must land before any gym, coach
or admin surface**, or those surfaces will encode authorization ad hoc and it
will have to be unpicked.

**Phase 4 — design system.** Consolidate on one token set; adopt the missing
primitives (dialog, sheet, tabs, toast). Decide Tailwind 4 explicitly with the
blast radius measured, not assumed. Port `apps/web`'s useful screens to Stack B
here, and delete them from Stack A as they land.

**Phases 5–14** then proceed as the brief orders them, each gated on the
Part 97 definition of done.

**Retire Stack A** only when `apps/web` has no route without a Stack B
equivalent. Until then, do not add features to it.

---

## Ranked findings

| ID | Finding | Severity | Fixable in code |
|---|---|---|---|
| S1 | Route guard fail-open by omission | **P1** | ✅ **Fixed** |
| S2 | No password reset | **P1** | Yes (needs email provider to verify) |
| D1 | Two disconnected stacks | **P1** | Path, not a patch |
| D3 | No authorization model | **P1** | Yes, Phase 3 |
| D4 | No E2E tests | **P1** | Yes |
| §9 | Authenticated pages never contrast-audited | **P1** | Yes |
| D7 | `@forge.test` accounts in production DB | **P2** | Yes |
| S3 | Leaked-password protection disabled | **P2** | Config only |
| S5 | No rate limiting on auth | **P2** | Yes |
| S6 | Security headers partial — CSP and HSTS missing | **P2** | Yes |
| S8 | Dev-grade map tiles | **P2** | Needs a provider key |
| D5 | Component system too small | **P2** | Yes, Phase 4 |
| D6 | Feature flags are an env string | **P3** | Yes |
| S7 | No audit logging | **P3** | Phase 3 |
| S4 | `rls_auto_enable` advisor | **None** | False positive — no action |

## Configuration steps requiring credentials I do not have

1. **Enable leaked-password protection** — Supabase Dashboard → Authentication →
   Policies → enable "Leaked password protection".
2. **OAuth providers** — Google Cloud OAuth client, Apple Services ID + key,
   GitHub OAuth app; each needs its callback registered against a staging
   project.
3. **Map tile provider** — a Google Maps Platform key per surface (web, iOS,
   Android, server), each restricted.
4. **Email provider** — required before password reset can be verified rather
   than merely implemented.
