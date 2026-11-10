-- Development rollback: restore the previous functions before removing waitlists.
drop trigger events_waitlist_changed on public.events;
drop trigger events_capacity_guard on public.events;
drop function private.event_waitlist_changed();
drop function private.guard_event_capacity();
drop function private.join_event_waitlist(uuid);
drop function private.leave_event_waitlist(uuid);
drop function private.my_event_waitlist(uuid);
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


drop function private.promote_event_waitlist(uuid);
drop table public.event_waitlist;
