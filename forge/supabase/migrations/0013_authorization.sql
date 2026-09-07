-- FORGE — 0013 authorization foundation.
--
-- Authentication already exists; authorization does not. This adds the smallest
-- coherent model that coach, gym and admin surfaces can be built on later
-- without a security rewrite.
--
-- Three deliberate design decisions, recorded here because they are the kind of
-- thing a future reader will otherwise reverse by accident:
--
-- 1. Roles are *assignments*, held in the database; the map from a role to the
--    permissions it grants lives in code (@forge/contracts). A `role_permissions`
--    table would let the database and the code disagree about what
--    `gym.member.manage` means, and adding a permission would need a migration.
--    Runtime-configurable custom roles can be layered on later as an overlay
--    table without changing any of this.
--
-- 2. There is no global role column on `profiles`. A person is routinely a
--    member here, a coach there, and staff at one gym; a single column cannot
--    express that and every attempt to make it do so ends in special cases.
--    Roles are therefore always scoped — to an organization, or to the platform.
--
-- 3. Platform roles live in their own table with no self-service path. Nobody
--    can grant themselves `platform_admin` through the API; the policies below
--    make the table readable only to existing platform admins and writable by
--    no ordinary role at all. Escalation has to go through a service-role
--    context, which is audited and never reaches the browser.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Scoped to one organization. `member` is the ordinary gym member; `coach` here
-- means a coach *operating under that organization*, distinct from an
-- independent coach, which is the coach_clients relationship below.
create type org_role as enum (
  'gym_owner',
  'gym_manager',
  'gym_staff',
  'coach',
  'member'
);

-- Platform-wide operational roles. Deliberately only two: every additional
-- platform role is a permission someone can hold forever by accident.
create type platform_role as enum (
  'platform_admin',
  'super_admin'
);

create type coach_client_status as enum ('pending', 'active', 'ended');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organizations (
  id          uuid primary key default extensions.uuid_generate_v4(),
  slug        citext not null unique,
  name        text not null check (length(trim(name)) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

-- One row per (organization, user, role). The composite key is what allows a
-- person to hold several roles in the same organization — a gym owner who also
-- coaches is two rows, not a special case.
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            org_role not null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id, role)
);

create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_org_idx on public.organization_members (organization_id, role);

create table public.platform_role_assignments (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       platform_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- The authorization primitive for an independent coach: without a row here,
-- a coach is an ordinary member with respect to somebody else's data. Kept
-- deliberately thin — programmes, notes and scheduling are product schema for
-- a later phase, not authorization.
create table public.coach_clients (
  coach_id   uuid not null references public.profiles (id) on delete cascade,
  client_id  uuid not null references public.profiles (id) on delete cascade,
  status     coach_client_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (coach_id, client_id),
  constraint coach_is_not_client check (coach_id <> client_id)
);

create index coach_clients_client_idx on public.coach_clients (client_id, status);

create trigger coach_clients_touch before update on public.coach_clients
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers, in `private` so PostgREST does not serve them as RPC (see 0009).
-- SECURITY DEFINER + STABLE so policies can call them without recursing into
-- the very policies being evaluated.
-- ---------------------------------------------------------------------------

create or replace function private.is_platform_admin(u uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_role_assignments
    where user_id = u
  );
$$;

create or replace function private.is_super_admin(u uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_role_assignments
    where user_id = u and role = 'super_admin'
  );
$$;

create or replace function private.is_org_member(org uuid, u uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org and user_id = u
  );
$$;

create or replace function private.has_org_role(org uuid, roles org_role[], u uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org and user_id = u and role = any(roles)
  );
$$;

/** Roles the current user holds in one organization. Used by the app to build
    a permission set without a second round trip. */
create or replace function private.org_roles_of(org uuid, u uuid default auth.uid())
returns org_role[] language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(role order by role), '{}')
  from public.organization_members
  where organization_id = org and user_id = u;
$$;

/** True when the current user coaches `client` under an active relationship.
    `pending` deliberately grants nothing — an invitation is not consent. */
create or replace function private.is_coach_of(client uuid, u uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.coach_clients
    where coach_id = u and client_id = client and status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.organizations             enable row level security;
alter table public.organization_members      enable row level security;
alter table public.platform_role_assignments enable row level security;
alter table public.coach_clients             enable row level security;

-- Organizations: visible to their own members, and to platform admins.
create policy organizations_read on public.organizations
  for select using (
    private.is_org_member(id) or private.is_platform_admin()
  );

-- Only an owner may rename or reconfigure an organization.
create policy organizations_update on public.organizations
  for update using (private.has_org_role(id, array['gym_owner']::org_role[]))
  with check (private.has_org_role(id, array['gym_owner']::org_role[]));

-- Membership rows are visible within the organization, and to the subject.
create policy organization_members_read on public.organization_members
  for select using (
    user_id = (select auth.uid())
    or private.is_org_member(organization_id)
    or private.is_platform_admin()
  );

-- Only owners and managers may change who belongs to an organization, and a
-- manager may not mint an owner — that is an escalation path.
create policy organization_members_insert on public.organization_members
  for insert with check (
    private.has_org_role(organization_id, array['gym_owner']::org_role[])
    or (
      private.has_org_role(organization_id, array['gym_manager']::org_role[])
      and role <> 'gym_owner'
    )
  );

create policy organization_members_delete on public.organization_members
  for delete using (
    private.has_org_role(organization_id, array['gym_owner']::org_role[])
    or (
      private.has_org_role(organization_id, array['gym_manager']::org_role[])
      and role <> 'gym_owner'
    )
  );

-- Platform roles: readable only by those who already hold one. There is
-- deliberately NO insert, update or delete policy — with RLS enabled and no
-- permissive policy, every write from `anon` and `authenticated` is refused.
-- Granting a platform role is an out-of-band, service-role operation.
create policy platform_roles_read on public.platform_role_assignments
  for select using (private.is_platform_admin());

-- Coach relationships: each side sees its own rows.
create policy coach_clients_read on public.coach_clients
  for select using (
    coach_id = (select auth.uid())
    or client_id = (select auth.uid())
    or private.is_platform_admin()
  );

-- A coach proposes the relationship; only the client can move it to active,
-- which is what makes `is_coach_of` a consent check rather than a claim.
create policy coach_clients_insert on public.coach_clients
  for insert with check (coach_id = (select auth.uid()) and status = 'pending');

create policy coach_clients_update on public.coach_clients
  for update using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

create policy coach_clients_delete on public.coach_clients
  for delete using (
    coach_id = (select auth.uid()) or client_id = (select auth.uid())
  );

-- PostgREST needs table privileges as well as policies; RLS then narrows them.
grant select on public.organizations to authenticated;
grant update on public.organizations to authenticated;
grant select, insert, delete on public.organization_members to authenticated;
grant select on public.platform_role_assignments to authenticated;
grant select, insert, update, delete on public.coach_clients to authenticated;
