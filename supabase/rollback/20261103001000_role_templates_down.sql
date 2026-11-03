-- Rollback for 20261103001000_role_templates.sql (development only).
-- Restores the hard-coded default-role seeding from 0500.

drop function if exists private.register_permission(text, text, text[]);

create or replace function private.seed_default_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_officer uuid;
begin
  insert into public.organization_roles (organization_id, role_key, name, description, is_system)
  values (new.id, 'owner', 'Owner', 'Full control of the organization', true)
  returning id into v_owner;

  insert into public.organization_roles (organization_id, role_key, name, description, is_system)
  values (new.id, 'officer', 'Officer', 'Reviews membership and manages members', true)
  returning id into v_officer;

  insert into public.organization_roles (organization_id, role_key, name, description, is_system, is_default)
  values (new.id, 'member', 'Member', 'Approved member', true, true);

  insert into public.role_permissions (organization_id, role_id, permission_key)
  select new.id, v_owner, p.key from public.permissions p;

  insert into public.role_permissions (organization_id, role_id, permission_key)
  select new.id, v_officer, k
  from unnest(array['member.read', 'membership.review', 'membership.suspend', 'analytics.read']) as k;

  return null;
end;
$$;

delete from public.organization_roles where role_key = 'volunteer' and is_system;
drop table if exists public.role_template_permissions;
drop table if exists public.role_templates;
