-- =============================================================================
-- 1000 Role templates
--
-- Default roles become data instead of code. Every new organization gets one
-- system role per row in role_templates, with the permissions listed in
-- role_template_permissions (or every permission, for templates with
-- grants_all = true, i.e. owner).
--
-- Module migrations call private.register_permission(...) to add a
-- permission, give it to the right default roles, and backfill existing
-- organizations, all in one statement.
-- =============================================================================

-- Note on function privileges: 0100's per-schema ALTER DEFAULT PRIVILEGES
-- cannot take away the global default (EXECUTE for PUBLIC), because
-- per-schema defaults only ADD to global ones. A global revoke is not used
-- either: it would also strip EXECUTE from extension functions (pgvector's
-- operators) created later. Instead every migration that creates functions
-- ends with an explicit REVOKE, and test/db/migrations.test.ts fails if any
-- private function is executable by anon or outside the allow-list.

create table public.role_templates (
  role_key    text primary key,
  name        text not null,
  description text not null,
  is_default  boolean not null default false,  -- given to newly approved members
  grants_all  boolean not null default false,  -- receives every permission
  position    smallint not null default 0,

  constraint role_templates_key_format check (role_key ~ '^[a-z][a-z0-9_]{1,39}$')
);

create unique index role_templates_one_default_idx on public.role_templates (is_default) where is_default;

create table public.role_template_permissions (
  role_key       text not null references public.role_templates (role_key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.role_templates (role_key, name, description, is_default, grants_all, position) values
  ('owner',     'Owner',     'Full control of the organization',         false, true,  0),
  ('officer',   'Officer',   'Runs membership, events and operations',   false, false, 1),
  ('volunteer', 'Volunteer', 'Helps at events (QR scanning)',            false, false, 2),
  ('member',    'Member',    'Approved member',                          true,  false, 3);

insert into public.role_template_permissions (role_key, permission_key) values
  ('officer', 'member.read'),
  ('officer', 'membership.review'),
  ('officer', 'membership.suspend'),
  ('officer', 'analytics.read');

-- Replaces the hard-coded version from 0500.
create or replace function private.seed_default_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_roles (organization_id, role_key, name, description, is_system, is_default)
  select new.id, t.role_key, t.name, t.description, true, t.is_default
    from public.role_templates t;

  insert into public.role_permissions (organization_id, role_id, permission_key)
  select new.id, r.id, p.key
    from public.organization_roles r
    join public.role_templates t on t.role_key = r.role_key
    join public.permissions p
      on t.grants_all
      or exists (select 1 from public.role_template_permissions tp
                  where tp.role_key = t.role_key and tp.permission_key = p.key)
   where r.organization_id = new.id;

  return null;
end;
$$;

-- Backfill the new volunteer role into organizations created before this migration.
insert into public.organization_roles (organization_id, role_key, name, description, is_system)
select o.id, 'volunteer', 'Volunteer', 'Helps at events (QR scanning)', true
  from public.organizations o
on conflict (organization_id, role_key) do nothing;

-- -----------------------------------------------------------------------------
-- Migration helper (not callable through the API).
-- -----------------------------------------------------------------------------
create or replace function private.register_permission(p_key text, p_description text, p_default_roles text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.permissions (key, description) values (p_key, p_description)
  on conflict (key) do update set description = excluded.description;

  insert into public.role_template_permissions (role_key, permission_key)
  select t.role_key, p_key from public.role_templates t where t.role_key = any (p_default_roles)
  on conflict do nothing;

  -- Existing organizations: every grants_all role (owner) plus the named system roles.
  insert into public.role_permissions (organization_id, role_id, permission_key)
  select r.organization_id, r.id, p_key
    from public.organization_roles r
    join public.role_templates t on t.role_key = r.role_key
   where r.is_system and (t.grants_all or r.role_key = any (p_default_roles))
  on conflict do nothing;
end;
$$;

-- Read-only reference data for the settings screens.
revoke all on public.role_templates, public.role_template_permissions from anon, authenticated;
alter table public.role_templates enable row level security;
alter table public.role_template_permissions enable row level security;
grant select on public.role_templates, public.role_template_permissions to authenticated;
create policy role_templates_select on public.role_templates for select to authenticated using (true);
create policy role_template_permissions_select on public.role_template_permissions for select to authenticated using (true);

revoke all on all functions in schema private from public, anon;
revoke all on function private.register_permission(text, text, text[]) from authenticated;
