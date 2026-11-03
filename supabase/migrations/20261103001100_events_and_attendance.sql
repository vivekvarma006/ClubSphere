-- =============================================================================
-- 1100 Events, registrations, QR credentials and attendance
--
--   events                   organized by one organization (draft -> published
--                            -> completed | cancelled)
--   event_registrations      one per member per event (registered/cancelled)
--   registration_credentials the secret QR token for a registration
--   event_attendance         one row per checked-in registration
--
-- Guarantees enforced here:
--   * capacity is never exceeded, even when the last seats are taken by
--     simultaneous requests (event row lock in register_for_event)
--   * a QR code checks someone in exactly once (attendance PK = registration)
--   * QR tokens are 244-bit random values readable only by their owner
-- =============================================================================

select private.register_permission('event.manage',  'Create, edit, publish and cancel events; see registrations', array['officer']);
select private.register_permission('event.checkin', 'Scan QR codes to check participants in',                     array['officer', 'volunteer']);

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null,
  description     text not null default '',
  category        text not null default 'workshop',
  venue           text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        int,
  status          text not null default 'draft',
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint events_org_id_key          unique (organization_id, id),
  constraint events_title_length        check (char_length(btrim(title)) between 3 and 120),
  constraint events_description_length  check (char_length(description) <= 5000),
  constraint events_category_valid      check (category in ('workshop', 'hackathon', 'ctf', 'talk', 'competition', 'social', 'recruitment', 'other')),
  constraint events_venue_length        check (venue is null or char_length(venue) <= 200),
  constraint events_time_order          check (ends_at > starts_at),
  constraint events_capacity_range      check (capacity is null or capacity between 1 and 100000),
  constraint events_status_valid        check (status in ('draft', 'published', 'completed', 'cancelled'))
);

create index events_org_start_idx on public.events (organization_id, starts_at desc);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function private.set_updated_at();

create trigger events_audit
  after insert or update or delete on public.events
  for each row execute function private.audit_row_change('event');

-- -----------------------------------------------------------------------------

create table public.event_registrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id        uuid not null,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'registered',
  registered_at   timestamptz not null default now(),
  cancelled_at    timestamptz,

  constraint event_registrations_one_per_user  unique (event_id, user_id),
  constraint event_registrations_event_id_key  unique (event_id, id),       -- target for attendance FK
  constraint event_registrations_status_valid  check (status in ('registered', 'cancelled')),
  constraint event_registrations_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint event_registrations_event_fk
    foreign key (organization_id, event_id) references public.events (organization_id, id) on delete cascade
);

create index event_registrations_user_idx on public.event_registrations (user_id, registered_at desc);

create trigger event_registrations_audit
  after insert or update or delete on public.event_registrations
  for each row execute function private.audit_row_change('event_registration', 'event_id', 'user_id');

-- -----------------------------------------------------------------------------
-- QR credentials. Two random UUIDs (122 random bits each) give a 64-hex-char
-- token with 244 bits of randomness: infeasible to guess. Only the owner of
-- the registration can read it (RLS); scanners never read this table, they
-- submit a token to private.check_in() which looks it up.
-- -----------------------------------------------------------------------------
create table public.registration_credentials (
  registration_id uuid primary key references public.event_registrations (id) on delete cascade,
  token           text not null,
  issued_at       timestamptz not null default now(),

  constraint registration_credentials_token_key    unique (token),
  constraint registration_credentials_token_format check (token ~ '^[0-9a-f]{64}$')
);

