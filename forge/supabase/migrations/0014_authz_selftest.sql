-- FORGE — 0014 the authorization test suite, as SQL.
--
-- Companion to `private.rls_selftest()` (0012), which proves member-vs-member
-- isolation. This proves the things the authorization model added: tenant
-- isolation between organizations, consent-gated coach access, and — the one
-- that matters most — that an ordinary authenticated user cannot promote
-- themselves to a platform admin.
--
-- The function creates its own fixtures as `service_role`, runs every
-- assertion as `authenticated` with a forged `sub` claim, and removes the
-- fixtures again, so it is repeatable and leaves nothing behind.
--
-- Run with:  select * from private.authz_selftest();
create or replace function private.authz_selftest()
returns table (test text, expected text, actual text, pass boolean)
language plpgsql security invoker set search_path = public, private, pg_temp
as $$
declare
  a_id  constant uuid := '11111111-1111-4111-8111-111111111111';
  b_id  constant uuid := '22222222-2222-4222-8222-222222222222';
  org_a constant uuid := 'aaaa0000-0000-4000-8000-0000000000aa';
  org_b constant uuid := 'bbbb0000-0000-4000-8000-0000000000bb';
  n integer;
  flag boolean;
begin
  ----------------------------------------------------------------------------
  -- Fixtures. service_role bypasses RLS, which is exactly why the assertions
  -- below run as `authenticated` instead.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);

  delete from public.coach_clients
    where coach_id in (a_id, b_id) or client_id in (a_id, b_id);
  delete from public.organizations where id in (org_a, org_b);

  insert into public.organizations (id, slug, name) values
    (org_a, 'authz-selftest-a', 'Selftest Org A'),
    (org_b, 'authz-selftest-b', 'Selftest Org B');

  -- A manages Org A. B owns Org B. Neither belongs to the other's.
  insert into public.organization_members (organization_id, user_id, role) values
    (org_a, a_id, 'gym_manager'),
    (org_b, b_id, 'gym_owner');

  ----------------------------------------------------------------------------
  -- Act as A.
  ----------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'role', 'authenticated')::text, true);

  -- Tenant isolation, reads.
  select count(*) into n from public.organizations where id = org_a;
  return query select 'A sees the organization A belongs to'::text, '1'::text, n::text, n = 1;

  select count(*) into n from public.organizations where id = org_b;
  return query select 'A cannot see organization B'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.organization_members where organization_id = org_b;
  return query select 'A cannot list B''s members'::text, '0'::text, n::text, n = 0;

  -- Tenant isolation, writes. Adding yourself to someone else's organization
  -- is the whole IDOR class in one statement.
  begin
    insert into public.organization_members (organization_id, user_id, role)
    values (org_b, a_id, 'gym_staff');
    return query select 'A cannot join organization B'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot join organization B'::text, 'refused'::text, 'refused'::text, true;
  end;

  delete from public.organization_members where organization_id = org_b;
  get diagnostics n = row_count;
  return query select 'A cannot remove B''s members'::text, '0 rows'::text, n::text || ' rows', n = 0;

  update public.organizations set name = 'HIJACKED' where id = org_b;
  get diagnostics n = row_count;
  return query select 'A cannot rename organization B'::text, '0 rows'::text, n::text || ' rows', n = 0;

  -- A manages Org A but is not its owner: minting an owner would be an
  -- escalation from manager to owner in one insert.
  begin
    insert into public.organization_members (organization_id, user_id, role)
    values (org_a, b_id, 'gym_owner');
    return query select 'A manager cannot mint an owner'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A manager cannot mint an owner'::text, 'refused'::text, 'refused'::text, true;
  end;

  -- ...but may add ordinary staff to the organization they manage.
  begin
    insert into public.organization_members (organization_id, user_id, role)
    values (org_a, b_id, 'gym_staff');
    return query select 'A manager can add staff to their own org'::text, 'inserted'::text, 'inserted'::text, true;
  exception when others then
    return query select 'A manager can add staff to their own org'::text, 'inserted'::text, 'refused'::text, false;
  end;

  ----------------------------------------------------------------------------
  -- Platform-role escalation. No insert policy exists, so RLS refuses every
  -- write from `authenticated`. This is the assertion that protects /admin.
  ----------------------------------------------------------------------------
  begin
    insert into public.platform_role_assignments (user_id, role)
    values (a_id, 'platform_admin');
    return query select 'A cannot grant themselves platform_admin'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot grant themselves platform_admin'::text, 'refused'::text, 'refused'::text, true;
  end;

  begin
    insert into public.platform_role_assignments (user_id, role)
    values (a_id, 'super_admin');
    return query select 'A cannot grant themselves super_admin'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot grant themselves super_admin'::text, 'refused'::text, 'refused'::text, true;
  end;

  select count(*) into n from public.platform_role_assignments;
  return query select 'A cannot read the platform role table'::text, '0'::text, n::text, n = 0;

  select private.is_platform_admin(a_id) into flag;
  return query select 'A is not a platform admin'::text, 'false'::text, flag::text, flag = false;

  ----------------------------------------------------------------------------
  -- Coach access is consent-gated: the relationship must exist AND be active.
  ----------------------------------------------------------------------------
  select private.is_coach_of(b_id, a_id) into flag;
  return query select 'A does not coach B with no relationship'::text, 'false'::text, flag::text, flag = false;

  -- A proposes coaching B. A coach may only ever insert a `pending` row.
  begin
    insert into public.coach_clients (coach_id, client_id, status)
    values (a_id, b_id, 'active');
    return query select 'A cannot self-activate a coaching relationship'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot self-activate a coaching relationship'::text, 'refused'::text, 'refused'::text, true;
  end;

  begin
    insert into public.coach_clients (coach_id, client_id, status)
    values (a_id, b_id, 'pending');
    return query select 'A can propose coaching B'::text, 'inserted'::text, 'inserted'::text, true;
  exception when others then
    return query select 'A can propose coaching B'::text, 'inserted'::text, 'refused'::text, false;
  end;

  select private.is_coach_of(b_id, a_id) into flag;
  return query select 'A pending invitation grants nothing'::text, 'false'::text, flag::text, flag = false;

  -- A cannot accept on B's behalf.
  update public.coach_clients set status = 'active' where coach_id = a_id and client_id = b_id;
  get diagnostics n = row_count;
  return query select 'A cannot accept their own invitation'::text, '0 rows'::text, n::text || ' rows', n = 0;

  -- Forging a relationship in someone else's name.
  begin
    insert into public.coach_clients (coach_id, client_id, status)
    values (b_id, a_id, 'pending');
    return query select 'A cannot forge a coaching row owned by B'::text, 'refused'::text, 'inserted'::text, false;
  exception when others then
    return query select 'A cannot forge a coaching row owned by B'::text, 'refused'::text, 'refused'::text, true;
  end;

  ----------------------------------------------------------------------------
  -- Act as B: the client accepts, and only then does access follow.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', b_id, 'role', 'authenticated')::text, true);

  update public.coach_clients set status = 'active' where coach_id = a_id and client_id = b_id;
  get diagnostics n = row_count;
  return query select 'B can accept the invitation'::text, '1 rows'::text, n::text || ' rows', n = 1;

  select private.is_coach_of(b_id, a_id) into flag;
  return query select 'A coaches B once B accepted'::text, 'true'::text, flag::text, flag = true;

  select private.is_coach_of(a_id, b_id) into flag;
  return query select 'Acceptance is not symmetric'::text, 'false'::text, flag::text, flag = false;

  ----------------------------------------------------------------------------
  -- Anonymous.
  ----------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  select count(*) into n from public.organizations;
  return query select 'Anonymous sees no organizations'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.organization_members;
  return query select 'Anonymous sees no memberships'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.coach_clients;
  return query select 'Anonymous sees no coaching relationships'::text, '0'::text, n::text, n = 0;

  select count(*) into n from public.platform_role_assignments;
  return query select 'Anonymous sees no platform roles'::text, '0'::text, n::text, n = 0;

  ----------------------------------------------------------------------------
  -- Tear down.
  ----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  delete from public.coach_clients
    where coach_id in (a_id, b_id) or client_id in (a_id, b_id);
  delete from public.organizations where id in (org_a, org_b);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

revoke execute on function private.authz_selftest() from public, anon, authenticated;
