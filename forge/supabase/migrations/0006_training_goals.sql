-- FORGE Web Beta — 0006 training and goals.
create type plan_status as enum ('active', 'completed', 'abandoned');
create type day_status  as enum ('scheduled', 'completed', 'skipped', 'rest');
create type goal_kind   as enum ('weekly_sessions', 'weekly_minutes', 'weekly_distance',
                                 'strength_sessions', 'program_completion', 'race');
create type goal_status as enum ('active', 'achieved', 'missed', 'archived');

-- Public catalogue: readable by anyone (marketing surface and SEO), writable
-- only by service-role, so no insert policy is granted.
create table public.programs (
  slug              text primary key,
  name              text not null,
  tagline           text not null default '',
  summary           text not null default '',
  sport             sport_type not null,
  goal              text not null default '',
  weeks             smallint not null check (weeks between 1 and 52),
  sessions_per_week smallint not null check (sessions_per_week between 1 and 14),
  session_minutes   smallint not null default 45,
  difficulty        text not null default 'intermediate',
  equipment         text[] not null default '{}',
  cover_key         text not null default '',
  published         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index programs_published_idx on public.programs (published, sport);

create table public.plans (
  id           uuid primary key default extensions.uuid_generate_v4(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  program_slug text references public.programs (slug) on delete set null,
  name         text not null default '',
  start_date   date not null,
  weeks        smallint not null check (weeks between 1 and 52),
  status       plan_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index plans_user_idx on public.plans (user_id, status);
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

create table public.plan_days (
  id          uuid primary key default extensions.uuid_generate_v4(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  week_index  smallint not null,
  phase       text not null default '',
  title       text not null default '',
  sport       sport_type,
  kind        text not null default 'session',
  status      day_status not null default 'scheduled',
  -- Set when a recorded activity fulfils this scheduled session (§106).
  activity_id uuid references public.activities (id) on delete set null,
  unique (plan_id, date, title)
);
create index plan_days_user_date_idx on public.plan_days (user_id, date);
create index plan_days_plan_idx on public.plan_days (plan_id, week_index);

create table public.plan_exercises (
  id             uuid primary key default extensions.uuid_generate_v4(),
  plan_day_id    uuid not null references public.plan_days (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  order_index    smallint not null,
  exercise_slug  text not null,
  sets           smallint not null,
  reps           smallint not null,
  reps_top       smallint,
  load_g         integer not null default 0,
  rpe            numeric(3,1),
  rest_s         smallint not null default 90,
  tempo          text,
  -- The phase multiplier already folded into load_g, kept so progression can
  -- divide it back out and never compound the taper into the stored load.
  intensity_bias numeric(4,3) not null default 1.0,
  unique (plan_day_id, order_index)
);
create index plan_exercises_day_idx on public.plan_exercises (plan_day_id);

create table public.goals (
  id           uuid primary key default extensions.uuid_generate_v4(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         goal_kind not null,
  sport        sport_type,
  target       numeric(12,2) not null check (target > 0),
  unit         text not null default '',
  period_start date not null,
  period_end   date,
  status       goal_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id, status);
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

alter table public.programs       enable row level security;
alter table public.plans          enable row level security;
alter table public.plan_days      enable row level security;
alter table public.plan_exercises enable row level security;
alter table public.goals          enable row level security;

create policy programs_select_published on public.programs
  for select using (published = true);
create policy plans_own on public.plans
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy plan_days_own on public.plan_days
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy plan_exercises_own on public.plan_exercises
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_own on public.goals
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
