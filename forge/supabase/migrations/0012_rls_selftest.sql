-- FORGE Web Beta — 0012 the authorization test suite, as SQL.
--
-- Impersonating `authenticated` with a forged claim tests the policies
-- themselves rather than whatever PostgREST does in front of them, and it can
-- assert on mutations that are supposed to fail — which a client library would
-- simply throw on. SECURITY INVOKER because `set role` is forbidden inside a
-- SECURITY DEFINER function; EXECUTE is revoked from anon and authenticated,
-- and `private` is not an exposed API schema.
--
-- Run with:  select * from private.rls_selftest();
create or replace function private.rls_selftest()
returns table (test text, expected text, actual text, pass boolean)
language plpgsql security invoker set search_path = public, private, pg_temp
as $$
declare
  a_id constant uuid := '11111111-1111-4111-8111-111111111111';
  b_id constant uuid := '22222222-2222-4222-8222-222222222222';
  n integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'role', 'authenticated')::text, true);

  select count(*) into n from public.activities where user_id = b_id;
  return query select 'A cannot read B''s activities'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.activity_tracks where user_id = b_id;
  return query select 'A cannot read B''s raw GPS tracks'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.activity_streams where user_id = b_id;
  return query select 'A cannot read B''s per-sample streams'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.privacy_settings where user_id = b_id;
  return query select 'A cannot read B''s privacy settings'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.goals where user_id = b_id;
  return query select 'A cannot read B''s goals'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.exercise_prs where user_id = b_id;
  return query select 'A cannot read B''s personal records'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.profiles where id = b_id;
  return query select 'A cannot read B''s private profile'::text, '0'::text, n::text, n = 0;

  -- A silent no-op is as good as a refusal; a success is a failure.
  update public.profiles set display_name = 'HIJACKED' where id = b_id;
  get diagnostics n = row_count;
  return query select 'A cannot rename B''s profile'::text, '0 rows'::text, n::text || ' rows', n = 0;
  update public.activities set title = 'HIJACKED' where user_id = b_id;
  get diagnostics n = row_count;
  return query select 'A cannot retitle B''s activities'::text, '0 rows'::text, n::text || ' rows', n = 0;
  delete from public.activities where user_id = b_id;
  get diagnostics n = row_count;
  return query select 'A cannot delete B''s activities'::text, '0 rows'::text, n::text || ' rows', n = 0;
  update public.privacy_settings set profile_visibility = 'public' where user_id = b_id;
  get diagnostics n = row_count;
  return query select 'A cannot loosen B''s privacy'::text, '0 rows'::text, n::text || ' rows', n = 0;

  begin
    insert into public.activities (user_id, sport, title, started_at)
    values (b_id, 'run', 'FORGED', now());
    return query select 'A cannot create an activity owned by B'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot create an activity owned by B'::text, 'refused'::text, 'refused'::text, true;
  end;

  begin
    insert into public.follows (follower_id, followee_id, status) values (b_id, a_id, 'accepted');
    return query select 'A cannot forge a follow on B''s behalf'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot forge a follow on B''s behalf'::text, 'refused'::text, 'refused'::text, true;
  end;

  -- Positive controls. A suite that only proves things are hidden would also
  -- pass if everything were hidden.
  select count(*) into n from public.activities where user_id = a_id;
  return query select 'A can read their own activities'::text, '>0'::text, n::text, n > 0;
  update public.activities set title = title where user_id = a_id;
  get diagnostics n = row_count;
  return query select 'A can update their own activities'::text, '>0 rows'::text, n::text || ' rows', n > 0;
  select count(*) into n from public.programs where published;
  return query select 'A can browse the published catalogue'::text, '>0'::text, n::text, n > 0;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);

  select count(*) into n from public.activities;
  return query select 'Anonymous sees no activities'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.profiles;
  return query select 'Anonymous sees no non-public profiles'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.privacy_settings;
  return query select 'Anonymous sees no privacy settings'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.routes;
  return query select 'Anonymous sees no routes'::text, '0'::text, n::text, n = 0;
  select count(*) into n from public.programs where published;
  return query select 'Anonymous can browse the published catalogue'::text, '>0'::text, n::text, n > 0;

  perform set_config('role', 'service_role', true);
end;
$$;

revoke all on function private.rls_selftest() from public;
revoke all on function private.rls_selftest() from anon;
revoke all on function private.rls_selftest() from authenticated;
