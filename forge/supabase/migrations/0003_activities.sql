-- FORGE Web Beta — 0003 activities.
--
-- The privacy-critical decision here: raw geometry and per-sample streams live
-- in their own tables (activity_tracks, activity_streams) that no visibility
-- policy touches. `activities.map_polyline` holds the already-sanitized line,
-- so the worst a visibility bug can leak is the trimmed shape. See §64/§65.
create type activity_source as enum ('manual', 'upload', 'ios', 'web');

create table public.activities (
  id                uuid primary key default extensions.uuid_generate_v4(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  sport             sport_type not null,
  title             text not null default '',
  description       text not null default '',
  started_at        timestamptz not null,
  timezone          text not null default 'UTC',
  elapsed_s         integer not null default 0 check (elapsed_s >= 0),
  moving_s          integer not null default 0 check (moving_s >= 0),
  distance_m        integer not null default 0 check (distance_m >= 0),
  elevation_gain_m  integer not null default 0 check (elevation_gain_m >= 0),
  avg_hr            smallint check (avg_hr between 20 and 260),
  max_hr            smallint check (max_hr between 20 and 260),
  calories          integer check (calories >= 0),
  training_load     numeric(8,2),
  visibility        visibility_level not null default 'followers',
  source            activity_source not null default 'manual',
  external_id       text,
  has_gps           boolean not null default false,
  map_polyline      text,
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Re-processing the same upload cannot create a duplicate activity.
  unique (user_id, source, external_id)
);

create index activities_user_started_idx on public.activities (user_id, started_at desc);
create index activities_sport_idx on public.activities (sport, started_at desc);
create index activities_visibility_idx on public.activities (visibility, started_at desc);
create trigger activities_touch before update on public.activities
  for each row execute function public.touch_updated_at();

create table public.activity_tracks (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  track       extensions.geography(LineString, 4326) not null,
  start_point extensions.geography(Point, 4326),
  end_point   extensions.geography(Point, 4326)
);
create index activity_tracks_gix on public.activity_tracks using gist (track);
create index activity_tracks_user_idx on public.activity_tracks (user_id);

-- Heavy per-sample series. Never selected by feed or home queries.
create table public.activity_streams (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  time_s      integer[]  not null default '{}',
  distance_m  integer[]  not null default '{}',
  altitude_m  real[]     not null default '{}',
  heartrate   smallint[] not null default '{}',
  cadence     smallint[] not null default '{}',
  velocity_ms real[]     not null default '{}'
);

create table public.activity_splits (
  activity_id uuid not null references public.activities (id) on delete cascade,
  idx         smallint not null,
  distance_m  integer not null,
  elapsed_s   integer not null,
  elevation_m real,
  avg_hr      smallint,
  primary key (activity_id, idx)
);

create table public.activity_best_efforts (
  activity_id uuid not null references public.activities (id) on delete cascade,
  distance_m  integer not null,
  elapsed_s   integer not null,
  primary key (activity_id, distance_m)
);

create table public.strength_sets (
  id            uuid primary key default extensions.uuid_generate_v4(),
  activity_id   uuid not null references public.activities (id) on delete cascade,
  exercise_slug text not null,
  set_index     smallint not null,
  reps          smallint not null check (reps >= 0),
  load_g        integer not null default 0 check (load_g >= 0),
  rpe           numeric(3,1) check (rpe between 1 and 10),
  completed     boolean not null default true,
  unique (activity_id, exercise_slug, set_index)
);
create index strength_sets_activity_idx on public.strength_sets (activity_id);

create table public.exercise_prs (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  exercise_slug text not null,
  best_1rm_g    integer not null default 0,
  best_volume_g bigint not null default 0,
  best_reps     smallint,
  achieved_at   timestamptz not null default now(),
  activity_id   uuid references public.activities (id) on delete set null,
  primary key (user_id, exercise_slug)
);

create table public.activity_kudos (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table public.activity_comments (
  id          uuid primary key default extensions.uuid_generate_v4(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index activity_comments_activity_idx on public.activity_comments (activity_id, created_at);

-- Superseded by private.* in 0009; kept here so the history replays in order.
create or replace function public.can_view_activity(viewer uuid, act uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.activities a
    where a.id = act and public.can_view(viewer, a.user_id, a.visibility));
$$;

create or replace function public.owns_activity(viewer uuid, act uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.activities a where a.id = act and a.user_id = viewer);
$$;
