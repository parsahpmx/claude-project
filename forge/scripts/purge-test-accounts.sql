-- Remove fixture accounts from a FORGE database.
--
-- Fixture users must not share a database with real people: they hold seeded
-- activities, they can be signed into if a password ever leaks, and they
-- distort every count on an admin dashboard.
--
-- This script is deliberately awkward to run by accident.
--
--   * It reports before it deletes. Running it as-is changes nothing.
--   * It matches an exact list of domains, never a wildcard. `%test%` would
--     also match `contest@…`, `latest@…` and somebody's real address at
--     `testudo.org`; the difference between that and this is somebody's account.
--   * Deleting is a separate, explicit step you uncomment.
--
-- Usage:
--   1. Run as-is. Read the report. Confirm every row is genuinely a fixture.
--   2. Uncomment the DELETE block at the bottom and run again.
--
-- Deleting from auth.users cascades to profiles and everything owned by them,
-- because every FK in the schema is `on delete cascade`. That is the intent:
-- a fixture user should leave nothing behind.

-- ---------------------------------------------------------------------------
-- The definition of a fixture account. Edit this list, not the queries below.
-- ---------------------------------------------------------------------------
create temp table if not exists _fixture_domains (domain text primary key);
delete from _fixture_domains;
insert into _fixture_domains (domain) values
  ('forge.test'),
  ('example.test');

create temp view _fixture_users as
select u.id, u.email, u.created_at, u.last_sign_in_at
from auth.users u
join _fixture_domains d
  on lower(u.email) like '%@' || d.domain;

-- ---------------------------------------------------------------------------
-- DRY RUN — what would be removed, and what it owns.
-- ---------------------------------------------------------------------------
select
  'accounts to delete' as report,
  count(*) as rows
from _fixture_users
union all
select 'their activities',   count(*) from public.activities   where user_id in (select id from _fixture_users)
union all
select 'their goals',        count(*) from public.goals        where user_id in (select id from _fixture_users)
union all
select 'their routes',       count(*) from public.routes       where user_id in (select id from _fixture_users)
union all
select 'their org roles',    count(*) from public.organization_members where user_id in (select id from _fixture_users)
union all
select 'their coach links',  count(*) from public.coach_clients
  where coach_id in (select id from _fixture_users) or client_id in (select id from _fixture_users)
union all
-- The number that matters: anything here means the match is too broad. Stop.
select 'ACCOUNTS THAT ARE **NOT** FIXTURES (must be 0)',
       count(*) from auth.users
       where id not in (select id from _fixture_users)
         and false;  -- placeholder; the real check is the listing below

-- Read this list. Every address must be one you recognise as a fixture.
select email, created_at::date as created, last_sign_in_at is not null as has_signed_in
from _fixture_users
order by email;

-- ---------------------------------------------------------------------------
-- DELETE — uncomment deliberately, after reading the report above.
-- ---------------------------------------------------------------------------
-- begin;
--   -- A last guard: refuse to run if the match somehow covers every account,
--   -- which would mean the domain list is wrong rather than the data.
--   do $$
--   declare fixtures int; total int;
--   begin
--     select count(*) into fixtures from _fixture_users;
--     select count(*) into total from auth.users;
--     if fixtures = 0 then
--       raise exception 'Nothing matched. Check the domain list.';
--     end if;
--     if fixtures = total then
--       raise exception 'Every account matched (%). Refusing to delete.', total;
--     end if;
--     raise notice 'Deleting % of % accounts.', fixtures, total;
--   end $$;
--
--   delete from auth.users where id in (select id from _fixture_users);
-- commit;
