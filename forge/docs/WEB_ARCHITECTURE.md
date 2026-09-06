# FORGE Web — architecture

## Two applications, one repository

| Path | What it is | Backend |
| --- | --- | --- |
| `apps/beta` | **FORGE Web Beta.** The Supabase-first web product this document describes. | Supabase |
| `apps/web` | FORGE V1. The earlier marketing site and member app. | `apps/api` (Fastify) |
| `apps/api` | The V1 REST API. | PGlite / Postgres via Drizzle |

`apps/web` and `apps/api` were not deleted. They work, they are covered by
tests, and throwing away working software to make a diagram tidier is a bad
trade. The beta is the direction; V1 is the reference until the beta replaces
it in fact rather than in intent.

## Request flow

```
Browser
  │
  ├─ Server Components ──► @supabase/ssr server client ──► Supabase (RLS as the user)
  ├─ Server Actions ─────► @supabase/ssr server client ──► Supabase (RLS as the user)
  └─ Client Components ──► @supabase/ssr browser client ► Supabase (RLS as the user)
                                    ▲
                              middleware.ts
                       refreshes the session cookie,
                       redirects anonymous visitors
```

There is no application server between the browser and the database, and no
service-role key anywhere in the app. Both the server and the browser talk to
Supabase with the **publishable** key and the user's session, so every query —
wherever it runs — is subject to the same row-level security.

That is the central decision, and it has a consequence worth stating: **if a
query needs to bypass RLS, the fix is a policy, not a key.** A service-role
escape hatch would make the whole model advisory.

## Packages

| Package | Contains | Depends on React? |
| --- | --- | --- |
| `@forge/contracts` | Domain types, Zod validation, feature flags, geo maths, privacy rules, FORGE metrics | No |
| `@forge/core` | V1 domain engines: assessment, planning, progression, readiness, nutrition | No |

Neither package imports React or touches I/O, so the same rules can be used by
the web app, by tests, and by a future iOS bridge without being reimplemented.
That is the answer to §4: the logic lives once, in a package, and the surfaces
are renderers over it.

## Rendering

Every authenticated page is `dynamic = 'force-dynamic'`. They read
per-user data through RLS, and a cached render would be a cache of one person's
training served to another. Marketing pages are static.

## Route groups

| Group | Paths | Auth |
| --- | --- | --- |
| `(marketing)` | `/`, `/features`, `/how-it-works`, `/pricing`, `/about`, `/privacy`, `/terms` | Public |
| `(auth)` | `/login`, `/signup` | Public, redirects when signed in |
| `(app)` | `/home`, `/maps`, `/routes`, `/activities`, `/activity/[id]`, `/training`, `/programs`, `/progress`, `/goals`, `/community`, `/you`, `/settings/privacy`, `/feed` | Required |
| — | `/onboarding` | Required, before `(app)` will admit you |

Marketing deliberately does not use the words `training`, `maps` or `community`
as paths: the app owns those, and two route groups cannot serve one path.

## Where the boundaries are enforced

1. **Middleware** redirects anonymous visitors away from `(app)` and signed-in
   ones away from `(auth)`. It uses `getUser()`, which revalidates the token
   with Supabase, rather than `getSession()`, which trusts the cookie.
2. **The `(app)` layout** resolves the session once and sends half-onboarded
   accounts to `/onboarding`.
3. **RLS** decides what any query returns. The first two are conveniences; this
   is the enforcement. A page that forgot to filter by user still cannot read
   another person's rows.

## Data access

All reads live in `src/lib/queries.ts`. Two rules hold throughout:

- Columns are listed explicitly. `select('*')` would start shipping any column
  someone adds later, including geometry.
- Lists are bounded, and the feed and activity log page by **cursor**
  (`started_at < ?`), so page fifty costs what page one costs.

## Things this architecture does not have

- No Redis, no queue, no container orchestration. A beta for 20–500 people does
  not need infrastructure that has to be operated.
- No Edge Functions yet. Nothing in the beta needs to run outside a request.
- No service-role code path, as above.
