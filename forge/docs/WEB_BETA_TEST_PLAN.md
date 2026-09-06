# Web beta test plan

## What is verified today

| Suite | Count | Runs |
| --- | --- | --- |
| `@forge/contracts` | 29 | `pnpm --filter @forge/contracts test` |
| `@forge/core` | 86 | `pnpm --filter @forge/core test` |
| `@forge/beta` | 19 | `pnpm --filter @forge/beta test` |
| `@forge/db` | 19 | `pnpm --filter @forge/db test` |
| `@forge/api` | 53 | `pnpm --filter @forge/api test` |
| **Total** | **206** | `pnpm -r test` |

Plus `pnpm -r typecheck` (strict, `noUncheckedIndexedAccess`), `pnpm -r lint`,
and `pnpm --filter @forge/beta build`.

## Authorization tests — the important ones

```sql
select case when pass then 'PASS' else 'FAIL' end, test, expected, actual
from private.rls_selftest();
```

21 assertions, **21 passing**. Two real athletes: A is followers-visible with 24
activities; B is entirely private with 10.

**A cannot read B's** — activities, raw GPS tracks, per-sample streams, privacy
settings, goals, personal records, private profile.

**A cannot write B's** — rename profile, retitle activities, delete activities,
loosen privacy, forge an activity owned by B, forge a follow on B's behalf.

**Anonymous cannot read** — activities, non-public profiles, privacy settings,
routes.

**Positive controls** — A can read and update their own activities; A and
anonymous can both browse the published catalogue. Without these, a suite that
passed because everything was hidden would look identical to one that passed
because the rules are right.

Testing this in SQL rather than through the client is deliberate: it exercises
the policies themselves rather than PostgREST's behaviour in front of them, and
it can assert on mutations that are *supposed* to fail — which a client library
would only throw on.

## What is NOT verified, and why

**The application has not been run end to end against Supabase.** This
container's egress proxy refuses `CONNECT` to `*.supabase.co` (HTTP 403), so
the Next server cannot reach the database from here. Consequently:

- No browser E2E run: signup → onboarding → Home → record → activity detail.
- No screenshot or accessibility sweep of the authenticated pages.
- No confirmation that the auth cookie round-trips through middleware.
- No confirmation that map tiles render (that host is blocked too).

What *is* known: the app typechecks under strict TypeScript, lints clean, builds
for production, and every query it issues was written against a schema whose
shape has been verified by running SQL against the real database.

**This is the single largest gap in the beta and the first thing to close.**
On any machine with normal network access:

```bash
cd forge && pnpm install
cp apps/beta/.env.example apps/beta/.env.local
pnpm --filter @forge/beta dev     # http://localhost:3100
# athlete.a@forge.test / ForgeBeta!2026
```

## The E2E suite to write next

Playwright, two browser contexts (A and B), against a running app:

1. Sign up → onboarding → Home renders with the right name.
2. Record an activity → it appears on Home and in the log.
3. Activity detail shows splits and a map, or says why the map is missing.
4. Maps lists the athlete's routes and activities.
5. Privacy: change default visibility → a new activity picks it up.
6. **Two-user**: B's private activity URL returns 404 for A, not 403.
7. Cursor pagination: page two differs from page one and does not repeat rows.
8. Accessibility sweep with axe at 390 px and 1280 px across every route.
9. Horizontal overflow measured by scrolling the document, not by reading
   element boxes — a box inside an `overflow-x: auto` container is not page
   overflow, and that mistake produced a false positive in V1.

## Performance

Not measured. Beta numbers from a container with no users would not predict
production anyway (§120). The queries are written to the §77 rules — explicit
columns, bounded lists, cursor pagination, no GPS in list queries — but that is
a design claim, not a measurement.
