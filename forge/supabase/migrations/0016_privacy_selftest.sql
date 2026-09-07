-- FORGE — 0016 the visibility matrix, tested with data that actually exists.
--
-- Why this is separate from 0012's rls_selftest: that suite asserts A sees
-- **0** of B's rows. Every one of those assertions is currently true because
-- the tables it queries are empty — there are no follow relationships, no
-- public activities, and no GPS tracks anywhere in the database. An assertion
-- that a count is zero when the table holds nothing proves nothing at all, and
-- the strongest privacy claim the product makes ("nobody but you can read your
-- raw GPS") rests on exactly that kind of vacuous pass.
--
-- So this creates real rows in every visibility state, real follow and block
-- relationships, and real tracks and streams, and then asserts what each viewer
-- can and cannot see. A leak shows up as a count that is too high rather than
-- as a test that quietly had nothing to look at.
--
-- Run with:  select * from private.privacy_selftest();
create or replace function private.privacy_selftest()
returns table (test text, expected text, actual text, pass boolean)
language plpgsql security invoker set search_path = public, private, extensions, pg_temp
as $$
declare
  a_id  constant uuid := '11111111-1111-4111-8111-111111111111';
  b_id  constant uuid := '22222222-2222-4222-8222-222222222222';
  priv  constant uuid := 'ccc00000-0000-4000-8000-00000000000a';
  folw  constant uuid := 'ccc00000-0000-4000-8000-00000000000b';
  publ  constant uuid := 'ccc00000-0000-4000-8000-00000000000c';
  n integer;
begin
  ----------------------------------------------------------------------------
  -- Fixtures: B owns one activity in each visibility state, each with a raw
  -- track and a stream sample, so "can A read the track" is a real question.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);

  delete from public.activity_streams where activity_id in (priv, folw, publ);
  delete from public.activity_tracks  where activity_id in (priv, folw, publ);
  delete from public.activities       where id in (priv, folw, publ);
  delete from public.follows where follower_id in (a_id, b_id) and followee_id in (a_id, b_id);
  delete from public.blocks  where blocker_id in (a_id, b_id) and blocked_id in (a_id, b_id);

  insert into public.activities (id, user_id, sport, title, started_at, visibility)
  values (priv, b_id, 'run', 'B private',   now() - interval '3 days', 'private'),
         (folw, b_id, 'run', 'B followers', now() - interval '2 days', 'followers'),
         (publ, b_id, 'run', 'B public',    now() - interval '1 days', 'public');

  insert into public.activity_tracks (activity_id, user_id, track)
  values (priv, b_id, extensions.st_geogfromtext('LINESTRING(-2.24 53.48, -2.25 53.49)')),
         (folw, b_id, extensions.st_geogfromtext('LINESTRING(-2.24 53.48, -2.25 53.49)')),
         (publ, b_id, extensions.st_geogfromtext('LINESTRING(-2.24 53.48, -2.25 53.49)'));

  insert into public.activity_streams (activity_id, user_id, time_s, heartrate)
  values (priv, b_id, array[0, 1, 2], array[120, 130, 140]),
         (folw, b_id, array[0, 1, 2], array[120, 130, 140]),
         (publ, b_id, array[0, 1, 2], array[120, 130, 140]);

  -- B's profile is not private, so a public activity is genuinely reachable.
  update public.privacy_settings set profile_visibility = 'followers' where user_id = b_id;

  ----------------------------------------------------------------------------
  -- A, a stranger: no follow, no block.
  ----------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'role', 'authenticated')::text, true);

  select count(*) into n from public.activities where id = priv;
  return query select 'Stranger cannot see a private activity'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activities where id = folw;
  return query select 'Stranger cannot see a followers-only activity'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activities where id = publ;
  return query select 'Stranger CAN see a public activity'::text, '1'::text, n::text, n = 1;

  -- The claim the whole privacy design rests on. Note this asks about the
  -- *public* activity: even a row anyone may read must not expose its trace.
  select count(*) into n from public.activity_tracks where activity_id = publ;
  return query select 'Raw GPS of a PUBLIC activity is still hidden'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activity_streams where activity_id = publ;
  return query select 'Streams of a PUBLIC activity are still hidden'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activity_tracks where user_id = b_id;
  return query select 'No raw GPS of B is readable at all'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activity_streams where user_id = b_id;
  return query select 'No streams of B are readable at all'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- A requests a follow, which is not yet accepted.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  insert into public.follows (follower_id, followee_id, status)
  values (a_id, b_id, 'pending');
  perform set_config('role', 'authenticated', true);

  select count(*) into n from public.activities where id = folw;
  return query select 'A pending follow does not unlock followers-only'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- B accepts.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  update public.follows set status = 'accepted' where follower_id = a_id and followee_id = b_id;
  perform set_config('role', 'authenticated', true);

  select count(*) into n from public.activities where id = folw;
  return query select 'An accepted follower sees followers-only'::text, '1'::text, n::text, n = 1;

  select count(*) into n from public.activities where id = priv;
  return query select 'A follower still cannot see private'::text, '0'::text, n::text, n = 0;

  -- Following someone is not permission to read their raw trace.
  select count(*) into n from public.activity_tracks where user_id = b_id;
  return query select 'A follower still cannot read raw GPS'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activity_streams where user_id = b_id;
  return query select 'A follower still cannot read streams'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- B blocks A. A block must beat an existing accepted follow.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  insert into public.blocks (blocker_id, blocked_id) values (b_id, a_id);
  perform set_config('role', 'authenticated', true);

  select count(*) into n from public.activities where id = folw;
  return query select 'A block overrides an accepted follow'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activities where id = publ;
  return query select 'A block hides even public activities'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- Anonymous. B's profile is 'followers', so nothing is public to the world.
  ----------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  select count(*) into n from public.activities where id = publ;
  return query select 'Anonymous sees nothing while the profile is followers-only'::text,
    '0'::text, n::text, n = 0;

  select count(*) into n from public.activity_tracks;
  return query select 'Anonymous reads no raw GPS at all'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activity_streams;
  return query select 'Anonymous reads no streams at all'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- B opens the profile to the world. Only then is a public activity public.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  update public.privacy_settings set profile_visibility = 'public' where user_id = b_id;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  select count(*) into n from public.activities where id = publ;
  return query select 'Anonymous sees a public activity on a public profile'::text,
    '1'::text, n::text, n = 1;

  select count(*) into n from public.activities where id = folw;
  return query select 'A public profile does not expose followers-only'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.activities where id = priv;
  return query select 'A public profile does not expose private'::text, '0'::text, n::text, n = 0;

  -- The strictest case: world-readable profile, world-readable activity, and
  -- the trace is still nobody's business but the owner's.
  select count(*) into n from public.activity_tracks where activity_id = publ;
  return query select 'Even on a public profile, raw GPS stays hidden'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- Owner: B must be able to read their own everything.
  ----------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', b_id, 'role', 'authenticated')::text, true);

  select count(*) into n from public.activities where id in (priv, folw, publ);
  return query select 'The owner reads all three of their own activities'::text, '3'::text, n::text, n = 3;

  select count(*) into n from public.activity_tracks where activity_id in (priv, folw, publ);
  return query select 'The owner reads their own raw GPS'::text, '3'::text, n::text, n = 3;

  select count(*) into n from public.activity_streams where activity_id in (priv, folw, publ);
  return query select 'The owner reads their own streams'::text, '3'::text, n::text, n = 3;

  ----------------------------------------------------------------------------
  -- Tear down, including the privacy setting this test changed.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  delete from public.activity_streams where activity_id in (priv, folw, publ);
  delete from public.activity_tracks  where activity_id in (priv, folw, publ);
  delete from public.activities       where id in (priv, folw, publ);
  delete from public.follows where follower_id in (a_id, b_id) and followee_id in (a_id, b_id);
  delete from public.blocks  where blocker_id in (a_id, b_id) and blocked_id in (a_id, b_id);
  update public.privacy_settings set profile_visibility = 'followers' where user_id = b_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

revoke execute on function private.privacy_selftest() from public, anon, authenticated;