create or replace function private.issue_registration_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.registration_credentials (registration_id, token)
  values (new.id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  return null;
end;
$$;

create trigger event_registrations_issue_credential
  after insert on public.event_registrations
  for each row execute function private.issue_registration_credential();

-- -----------------------------------------------------------------------------

create table public.event_attendance (
  registration_id uuid primary key,              -- one check-in per registration
  organization_id uuid not null,
  event_id        uuid not null,
  checked_in_at   timestamptz not null default now(),
  checked_in_by   uuid references public.profiles (id) on delete set null,

  constraint event_attendance_registration_fk
    foreign key (event_id, registration_id) references public.event_registrations (event_id, id) on delete cascade,
  constraint event_attendance_event_fk
    foreign key (organization_id, event_id) references public.events (organization_id, id) on delete cascade
);

create index event_attendance_event_idx on public.event_attendance (event_id, checked_in_at);

create trigger event_attendance_audit
  after insert or update or delete on public.event_attendance
  for each row execute function private.audit_row_change('attendance', 'event_id', 'registration_id');

-- -----------------------------------------------------------------------------
-- Procedures
-- -----------------------------------------------------------------------------

-- Returns the registration id. Idempotent for an existing registration.
create or replace function private.register_for_event(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_actor();
  v_event public.events;
  v_reg   public.event_registrations;
  v_taken int;
  v_id    uuid;
begin
  -- FOR NO KEY UPDATE serializes registrations for this event (so two people
  -- cannot both take the last seat) without blocking foreign-key checks.
  select * into v_event from public.events where id = p_event_id for no key update;

  if not found or not private.is_active_member(v_event.organization_id)
     or not exists (select 1 from public.organizations o where o.id = v_event.organization_id and o.status = 'active') then
    raise exception 'event not found' using errcode = 'CS404';
  end if;
  if v_event.status <> 'published' then
    raise exception 'registration is not open for this event' using errcode = 'CS409';
  end if;
  if v_event.ends_at <= now() then
    raise exception 'this event has already ended' using errcode = 'CS409';
  end if;

  select * into v_reg from public.event_registrations where event_id = p_event_id and user_id = v_actor;
  if found and v_reg.status = 'registered' then
    return v_reg.id;
  end if;

  if v_event.capacity is not null then
    select count(*) into v_taken from public.event_registrations
     where event_id = p_event_id and status = 'registered';
    if v_taken >= v_event.capacity then
      raise exception 'this event is full' using errcode = 'CS409';
    end if;
  end if;

  if v_reg.id is not null then
    update public.event_registrations
       set status = 'registered', cancelled_at = null, registered_at = now()
     where id = v_reg.id
    returning id into v_id;
  else
    insert into public.event_registrations (organization_id, event_id, user_id)
    values (v_event.organization_id, p_event_id, v_actor)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.cancel_registration(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_actor();
  v_reg   public.event_registrations;
  v_start timestamptz;
begin
  select * into v_reg from public.event_registrations
   where id = p_registration_id and user_id = v_actor
   for update;
  if not found then
    raise exception 'registration not found' using errcode = 'CS404';
  end if;
  if v_reg.status = 'cancelled' then
    return;
  end if;
  if exists (select 1 from public.event_attendance a where a.registration_id = p_registration_id) then
    raise exception 'you have already been checked in' using errcode = 'CS409';
  end if;
  select starts_at into v_start from public.events where id = v_reg.event_id;
  if v_start <= now() then
    raise exception 'the event has already started' using errcode = 'CS409';
  end if;

  update public.event_registrations
     set status = 'cancelled', cancelled_at = now()
   where id = p_registration_id;
end;
$$;

-- Shared by both check-in paths. Assumes the caller has already authorized.
create or replace function private.record_attendance(p_registration public.event_registrations)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_name  text;
  v_time  timestamptz;
  v_state text := 'checked_in';
begin
  if p_registration.status <> 'registered' then
    raise exception 'this registration was cancelled' using errcode = 'CS409';
  end if;

  insert into public.event_attendance (registration_id, organization_id, event_id, checked_in_by)
  values (p_registration.id, p_registration.organization_id, p_registration.event_id, auth.uid())
  on conflict (registration_id) do nothing
  returning checked_in_at into v_time;

  if v_time is null then
    v_state := 'already_checked_in';
    select checked_in_at into v_time from public.event_attendance where registration_id = p_registration.id;
  end if;

  select display_name into v_name from public.profiles where id = p_registration.user_id;
  return jsonb_build_object(
    'status', v_state,
    'registration_id', p_registration.id,
    'display_name', v_name,
    'checked_in_at', v_time
  );
end;
$$;

-- Scanner path: the QR token identifies the registration.
create or replace function private.check_in(p_event_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_reg   public.event_registrations;
begin
  perform private.require_actor();

  select * into v_event from public.events where id = p_event_id;
  if not found or not private.has_org_permission(v_event.organization_id, 'event.checkin') then
    raise exception 'event not found' using errcode = 'CS404';
  end if;
  if v_event.status <> 'published' then
    raise exception 'check-in is not open for this event' using errcode = 'CS409';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'this is not a ClubSphere QR code' using errcode = 'CS422';
  end if;

  select r.* into v_reg
    from public.registration_credentials c
    join public.event_registrations r on r.id = c.registration_id
   where c.token = p_token;

  -- Tokens from other organizations are reported as unknown, not "wrong event".
  if not found or v_reg.organization_id <> v_event.organization_id then
    raise exception 'QR code not recognised' using errcode = 'CS404';
  end if;
  if v_reg.event_id <> p_event_id then
    raise exception 'this QR code is for a different event' using errcode = 'CS409';
  end if;

  return private.record_attendance(v_reg);
end;
$$;

-- Manual path for officers (e.g. the attendee's phone is dead).
create or replace function private.check_in_registration(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg    public.event_registrations;
  v_status text;
begin
  perform private.require_actor();
  select * into v_reg from public.event_registrations where id = p_registration_id;
  if not found or not private.has_org_permission(v_reg.organization_id, 'event.manage') then
    raise exception 'registration not found' using errcode = 'CS404';
  end if;
  select status into v_status from public.events where id = v_reg.event_id;
  if v_status <> 'published' then
    raise exception 'check-in is not open for this event' using errcode = 'CS409';
  end if;
  return private.record_attendance(v_reg);
end;
$$;

-- Seat counts for members. RLS rightly hides other people's registrations,
-- so this returns only the numbers, and only to members of the club.
create or replace function private.event_registration_counts(p_org_id uuid)
returns table (event_id uuid, registered int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.event_id, count(*)::int
    from public.event_registrations r
   where r.organization_id = p_org_id
     and r.status = 'registered'
     and private.is_active_member(p_org_id)
   group by r.event_id;
$$;

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------
revoke all on public.events, public.event_registrations, public.registration_credentials, public.event_attendance
  from anon, authenticated;

alter table public.events                   enable row level security;
alter table public.event_registrations      enable row level security;
alter table public.registration_credentials enable row level security;
alter table public.event_attendance         enable row level security;

grant select, delete on public.events to authenticated;
grant insert (organization_id, title, description, category, venue, starts_at, ends_at, capacity, status) on public.events to authenticated;
grant update (title, description, category, venue, starts_at, ends_at, capacity, status) on public.events to authenticated;

-- Drafts are visible only to event managers.
create policy events_select on public.events
  for select to authenticated
  using ((status <> 'draft' and private.is_active_member(organization_id))
         or private.has_org_permission(organization_id, 'event.manage'));

create policy events_insert on public.events
  for insert to authenticated
  with check (private.has_org_permission(organization_id, 'event.manage'));

create policy events_update on public.events
  for update to authenticated
  using (private.has_org_permission(organization_id, 'event.manage'))
  with check (private.has_org_permission(organization_id, 'event.manage'));

create policy events_delete_drafts on public.events
  for delete to authenticated
  using (status = 'draft' and private.has_org_permission(organization_id, 'event.manage'));

grant select on public.event_registrations, public.registration_credentials, public.event_attendance to authenticated;

create policy event_registrations_select on public.event_registrations
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_org_permission(organization_id, 'event.manage')
         or private.has_org_permission(organization_id, 'event.checkin'));

create policy registration_credentials_select_own on public.registration_credentials
  for select to authenticated
  using (exists (select 1 from public.event_registrations r
                  where r.id = registration_id and r.user_id = (select auth.uid())));

create policy event_attendance_select on public.event_attendance
  for select to authenticated
  using (exists (select 1 from public.event_registrations r
                  where r.id = registration_id and r.user_id = (select auth.uid()))
         or private.has_org_permission(organization_id, 'event.manage')
         or private.has_org_permission(organization_id, 'event.checkin'));

revoke all on all functions in schema private from public, anon;
revoke all on function private.issue_registration_credential() from public, anon, authenticated;
revoke all on function private.record_attendance(public.event_registrations) from public, anon, authenticated;
grant execute on function
  private.event_registration_counts(uuid),
  private.register_for_event(uuid),
  private.cancel_registration(uuid),
  private.check_in(uuid, text),
  private.check_in_registration(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Report: attendance per event
-- -----------------------------------------------------------------------------
create view public.report_event_attendance
with (security_invoker = true) as
with reg as (
  select event_id,
         count(*) filter (where status = 'registered') as registered
    from public.event_registrations
   group by event_id
),
att as (
  select event_id, count(*) as attended
    from public.event_attendance
   group by event_id
)
select e.organization_id,
       e.id        as event_id,
       e.title,
       e.category,
       e.starts_at,
       e.status,
       e.capacity,
       coalesce(reg.registered, 0) as registered,
       coalesce(att.attended, 0)   as attended,
       round(100.0 * coalesce(att.attended, 0) / nullif(reg.registered, 0), 1) as attendance_rate_pct,
       round(100.0 * reg.registered / nullif(e.capacity, 0), 1)   as fill_rate_pct
  from public.events e
  left join reg on reg.event_id = e.id
  left join att on att.event_id = e.id
 where private.has_org_permission(e.organization_id, 'analytics.read');

revoke all on public.report_event_attendance from anon, authenticated;
grant select on public.report_event_attendance to authenticated;
