# Web beta — go / no-go

## Verdict: CONDITIONAL GO

The backend is ready and proven. The frontend is built and compiles but has
never been run against the database, because this build environment cannot
reach Supabase. That is one afternoon of work on a normal machine, and it is
the whole condition.

## Against the §130 definition of done

| Requirement | State | Evidence |
| --- | --- | --- |
| Auth works | **Built, unverified end to end** | Compiles; server actions written; never exercised against a live session |
| Onboarding works | **Built, unverified** | Five steps; writes profile and privacy |
| Home works | **Built, unverified** | Real queries against the real schema |
| Feed works if enabled | **Built, flagged, unverified** | Optional; off-switch honoured |
| Activity detail works | **Built, unverified** | Splits, sets, map, effort |
| Maps works | **Built, unverified; tiles unconfirmed** | Provider not finalised |
| Route save works | **Partly** | Display built, builder deliberately not |
| Training works | **Partly** | Week view built; plan generation not wired |
| Progress works | **Built, unverified** | Load balance, consistency, records, chart |
| Goals work | **Built, unverified** | Measured from activities, not a stored counter |
| Privacy works | **Built and enforced** | 21/21 authorization assertions pass |
| RLS tests pass | **Yes** | `private.rls_selftest()` — 21/21 |
| Responsive design works | **Built, unverified visually** | Breakpoints written; no browser sweep |
| No P0/P1 security issue | **Yes, on the evidence available** | Advisor clean apart from a platform function; RLS proven |
| No service role exposed | **Yes** | The key is not read, typed or referenced anywhere in the app |

## Blocking before external beta users

1. **Run it.** Sign up, onboard, record, view, on a machine that can reach
   Supabase. Nothing else on this list matters until this is done.
2. **Choose a tile provider.** The default in `.env.example` is a development
   demo endpoint and must not serve beta traffic.
3. **Decide free tier vs Pro.** Free projects pause when idle; the first visitor
   after a quiet weekend meets a cold start.
4. **Accessibility sweep** at 390 px and 1280 px. V1 was documented as accessible
   and a machine check then found 166 contrast failures — the same assumption
   should not be made twice.
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

## What would make this a NO-GO

None of these is true today, and each would be:

- A service-role key reachable from the browser bundle.
- Any `rls_selftest` assertion failing.
- A table in `public` without RLS.
- Shipping the raw GPS track anywhere a non-owner can read it.

## What would make it a full GO

Items 1–5 above, done.
