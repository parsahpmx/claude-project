-- FORGE Web Beta — 0002 RLS for identity, privacy and the social graph.
alter table public.profiles          enable row level security;
alter table public.privacy_settings  enable row level security;
alter table public.private_zones     enable row level security;
alter table public.blocks            enable row level security;
alter table public.follows           enable row level security;

-- profiles: readable when can_view() permits at the owner's chosen visibility.
create policy profiles_select on public.profiles
  for select using (
    id = (select auth.uid())
    or public.can_view((select auth.uid()), id,
      coalesce((select ps.profile_visibility from public.privacy_settings ps where ps.user_id = profiles.id), 'private'))
  );
create policy profiles_update_own on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- No insert/delete policy: rows come from the auth trigger and go with the
-- cascade from auth.users. The browser tier cannot forge a profile.

-- privacy_settings: owner-only both ways. Nobody reads another's config.
create policy privacy_select_own on public.privacy_settings
  for select using (user_id = (select auth.uid()));
create policy privacy_update_own on public.privacy_settings
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy zones_all_own on public.private_zones
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- blocks: only the blocker sees the list; the blocked person is never told.
create policy blocks_select_own on public.blocks
  for select using (blocker_id = (select auth.uid()));
create policy blocks_insert_own on public.blocks
  for insert with check (blocker_id = (select auth.uid()));
create policy blocks_delete_own on public.blocks
  for delete using (blocker_id = (select auth.uid()));

-- follows: both parties see their edge; nobody else enumerates the graph.
create policy follows_select_party on public.follows
  for select using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy follows_insert_self on public.follows
  for insert with check (
    follower_id = (select auth.uid()) and not public.is_blocked((select auth.uid()), followee_id));
create policy follows_update_followee on public.follows
  for update using (followee_id = (select auth.uid())) with check (followee_id = (select auth.uid()));
create policy follows_delete_party on public.follows
  for delete using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
