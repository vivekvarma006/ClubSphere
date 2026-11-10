-- Event waitlists share the event lock with registration, cancellation and capacity changes.
create table public.event_waitlist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  queue_number bigint generated always as identity,
  status text not null default 'waiting' check (status in ('waiting','promoted','left','ineligible','closed')),
  joined_at timestamptz not null default now(),
  unique(organization_id,id), unique(event_id,user_id),
  foreign key(organization_id,event_id) references public.events(organization_id,id) on delete cascade
);
create index event_waitlist_queue_idx on public.event_waitlist(event_id,queue_number) where status='waiting';
alter table public.event_waitlist enable row level security;
revoke all on public.event_waitlist from public,anon,authenticated;
grant select on public.event_waitlist to authenticated;
create policy event_waitlist_read on public.event_waitlist for select to authenticated
  using (private.is_active_member(organization_id)
    and exists(select 1 from public.organizations where id=organization_id and status='active') and
    (user_id=auth.uid() or private.has_org_permission(organization_id,'event.manage')));
create trigger event_waitlist_audit after insert or update or delete on public.event_waitlist
  for each row execute function private.audit_row_change('event_waitlist','event_id','user_id');

-- Internal only. Unexpected errors abort the transaction; only known ineligible
-- memberships are skipped. Never change auth.uid() to impersonate a registrant.
create function private.promote_event_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events; w public.event_waitlist; taken int;
begin
  select * into e from public.events where id=p_event for no key update;
  if not found or e.status<>'published' or e.starts_at<=now()
    or not exists(select 1 from public.organizations where id=e.organization_id and status='active') then return; end if;
  select count(*) into taken from public.event_registrations where event_id=p_event and status='registered';
  for w in select * from public.event_waitlist where event_id=p_event and status='waiting' order by queue_number loop
    exit when e.capacity is not null and taken>=e.capacity;
    if not exists(select 1 from public.organization_memberships where organization_id=e.organization_id and user_id=w.user_id and status='active') then
      update public.event_waitlist set status='ineligible' where id=w.id;
      continue;
    end if;
    if exists(select 1 from public.event_registrations where event_id=p_event and user_id=w.user_id and status='registered') then
      update public.event_waitlist set status='promoted' where id=w.id;
      continue;
    end if;
    insert into public.event_registrations(organization_id,event_id,user_id)
      values(e.organization_id,p_event,w.user_id)
      on conflict(event_id,user_id) do update set status='registered',cancelled_at=null,registered_at=now();
    update public.event_waitlist set status='promoted' where id=w.id;
    taken:=taken+1;
  end loop;
end;
$$;

create function private.my_event_waitlist(p_event uuid) returns table(status text,queue_position int)
language sql stable security definer set search_path='' as $$
  select w.status, case when w.status='waiting' then
    (select count(*)::int from public.event_waitlist q
      join public.organization_memberships m on m.organization_id=q.organization_id and m.user_id=q.user_id and m.status='active'
      where q.event_id=w.event_id and q.status='waiting' and q.queue_number<=w.queue_number) else null end
  from public.event_waitlist w join public.events e on e.id=w.event_id
  where w.event_id=p_event and w.user_id=auth.uid() and private.is_active_member(w.organization_id)
    and exists(select 1 from public.organizations where id=w.organization_id and status='active')
    and e.status='published' and e.starts_at>now();
$$;

create function private.join_event_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(); e public.events; taken int;
begin
  select * into e from public.events where id=p_event for no key update;
  if not found or not private.is_active_member(e.organization_id)
    or not exists(select 1 from public.organizations where id=e.organization_id and status='active') then
    raise exception 'event not found' using errcode='CS404'; end if;
  if e.status<>'published' or e.starts_at<=now() then
    raise exception 'the waitlist is closed' using errcode='CS409'; end if;
  if exists(select 1 from public.event_registrations where event_id=p_event and user_id=actor and status='registered') then
    raise exception 'you are already registered' using errcode='CS409'; end if;
  if exists(select 1 from public.event_waitlist where event_id=p_event and user_id=actor and status='waiting') then return; end if;
  perform private.promote_event_waitlist(p_event);
  select count(*) into taken from public.event_registrations where event_id=p_event and status='registered';
  if e.capacity is null or taken<e.capacity then
    raise exception 'places are available; register for the event' using errcode='CS409'; end if;
  insert into public.event_waitlist(organization_id,event_id,user_id) values(e.organization_id,p_event,actor)
    on conflict(event_id,user_id) do update set status='waiting',joined_at=now(),queue_number=default;
end;
$$;

create function private.leave_event_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(); e public.events;
begin
  select * into e from public.events where id=p_event for no key update;
  if not found or not private.is_active_member(e.organization_id) then
    raise exception 'event not found' using errcode='CS404'; end if;
  update public.event_waitlist set status='left' where event_id=p_event and user_id=actor and status='waiting';
end;
$$;

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

  -- Give existing queue members first refusal before a new registration.
  perform private.promote_event_waitlist(p_event_id);
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


create or replace function private.cancel_registration(p_registration_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_actor(); r public.event_registrations; e public.events; event_ref uuid;
begin
  select event_id into event_ref from public.event_registrations where id=p_registration_id and user_id=actor;
  if not found then raise exception 'registration not found' using errcode='CS404'; end if;
  -- Always event before registration, matching the registration/promotion path.
  select * into e from public.events where id=event_ref for no key update;
  select * into r from public.event_registrations where id=p_registration_id and user_id=actor for update;
  if r.status='cancelled' then return; end if;
  if exists(select 1 from public.event_attendance where registration_id=p_registration_id) then
    raise exception 'you have already been checked in' using errcode='CS409'; end if;
  if e.starts_at<=now() then raise exception 'the event has already started' using errcode='CS409'; end if;
  update public.event_registrations set status='cancelled',cancelled_at=now() where id=p_registration_id;
  perform private.promote_event_waitlist(e.id);
end;
$$;

create function private.guard_event_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.capacity is not null and new.capacity<(select count(*) from public.event_registrations where event_id=new.id and status='registered') then
    raise exception 'capacity cannot be below current registrations' using errcode='CS409'; end if;
  return new;
end;
$$;
create trigger events_capacity_guard before update of capacity on public.events
  for each row execute function private.guard_event_capacity();
create function private.event_waitlist_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('completed','cancelled') then
    update public.event_waitlist set status='closed' where event_id=new.id and status='waiting';
  else perform private.promote_event_waitlist(new.id); end if;
  return null;
end;
$$;
create trigger events_waitlist_changed after update of capacity,status on public.events
  for each row execute function private.event_waitlist_changed();
revoke all on function private.promote_event_waitlist(uuid),private.guard_event_capacity(),private.event_waitlist_changed(),
  private.my_event_waitlist(uuid),private.join_event_waitlist(uuid),private.leave_event_waitlist(uuid) from public,anon,authenticated;
grant execute on function private.my_event_waitlist(uuid),private.join_event_waitlist(uuid),private.leave_event_waitlist(uuid) to authenticated;
