-- FORGE Web Beta — 0004 RLS for activities and everything hanging off them.
alter table public.activities            enable row level security;
alter table public.activity_tracks       enable row level security;
alter table public.activity_streams      enable row level security;
alter table public.activity_splits       enable row level security;
alter table public.activity_best_efforts enable row level security;
alter table public.strength_sets         enable row level security;
alter table public.exercise_prs          enable row level security;
alter table public.activity_kudos        enable row level security;
alter table public.activity_comments     enable row level security;

create policy activities_select on public.activities
  for select using (user_id = (select auth.uid())
    or public.can_view((select auth.uid()), user_id, visibility));
create policy activities_insert_own on public.activities
  for insert with check (user_id = (select auth.uid()));
create policy activities_update_own on public.activities
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy activities_delete_own on public.activities
  for delete using (user_id = (select auth.uid()));

-- OWNER ONLY, with no visibility path at all. A public activity still exposes
-- only its sanitized polyline.
create policy tracks_owner_only on public.activity_tracks
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy streams_owner_only on public.activity_streams
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy splits_select on public.activity_splits
  for select using (public.can_view_activity((select auth.uid()), activity_id));
create policy splits_write_own on public.activity_splits
  for all using (public.owns_activity((select auth.uid()), activity_id))
  with check (public.owns_activity((select auth.uid()), activity_id));

create policy efforts_select on public.activity_best_efforts
  for select using (public.can_view_activity((select auth.uid()), activity_id));
create policy efforts_write_own on public.activity_best_efforts
  for all using (public.owns_activity((select auth.uid()), activity_id))
  with check (public.owns_activity((select auth.uid()), activity_id));

create policy sets_select on public.strength_sets
  for select using (public.can_view_activity((select auth.uid()), activity_id));
create policy sets_write_own on public.strength_sets
  for all using (public.owns_activity((select auth.uid()), activity_id))
  with check (public.owns_activity((select auth.uid()), activity_id));

-- Personal records are training data, not social content.
create policy prs_owner_only on public.exercise_prs
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Writing requires being able to see the activity, so a hidden activity cannot
-- be probed by kudos-ing or commenting on it.
create policy kudos_select on public.activity_kudos
  for select using (public.can_view_activity((select auth.uid()), activity_id));
create policy kudos_insert_self on public.activity_kudos
  for insert with check (user_id = (select auth.uid())
    and public.can_view_activity((select auth.uid()), activity_id));
create policy kudos_delete_self on public.activity_kudos
  for delete using (user_id = (select auth.uid()));

create policy comments_select on public.activity_comments
  for select using (public.can_view_activity((select auth.uid()), activity_id));
create policy comments_insert_self on public.activity_comments
  for insert with check (user_id = (select auth.uid())
    and public.can_view_activity((select auth.uid()), activity_id));
create policy comments_delete on public.activity_comments
  for delete using (user_id = (select auth.uid())
    or public.owns_activity((select auth.uid()), activity_id));
