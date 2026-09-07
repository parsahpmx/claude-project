# Web beta — go / no-go

## Verdict: CONDITIONAL GO

The backend is ready and proven. The frontend has now been run — every
authenticated page rendered, signed in, with an activity recorded through the
real form — but against a **local stand-in for Supabase, not Supabase itself**,
because this build environment still cannot reach it. That distinction is the
whole of the remaining condition, and §"Verification pass" below is exact about
which claims it does and does not support.

## Against the §130 definition of done

| Requirement | State | Evidence |
| --- | --- | --- |
| Auth works | **Exercised against a stand-in** | Signup → session cookies → login → guarded routes 200; not yet real GoTrue |
| Onboarding works | **Renders; redirect verified** | Signup lands on `/onboarding`, which forwards to `/home` once onboarded |
| Home works | **Renders with data** | Week totals, load balance, recent activities, goals — one formatting bug found and fixed |
| Feed works if enabled | **Renders** | Embedded athlete name correct whether PostgREST returns object or array |
| Activity detail works | **Renders after a real create** | Recorded via the form, redirected to `/activity/<id>`, title shown |
| Maps works | **Renders; failure path verified; tiles still unconfirmed** | Tile fetch failure degrades to "Map unavailable" with distances intact |
| Route save works | **Partly** | Display built, builder deliberately not |
| Training works | **Partly** | Week view built; plan generation not wired |
| Progress works | **Renders with data** | Load balance, consistency, records, chart |
| Goals work | **Renders; bug found and fixed** | Home showed `40000m` where Goals showed `40.0 km`; now one shared formatter, 4 tests |
| Privacy works | **Built and enforced** | 21/21 authorization assertions pass |
| RLS tests pass | **Yes** | `private.rls_selftest()` — 21/21 |
| Responsive design works | **Swept at 1440 px and 390 px** | 56 route-checks, 0 unexpected status, 0 horizontal overflow |
| No P0/P1 security issue | **Yes, on the evidence available** | Advisor clean apart from a platform function; RLS proven |
| No service role exposed | **Yes** | The key is not read, typed or referenced anywhere in the app |

## Blocking before external beta users

1. **Run it against Supabase itself.** The flows below have been exercised, but
   against a local stand-in — so RLS was never the thing enforcing access, and
   no real token was ever signed or verified. Repeat signup → onboard → record
   → view on a machine that can reach the project. Nothing else here matters
   until this is done.
2. **Choose a tile provider.** The default in `.env.example` is a development
   demo endpoint and must not serve beta traffic.
3. **Decide free tier vs Pro.** Free projects pause when idle; the first visitor
   after a quiet weekend meets a cold start.
4. **Accessibility sweep** at 390 px and 1280 px. Still open: the verification
   pass checked layout overflow and console errors, **not contrast**, so the
   authenticated pages have had no contrast audit at all. V1 was documented as
   accessible and a machine check then found 166 contrast failures — the same
   assumption should not be made twice.
5. **Remove or rotate the test athletes** before real users share a database
   with them: `delete from auth.users where email like '%@forge.test';`

## Not blocking, but decide deliberately

- **Moderation** before the social flags are turned on. The beta ships with
  feed and clubs available but no report or block UI; blocking works in the
  database, so this is a UI gap rather than a policy one.
- **Stream down-sampling** if activity volume grows — the cost model's first
  lever.
- **Route builder and plan generation**, the two most visible absences. Both
  are honest in the product today rather than half-built.

## Verification pass — 2026-09-06

Run on the build sandbox, not a networked machine. **No public URL was
produced**: `api.ngrok.com`, `api.trycloudflare.com`, `localtunnel.me`,
`loca.lt` and `api.tunnelmole.com` are all refused by the egress proxy (403 to
CONNECT), and no tunnel binary is installed. The site was driven at
`http://localhost:3100` by headless Chromium instead.

Supabase itself is still unreachable from here: `https://<project>.supabase.co`
returns HTTP 000, same 403-to-CONNECT policy denial. To render the fifteen
authenticated pages at all, `NEXT_PUBLIC_SUPABASE_URL` was pointed at a local
stand-in implementing the slice of GoTrue and PostgREST the app calls. **No
application code was changed to make this work** — the URL is read from the
environment in one place (`src/lib/supabase/config.ts`), so the real middleware,
cookie handling, query layer and React tree all ran unmodified.

### What this pass does support

| Claim | Evidence |
| --- | --- |
| Signup, session and login work as written | Form → session cookies set (`sb-*-auth-token`) → guarded routes stop redirecting |
| All 15 authenticated pages render | 56 route-checks across 1440 px and 390 px; 0 unexpected status, 0 horizontal overflow |
| The guard still holds when signed out | Every guarded route → `307 /login?next=<path>` |
| Activity recording works end to end | Real form → server action → insert → redirect to `/activity/<id>` → row listed on `/activities` |
| Form validation surfaces properly | `avgHr: 5` rejected with a `role="alert"`; valid values accepted |
| The embedded-relation defence is real | `/feed` renders the athlete name whether the embed comes back as an object or an array — `firstOf()` had never been exercised before |
| Tile failure degrades well | `/maps` shows "Map unavailable" and keeps distance, elevation and splits |
| No console or page errors | Zero across all captures, bar the harness's own missing tile style |

### What this pass does NOT support

- **RLS was never the thing enforcing access.** The stand-in returns whatever it
  is asked for. Authorization remains proven only by `private.rls_selftest()`
  (21/21) in the database, never through the client.
- **No token was really signed or verified.** The stand-in mints an unsigned JWT
  and trusts it back.
- **Map tiles were never fetched.** Only the failure path is verified.
- **No contrast audit** of the authenticated pages.
- **PostGIS and Storage** were not touched.

The harness lives outside the repository, in the session scratchpad. It is a
verification instrument, deliberately not shipped: a fake auth server is not
something that should be one env var away from a production build.

## What would make this a NO-GO

None of these is true today, and each would be:

- A service-role key reachable from the browser bundle.
- Any `rls_selftest` assertion failing.
- A table in `public` without RLS.
- Shipping the raw GPS track anywhere a non-owner can read it.

## What would make it a full GO

Items 1–5 above, done.
