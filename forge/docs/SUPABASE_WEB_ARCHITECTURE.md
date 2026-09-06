# Supabase architecture

Project: `xhbhlpegfnswhbodhbqp` · region `ap-south-1` · Postgres 17.6

## Schema

27 tables, **RLS enabled on every one**. Migrations are in
`supabase/migrations` and match what is applied.

| Area | Tables |
| --- | --- |
| Identity | `profiles`, `privacy_settings`, `private_zones` |
| Social graph | `follows`, `blocks` |
| Activities | `activities`, `activity_tracks`, `activity_streams`, `activity_splits`, `activity_best_efforts`, `strength_sets`, `exercise_prs`, `activity_kudos`, `activity_comments` |
| Routes | `routes`, `saved_routes` |
| Training | `programs`, `plans`, `plan_days`, `plan_exercises`, `goals` |
| Community | `clubs`, `club_members`, `events`, `event_rsvps`, `challenges`, `challenge_participants` |

## The one structural decision that matters

Raw GPS is **not** in `activities`.

```
activities.map_polyline   → sanitized, trimmed, what other people may see
activity_tracks.track     → the real geometry, owner-only, no visibility path
activity_streams.*        → per-sample heart rate, altitude, cadence, owner-only
```

`activity_tracks` and `activity_streams` have exactly one policy each:
`user_id = auth.uid()`. There is no visibility branch to get wrong. A bug in
the sharing rules can leak a trimmed shape; it cannot leak someone's front door.

It also keeps the heavy data out of the way: no feed or home query can
accidentally select thousands of GPS points, because those points are not in a
table those queries touch (§26, §77).

## RLS helpers

`private.can_view(viewer, owner, level)` is the single place that decides
visibility. Everything else calls it.

Two properties matter:

- **`SECURITY DEFINER` and `STABLE`.** A policy on `activities` that reads
  `follows` would re-enter RLS on `follows`, whose policy reads `blocks`.
  Definer functions break that recursion; `STABLE` lets the planner cache the
  result within a statement.
- **They live in `private`, not `public`.** PostgREST serves only `public` and
  `graphql_public`, so a helper in `private` is callable inside a policy but is
  not an API endpoint. The database linter caught this: the helpers were
  originally in `public` and therefore reachable as `/rest/v1/rpc/can_view`.
  Moving them took the advisor from 21 warnings to 2.

The two remaining advisor warnings are for `public.rls_auto_enable`, a Supabase
platform event trigger that auto-enables RLS on new public tables. It is not
FORGE code, it returns `event_trigger`, and it is a useful backstop.

## Auth

- Email and password for the beta.
- A trigger on `auth.users` creates the `profiles` and `privacy_settings` rows
  at signup with conservative defaults, so no code path has to handle their
  absence, and an abandoned onboarding leaves a safe account rather than an
  unconfigured one.
- Sign-in failures return the same message for a wrong password and an unknown
  address, so the form cannot be used to enumerate accounts.

## Storage

| Bucket | Public | For |
| --- | --- | --- |
| `forge-private` | No | Progress photos, private activity media, form checks |
| `forge-public` | Yes | Programme covers, club images, editorial assets |

Private objects are namespaced by owner uuid as the first path segment, and the
policy compares that segment to `auth.uid()`. A user cannot read, write or
delete outside their own prefix; anonymous access fails because `auth.uid()` is
null. The public bucket has a read policy and no write policy — writes go
through service-role, which is not in this application.

## PostGIS

Enabled, with GiST indexes on every geography column. Used for:

- `routes.path`, `routes.start_point` — and `public.routes_near(lat, lng, …)`,
  a `SECURITY INVOKER` function so RLS on `routes` does the filtering.
- `activity_tracks.track` — owner-only.
- `clubs.location`, `events.location` — for future proximity search.

## Realtime and Edge Functions

Neither is used in the beta. Realtime is for messaging, which is post-beta.
Edge Functions have no job yet that a request cannot do — adding one per CRUD
endpoint is the anti-pattern §74 warns against.

## Migrations

```
supabase/migrations/0001 … 0012
```

Applied through the Supabase MCP tooling. Each file matches the SQL that ran.
`0009` supersedes helper definitions from `0001`, `0003` and `0007`; a replay
from empty runs them in order and lands in the same place.
