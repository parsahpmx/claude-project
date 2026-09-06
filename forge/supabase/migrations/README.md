# FORGE Web Beta — database

Applied against the beta Supabase project. Every file here matches what is
applied; the project's own `supabase_migrations.schema_migrations` is the
authority on order.

| File | What it does |
| --- | --- |
| `0001_foundation.sql` | Extensions, profiles, privacy, private zones, follows, blocks |
| `0002_foundation_rls.sql` | RLS for the above |
| `0003_activities.sql` | Activities, owner-only tracks and streams, splits, efforts, strength sets, PRs, kudos, comments |
| `0004_activities_rls.sql` | RLS for activities and children |
| `0005_routes.sql` | Routes, saved routes, `routes_near` spatial search |
| `0006_training_goals.sql` | Programme catalogue, plans, plan days and exercises, goals |
| `0007_community.sql` | Clubs, club members, events, RSVPs, challenges, participants |
| `0008_storage.sql` | `forge-private` and `forge-public` buckets and their policies |
| `0009_harden_helpers.sql` | Moves RLS helpers out of the API-exposed schema |
| `0010_beta_seed.sql` | Programme and challenge catalogue, two test athletes |
| `0011_beta_seed_activities.sql` | Generated activity history for the test athletes |
| `0012_rls_selftest.sql` | The authorization test suite |

## Running the authorization tests

```sql
select case when pass then 'PASS' else 'FAIL' end, test, expected, actual
from private.rls_selftest();
```

21 assertions covering read, update, delete and insert as athlete A against
athlete B, plus anonymous access, plus positive controls so the suite cannot
pass by hiding everything.

## Test athletes

`athlete.a@forge.test` and `athlete.b@forge.test`, both `ForgeBeta!2026`.
A is followers-visible with 24 activities; B is entirely private with 10.
B exists so that "A cannot see B" is a claim with a subject.

Remove them with:

```sql
delete from auth.users where email like '%@forge.test';
```

## Helpers live in `private`

`private.can_view`, `private.is_blocked` and the rest are policy internals.
PostgREST serves only `public` and `graphql_public`, so putting them in
`private` keeps them off the API while leaving them callable inside policies.

`public.rls_auto_enable` is a Supabase platform event trigger, not FORGE code.
It auto-enables RLS on new public tables — a useful backstop alongside the
explicit `enable row level security` in each migration.
