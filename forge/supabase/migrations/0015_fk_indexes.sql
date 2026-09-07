-- FORGE — 0015 index the foreign keys that back RLS policies and joins.
--
-- The database linter reports thirteen foreign keys with no covering index.
-- On today's data — 34 activities — that costs nothing, which is exactly why
-- it is worth fixing now rather than after it starts hurting.
--
-- Two reasons these matter more here than in an ordinary schema:
--
--  1. **RLS turns them into per-query work.** Policies on these tables filter
--     on `user_id`, so without an index every policy evaluation is a sequential
--     scan of the whole table. The cost lands on every read by every user, not
--     just on an occasional report.
--
--  2. **Cascading deletes scan the child table.** Every one of these keys is
--     `on delete cascade`. Deleting an account with no index on the child's FK
--     means a full scan per child table — which is how "delete my account"
--     turns into a timeout once the tables are large.
--
-- `if not exists` throughout so the migration is safe to re-run.

-- --- Owner columns behind RLS policies -------------------------------------

-- activity_streams is owner-only with no visibility branch, so this index is
-- on the hot path of every stream read.
create index if not exists activity_streams_user_idx
  on public.activity_streams (user_id);

create index if not exists activity_comments_user_idx
  on public.activity_comments (user_id);

create index if not exists activity_kudos_user_idx
  on public.activity_kudos (user_id);

create index if not exists challenge_participants_user_idx
  on public.challenge_participants (user_id);

create index if not exists event_rsvps_user_idx
  on public.event_rsvps (user_id);

create index if not exists plan_exercises_user_idx
  on public.plan_exercises (user_id);

-- --- Authorship, read when listing what someone created --------------------

create index if not exists clubs_created_by_idx
  on public.clubs (created_by);

create index if not exists events_created_by_idx
  on public.events (created_by);

-- --- Join keys -------------------------------------------------------------

create index if not exists events_club_idx
  on public.events (club_id);

create index if not exists saved_routes_route_idx
  on public.saved_routes (route_id);

create index if not exists plans_program_slug_idx
  on public.plans (program_slug);

-- Both of these point at an activity and are cascaded when one is deleted.
create index if not exists exercise_prs_activity_idx
  on public.exercise_prs (activity_id);

create index if not exists plan_days_activity_idx
  on public.plan_days (activity_id);
