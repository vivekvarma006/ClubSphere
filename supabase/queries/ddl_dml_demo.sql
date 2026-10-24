-- =============================================================================
-- Live DDL + DML demonstration for the viva. Safe to run anywhere: everything
-- happens inside one transaction that is ROLLED BACK at the end.
-- Paste into the Supabase SQL editor (runs as postgres). Tested by
-- test/db/demo-sql.test.ts.
-- =============================================================================
begin;

-- ---------- DDL: CREATE -------------------------------------------------------
create table public.demo_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null check (char_length(title) between 3 and 120),
  starts_at       timestamptz not null,
  capacity        int not null check (capacity > 0)
);

-- ---------- DDL: ALTER --------------------------------------------------------
alter table public.demo_events add column venue text;
alter table public.demo_events add constraint demo_events_title_unique unique (organization_id, title);
alter table public.demo_events alter column venue set default 'TBA';
alter table public.demo_events rename column capacity to max_attendees;

-- ---------- DDL: index --------------------------------------------------------
create index demo_events_org_time_idx on public.demo_events (organization_id, starts_at);

-- ---------- DML: INSERT -------------------------------------------------------
insert into public.demo_events (organization_id, title, starts_at, max_attendees)
select id, name || ' orientation', now() + interval '7 days', 120 from public.organizations;

-- A constraint rejecting bad data, handled so the demo continues:
do $$
begin
  insert into public.demo_events (organization_id, title, starts_at, max_attendees)
  select id, 'x', now(), 0 from public.organizations limit 1;
exception when check_violation then
  raise notice 'CHECK constraint rejected the row: %', sqlerrm;
end $$;

-- ---------- DML: UPDATE / SELECT ----------------------------------------------
update public.demo_events set venue = 'Main Auditorium' where max_attendees >= 100;

select o.slug, e.title, e.venue, e.max_attendees
  from public.demo_events e
  join public.organizations o on o.id = e.organization_id
 order by o.slug;

-- ---------- DML: DELETE -------------------------------------------------------
delete from public.demo_events
 where organization_id = (select id from public.organizations order by slug limit 1)
returning title;   -- RETURNING shows what was removed

-- ---------- DDL: DROP ---------------------------------------------------------
drop index public.demo_events_org_time_idx;
alter table public.demo_events drop column venue;
drop table public.demo_events;

rollback;   -- leave the real schema untouched
