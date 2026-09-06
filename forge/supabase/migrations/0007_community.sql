-- FORGE Web Beta — 0007 clubs, events and challenges.
create type club_privacy as enum ('public', 'private');
create type member_role  as enum ('member', 'admin', 'owner');
create type rsvp_status  as enum ('going', 'interested', 'declined');

create table public.clubs (
  id            uuid primary key default extensions.uuid_generate_v4(),
  slug          text unique not null,
  name          text not null check (length(name) between 2 and 80),
  description   text not null default '',
  sport         sport_type,
  location_name text,
  location      extensions.geography(Point, 4326),
  cover_key     text not null default '',
  privacy       club_privacy not null default 'public',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index clubs_location_gix on public.clubs using gist (location);
create index clubs_sport_idx on public.clubs (sport, privacy);

create table public.club_members (
  club_id   uuid not null references public.clubs (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_members_user_idx on public.club_members (user_id);

create table public.events (
  id            uuid primary key default extensions.uuid_generate_v4(),
  club_id       uuid references public.clubs (id) on delete cascade,
  title         text not null check (length(title) between 2 and 140),
  description   text not null default '',
  sport         sport_type not null default 'run',
  category      text not null default 'community',
  starts_at     timestamptz not null,
  location_name text,
  location      extensions.geography(Point, 4326),
  distance_m    integer,
  capacity      integer check (capacity > 0),
  cover_key     text not null default '',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index events_starts_idx on public.events (starts_at);
create index events_location_gix on public.events using gist (location);

create table public.event_rsvps (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     rsvp_status not null default 'going',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.challenges (
  id          uuid primary key default extensions.uuid_generate_v4(),
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  -- Deliberately no weight or body-composition metric: the type cannot express
  -- a weight-loss competition.
  metric      text not null check (metric in ('distance_m', 'sessions', 'minutes', 'elevation_m')),
  sport       sport_type,
  target      numeric(12,2) not null check (target > 0),
  starts_on   date not null,
  ends_on     date not null,
  cover_key   text not null default '',
  published   boolean not null default false,
  check (ends_on >= starts_on)
);

create table public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  progress     numeric(12,2) not null default 0,
  joined_at    timestamptz not null default now(),
  completed_at timestamptz,
  primary key (challenge_id, user_id)
);

alter table public.clubs                  enable row level security;
alter table public.club_members           enable row level security;
alter table public.events                 enable row level security;
alter table public.event_rsvps            enable row level security;
alter table public.challenges             enable row level security;
alter table public.challenge_participants enable row level security;

-- Superseded by private.* in 0009.
create or replace function public.is_club_member(viewer uuid, club uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.club_members m where m.club_id = club and m.user_id = viewer); $$;

create or replace function public.is_club_admin(viewer uuid, club uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.club_members m
  where m.club_id = club and m.user_id = viewer and m.role in ('admin', 'owner')); $$;

-- A private club is invisible to non-members, including its existence in lists.
create policy clubs_select on public.clubs
  for select using (privacy = 'public' or public.is_club_member((select auth.uid()), id));
create policy clubs_insert on public.clubs
  for insert with check (created_by = (select auth.uid()));
create policy clubs_update_admin on public.clubs
  for update using (public.is_club_admin((select auth.uid()), id))
  with check (public.is_club_admin((select auth.uid()), id));

create policy club_members_select on public.club_members
  for select using (user_id = (select auth.uid())
    or public.is_club_member((select auth.uid()), club_id)
    or exists (select 1 from public.clubs c where c.id = club_id and c.privacy = 'public'));
create policy club_members_join_self on public.club_members
  for insert with check (user_id = (select auth.uid()));
create policy club_members_leave_self on public.club_members
  for delete using (user_id = (select auth.uid()) or public.is_club_admin((select auth.uid()), club_id));

create policy events_select on public.events
  for select using (club_id is null
    or exists (select 1 from public.clubs c where c.id = club_id and c.privacy = 'public')
    or public.is_club_member((select auth.uid()), club_id));
create policy events_insert on public.events
  for insert with check (created_by = (select auth.uid())
    and (club_id is null or public.is_club_admin((select auth.uid()), club_id)));

create policy rsvps_select on public.event_rsvps
  for select using (user_id = (select auth.uid()));
create policy rsvps_write_self on public.event_rsvps
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy challenges_select on public.challenges
  for select using (published = true);
create policy participants_self on public.challenge_participants
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
