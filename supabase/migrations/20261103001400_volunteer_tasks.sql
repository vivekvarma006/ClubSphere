select private.register_permission('task.manage','Create and assign volunteer tasks',array['officer']);
create table public.volunteer_tasks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  event_id uuid, title text not null check(char_length(btrim(title)) between 3 and 120),
  description text not null default '' check(char_length(description)<=5000),
  due_at timestamptz, created_at timestamptz not null default now(), unique(organization_id,id),
  foreign key(organization_id,event_id) references public.events(organization_id,id)
);
create table public.task_assignments (
  organization_id uuid not null, task_id uuid not null, membership_id uuid not null,
  assigned_at timestamptz not null default now(), completed_at timestamptz,
  primary key(task_id,membership_id),
  foreign key(organization_id,task_id) references public.volunteer_tasks(organization_id,id),
  foreign key(organization_id,membership_id) references public.organization_memberships(organization_id,id)
);
create function private.create_task(p_org uuid,p_event uuid,p_title text,p_description text,p_due timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_module(p_org,'volunteers','task.manage');
  insert into public.volunteer_tasks(organization_id,event_id,title,description,due_at) values(p_org,p_event,p_title,p_description,p_due) returning id into v_id;
  return v_id;
end;
$$;
create function private.assign_task(p_org uuid,p_task uuid,p_membership uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_module(p_org,'volunteers','task.manage');
  if not exists(select 1 from public.organization_memberships where id=p_membership and organization_id=p_org and status='active') then
    raise exception 'active member not found' using errcode='CS404'; end if;
  insert into public.task_assignments(organization_id,task_id,membership_id) values(p_org,p_task,p_membership) on conflict do nothing;
end;
$$;
create function private.complete_task(p_org uuid,p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_module(p_org,'volunteers');
  update public.task_assignments set completed_at=coalesce(completed_at,now()) where organization_id=p_org and task_id=p_task
    and membership_id in (select id from public.organization_memberships where organization_id=p_org and user_id=auth.uid() and status='active');
  if not found then raise exception 'assigned task not found' using errcode='CS404'; end if;
end;
$$;
alter table public.volunteer_tasks enable row level security;
alter table public.task_assignments enable row level security;
revoke all on public.volunteer_tasks,public.task_assignments from public,anon,authenticated;
grant select on public.volunteer_tasks,public.task_assignments to authenticated;
create policy tasks_read on public.volunteer_tasks for select to authenticated using(private.module_enabled(organization_id,'volunteers'));
create policy assignments_read on public.task_assignments for select to authenticated using(private.module_enabled(organization_id,'volunteers') and
  (private.has_org_permission(organization_id,'task.manage') or membership_id in (select id from public.organization_memberships where user_id=auth.uid())));
create trigger volunteer_tasks_audit after insert or update or delete on public.volunteer_tasks for each row execute function private.audit_row_change('task');
create trigger task_assignments_audit after insert or update or delete on public.task_assignments for each row execute function private.audit_row_change('assignment','task_id','membership_id');
create index tasks_org_idx on public.volunteer_tasks(organization_id);
create index assignments_org_idx on public.task_assignments(organization_id,membership_id);
revoke all on function private.create_task(uuid,uuid,text,text,timestamptz),private.assign_task(uuid,uuid,uuid),private.complete_task(uuid,uuid) from public,anon,authenticated;
grant execute on function private.create_task(uuid,uuid,text,text,timestamptz),private.assign_task(uuid,uuid,uuid),private.complete_task(uuid,uuid) to authenticated;
