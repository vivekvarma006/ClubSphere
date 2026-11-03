select private.register_permission('certificate.issue','Issue attendance certificates',array['officer']);
create table public.certificates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, event_id uuid not null,
  registration_id uuid not null unique, user_id uuid not null references public.profiles(id),
  verification_code text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
  recipient_name text not null, event_title text not null, organization_name text not null,
  issued_at timestamptz not null default now(), unique(organization_id,id),
  foreign key(organization_id,event_id) references public.events(organization_id,id),
  foreign key(organization_id,registration_id) references public.event_registrations(organization_id,id),
  foreign key(event_id,registration_id) references public.event_registrations(event_id,id)
);
create function private.issue_certificates(p_org uuid,p_event uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform private.require_module(p_org,'certificates','certificate.issue');
  if not exists(select 1 from public.events where id=p_event and organization_id=p_org and status='completed') then
    raise exception 'complete the event before issuing certificates' using errcode='CS409'; end if;
  insert into public.certificates(organization_id,event_id,registration_id,user_id,recipient_name,event_title,organization_name)
  select r.organization_id,r.event_id,r.id,r.user_id,p.display_name,e.title,o.name
  from public.event_registrations r join public.event_attendance a on a.registration_id=r.id
  join public.profiles p on p.id=r.user_id join public.events e on e.id=r.event_id join public.organizations o on o.id=r.organization_id
  where r.organization_id=p_org and r.event_id=p_event and r.status='registered'
  on conflict(registration_id) do nothing;
  get diagnostics v_count=row_count; return v_count;
end;
$$;
-- The only public read: possession of a random code reveals these printed fields.
create function public.verify_certificate(p_code text) returns table(recipient_name text,event_title text,organization_name text,issued_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.recipient_name,c.event_title,c.organization_name,c.issued_at from public.certificates c
  join public.organizations o on o.id=c.organization_id
  where c.verification_code=p_code and p_code ~ '^[0-9a-f]{64}$' and o.status='active';
$$;
alter table public.certificates enable row level security;
revoke all on public.certificates from public,anon,authenticated;
grant select on public.certificates to authenticated;
create policy certificates_read on public.certificates for select to authenticated using(private.module_enabled(organization_id,'certificates') and(user_id=auth.uid() or private.has_org_permission(organization_id,'certificate.issue')));
create trigger certificates_audit after insert or update or delete on public.certificates for each row execute function private.audit_row_change('certificate','event_id','user_id');
create index certificates_org_idx on public.certificates(organization_id,user_id);
revoke all on function private.issue_certificates(uuid,uuid),public.verify_certificate(text) from public,anon,authenticated;
grant execute on function private.issue_certificates(uuid,uuid) to authenticated;
grant execute on function public.verify_certificate(text) to anon,authenticated;
