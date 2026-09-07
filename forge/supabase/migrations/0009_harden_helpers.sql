-- FORGE Web Beta — 0009 take the RLS helpers off the public API surface.
--
-- The database linter flagged that `can_view`, `is_blocked` and friends were
-- reachable as `/rest/v1/rpc/...`. They are policy internals, not API.
-- PostgREST only exposes the schemas it is configured with (public,
-- graphql_public), so moving them into `private` removes them from the API
-- while leaving them callable inside policies — policy expressions run as the
-- querying role, so EXECUTE has to stay granted.

create schema if not exists private;
grant usage on schema private to authenticated, anon, service_role;

create or replace function private.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.blocks
  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)); $$;

create or replace function private.follows_accepted(follower uuid, followee uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.follows
  where follower_id = follower and followee_id = followee and status = 'accepted'); $$;

create or replace function private.can_view(viewer uuid, owner uuid, level public.visibility_level)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when owner is null then false
    when viewer = owner then true
    when viewer is null then level = 'public' and coalesce(
      (select p.profile_visibility = 'public' from public.privacy_settings p where p.user_id = owner), false)
    when private.is_blocked(viewer, owner) then false
    when level = 'private' then false
    when level = 'followers' then private.follows_accepted(viewer, owner)
    when level = 'public' then coalesce(
      (select p.profile_visibility <> 'private' from public.privacy_settings p where p.user_id = owner), false)
    else false
  end;
$$;

create or replace function private.can_view_activity(viewer uuid, act uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.activities a
  where a.id = act and private.can_view(viewer, a.user_id, a.visibility)); $$;

create or replace function private.owns_activity(viewer uuid, act uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.activities a where a.id = act and a.user_id = viewer); $$;

create or replace function private.is_club_member(viewer uuid, club uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.club_members m where m.club_id = club and m.user_id = viewer); $$;

create or replace function private.is_club_admin(viewer uuid, club uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.club_members m
  where m.club_id = club and m.user_id = viewer and m.role in ('admin', 'owner')); $$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  insert into public.privacy_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Repoint every policy at the private helpers -------------------------------

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = (select auth.uid())
    or private.can_view((select auth.uid()), id,
      coalesce((select ps.profile_visibility from public.privacy_settings ps
                where ps.user_id = profiles.id), 'private')));

drop policy follows_insert_self on public.follows;
create policy follows_insert_self on public.follows
  for insert with check (follower_id = (select auth.uid())
    and not private.is_blocked((select auth.uid()), followee_id));

drop policy activities_select on public.activities;
create policy activities_select on public.activities
  for select using (user_id = (select auth.uid())
    or private.can_view((select auth.uid()), user_id, visibility));

drop policy splits_select on public.activity_splits;
create policy splits_select on public.activity_splits
  for select using (private.can_view_activity((select auth.uid()), activity_id));
drop policy splits_write_own on public.activity_splits;
create policy splits_write_own on public.activity_splits
  for all using (private.owns_activity((select auth.uid()), activity_id))
  with check (private.owns_activity((select auth.uid()), activity_id));

drop policy efforts_select on public.activity_best_efforts;
create policy efforts_select on public.activity_best_efforts
  for select using (private.can_view_activity((select auth.uid()), activity_id));
drop policy efforts_write_own on public.activity_best_efforts;
create policy efforts_write_own on public.activity_best_efforts
  for all using (private.owns_activity((select auth.uid()), activity_id))
  with check (private.owns_activity((select auth.uid()), activity_id));

drop policy sets_select on public.strength_sets;
create policy sets_select on public.strength_sets
  for select using (private.can_view_activity((select auth.uid()), activity_id));
drop policy sets_write_own on public.strength_sets;
create policy sets_write_own on public.strength_sets
  for all using (private.owns_activity((select auth.uid()), activity_id))
  with check (private.owns_activity((select auth.uid()), activity_id));

drop policy kudos_select on public.activity_kudos;
create policy kudos_select on public.activity_kudos
  for select using (private.can_view_activity((select auth.uid()), activity_id));
drop policy kudos_insert_self on public.activity_kudos;
create policy kudos_insert_self on public.activity_kudos
  for insert with check (user_id = (select auth.uid())
    and private.can_view_activity((select auth.uid()), activity_id));

drop policy comments_select on public.activity_comments;
create policy comments_select on public.activity_comments
  for select using (private.can_view_activity((select auth.uid()), activity_id));
drop policy comments_insert_self on public.activity_comments;
create policy comments_insert_self on public.activity_comments
  for insert with check (user_id = (select auth.uid())
    and private.can_view_activity((select auth.uid()), activity_id));
drop policy comments_delete on public.activity_comments;
create policy comments_delete on public.activity_comments
  for delete using (user_id = (select auth.uid())
    or private.owns_activity((select auth.uid()), activity_id));

drop policy routes_select on public.routes;
create policy routes_select on public.routes
  for select using (user_id = (select auth.uid())
    or private.can_view((select auth.uid()), user_id, visibility));

drop policy clubs_select on public.clubs;
create policy clubs_select on public.clubs
  for select using (privacy = 'public' or private.is_club_member((select auth.uid()), id));
drop policy clubs_update_admin on public.clubs;
create policy clubs_update_admin on public.clubs
  for update using (private.is_club_admin((select auth.uid()), id))
  with check (private.is_club_admin((select auth.uid()), id));

drop policy club_members_select on public.club_members;
create policy club_members_select on public.club_members
  for select using (user_id = (select auth.uid())
    or private.is_club_member((select auth.uid()), club_id)
    or exists (select 1 from public.clubs c where c.id = club_id and c.privacy = 'public'));
drop policy club_members_leave_self on public.club_members;
create policy club_members_leave_self on public.club_members
  for delete using (user_id = (select auth.uid())
    or private.is_club_admin((select auth.uid()), club_id));

drop policy events_select on public.events;
create policy events_select on public.events
  for select using (club_id is null
    or exists (select 1 from public.clubs c where c.id = club_id and c.privacy = 'public')
    or private.is_club_member((select auth.uid()), club_id));
drop policy events_insert on public.events;
create policy events_insert on public.events
  for insert with check (created_by = (select auth.uid())
    and (club_id is null or private.is_club_admin((select auth.uid()), club_id)));

-- routes_near needs no elevated rights: RLS on `routes` already filters rows.
drop function if exists public.routes_near(double precision, double precision, integer, public.sport_type[], integer);
create or replace function public.routes_near(
  lat double precision, lng double precision,
  radius_m integer default 15000,
  sports public.sport_type[] default null,
  max_results integer default 50
) returns setof public.routes
language sql stable security invoker set search_path = public, pg_temp
as $$
  select r.* from public.routes r
  where extensions.st_dwithin(r.start_point,
          extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
          least(radius_m, 100000))
    and (sports is null or r.sport = any (sports))
  order by extensions.st_distance(r.start_point,
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography)
  limit least(max_results, 200);
$$;

-- The public copies are now unreferenced.
drop function if exists public.can_view_activity(uuid, uuid);
drop function if exists public.owns_activity(uuid, uuid);
drop function if exists public.can_view(uuid, uuid, public.visibility_level);
drop function if exists public.follows_accepted(uuid, uuid);
drop function if exists public.is_blocked(uuid, uuid);
drop function if exists public.is_club_member(uuid, uuid);
drop function if exists public.is_club_admin(uuid, uuid);
drop function if exists public.handle_new_user();

-- And the linter's other finding: a mutable search_path on the touch trigger.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin new.updated_at = now(); return new; end; $$;
