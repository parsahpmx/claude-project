-- FORGE Web Beta — 0005 routes.
create type surface_type as enum ('road', 'trail', 'mixed', 'track', 'unknown');

create table public.routes (
  id               uuid primary key default extensions.uuid_generate_v4(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  name             text not null check (length(name) between 1 and 120),
  description      text not null default '',
  sport            sport_type not null default 'run',
  distance_m       integer not null check (distance_m >= 0),
  elevation_gain_m integer not null default 0 check (elevation_gain_m >= 0),
  estimated_s      integer not null default 0 check (estimated_s >= 0),
  surface          surface_type not null default 'unknown',
  -- A route is deliberately published, so its geometry lives with it rather
  -- than in a shadow table. Defaults to private.
  path             extensions.geography(LineString, 4326) not null,
  start_point      extensions.geography(Point, 4326) not null,
  visibility       visibility_level not null default 'private',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index routes_user_idx on public.routes (user_id, created_at desc);
create index routes_start_gix on public.routes using gist (start_point);
create index routes_path_gix on public.routes using gist (path);
create index routes_sport_distance_idx on public.routes (sport, distance_m);
create trigger routes_touch before update on public.routes
  for each row execute function public.touch_updated_at();

create table public.saved_routes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  route_id   uuid not null references public.routes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

alter table public.routes       enable row level security;
alter table public.saved_routes enable row level security;

create policy routes_select on public.routes
  for select using (user_id = (select auth.uid())
    or public.can_view((select auth.uid()), user_id, visibility));
create policy routes_insert_own on public.routes
  for insert with check (user_id = (select auth.uid()));
create policy routes_update_own on public.routes
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy routes_delete_own on public.routes
  for delete using (user_id = (select auth.uid()));
create policy saved_routes_own on public.saved_routes
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Redefined as SECURITY INVOKER in 0009: RLS on `routes` already filters rows,
-- so the elevated rights were unnecessary.
create or replace function public.routes_near(
  lat double precision, lng double precision,
  radius_m integer default 15000,
  sports sport_type[] default null,
  max_results integer default 50
) returns setof public.routes
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.* from public.routes r
  where extensions.st_dwithin(r.start_point,
          extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
          least(radius_m, 100000))
    and (sports is null or r.sport = any (sports))
    and (r.user_id = (select auth.uid())
         or public.can_view((select auth.uid()), r.user_id, r.visibility))
  order by extensions.st_distance(r.start_point,
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography)
  limit least(max_results, 200);
$$;
