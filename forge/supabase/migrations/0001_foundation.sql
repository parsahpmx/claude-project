-- FORGE Web Beta — 0001 foundation
--
-- Extensions, identity, privacy and the SECURITY DEFINER helpers that every
-- later policy is built on.
--
-- Why helpers: an RLS policy on `activities` that reads `follows` would re-enter
-- RLS on `follows`, and a policy on `follows` that reads `blocks` re-enters
-- again. SECURITY DEFINER functions marked STABLE break that cycle and let the
-- planner cache the result within a statement.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------- enums

create type sport_type as enum (
  'run', 'walk', 'hike', 'ride', 'strength', 'functional', 'mobility'
);

create type visibility_level as enum (
  'private',    -- only me
  'followers',  -- accepted followers
  'public'      -- anyone, subject to profile visibility
);

create type follow_status as enum ('pending', 'accepted');

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      extensions.citext unique,
  display_name  text not null default '',
  bio           text not null default '',
  avatar_path   text,
  primary_sport sport_type,
  location_name text,
  -- Coarse city-level point only. Precise coordinates never live here; see
  -- private_zones for why exact home location is deliberately absent.
  location      extensions.geography(Point, 4326),
  units         text not null default 'metric' check (units in ('metric', 'imperial')),
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_username_trgm on public.profiles using gin (username extensions.gin_trgm_ops);
create index profiles_location_gix on public.profiles using gist (location);

-- ---------------------------------------------------------------- privacy

create table public.privacy_settings (
  user_id                 uuid primary key references public.profiles (id) on delete cascade,
  profile_visibility      visibility_level not null default 'followers',
  default_activity_visibility visibility_level not null default 'followers',
  route_visibility        visibility_level not null default 'private',
  require_follow_approval boolean not null default true,
  -- Start and end of every activity are trimmed by default. §64/§65: the
  -- sanitized polyline is what the world sees; the raw track never leaves the
  -- owner's own queries.
  hide_start_end          boolean not null default true,
  hide_radius_m           integer not null default 250 check (hide_radius_m between 0 and 2000),
  coach_sharing           boolean not null default false,
  aggregate_contribution  boolean not null default false,
  analytics_consent       boolean not null default false,
  ai_consent              boolean not null default false,
  updated_at              timestamptz not null default now()
);

create table public.private_zones (
  id         uuid primary key default extensions.uuid_generate_v4(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  label      text not null default 'Private zone',
  center     extensions.geography(Point, 4326) not null,
  radius_m   integer not null default 250 check (radius_m between 50 and 5000),
  created_at timestamptz not null default now()
);

create index private_zones_user_idx on public.private_zones (user_id);
create index private_zones_center_gix on public.private_zones using gist (center);

-- ---------------------------------------------------------------- social graph

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status      follow_status not null default 'pending',
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

create index follows_followee_idx on public.follows (followee_id, status);

-- ---------------------------------------------------------------- helpers

-- Blocking is symmetric for visibility: if either party has blocked the other,
-- neither sees the other's content.
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.follows_accepted(follower uuid, followee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.follows
    where follower_id = follower and followee_id = followee and status = 'accepted'
  );
$$;

-- One place decides whether `viewer` may see content published by `owner` at a
-- given visibility. Every content policy calls this rather than re-deriving it.
create or replace function public.can_view(viewer uuid, owner uuid, level visibility_level)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when owner is null then false
    when viewer = owner then true
    when viewer is null then
      -- Anonymous: only public content on a public profile.
      level = 'public' and coalesce(
        (select p.profile_visibility = 'public' from public.privacy_settings p where p.user_id = owner),
        false
      )
    when public.is_blocked(viewer, owner) then false
    when level = 'private' then false
    when level = 'followers' then public.follows_accepted(viewer, owner)
    when level = 'public' then
      coalesce(
        (select p.profile_visibility <> 'private' from public.privacy_settings p where p.user_id = owner),
        false
      )
    else false
  end;
$$;

-- ---------------------------------------------------------------- new user

-- A profile and a privacy row exist for every account from the moment it is
-- created, so no code path has to cope with their absence. Defaults are the
-- conservative ones: followers-only profile, private routes, trimmed tracks.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;

  insert into public.privacy_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger privacy_touch before update on public.privacy_settings
  for each row execute function public.touch_updated_at();
