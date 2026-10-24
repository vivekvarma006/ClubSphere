-- =============================================================================
-- 0500 Roles and permissions (organization-scoped RBAC)
--
--   permissions        global catalog of capability keys (code-defined)
--   organization_roles roles that belong to ONE organization
--   role_permissions   which capabilities each role carries
--
-- Authorization code checks permissions, never role names, so a club can
-- rename roles or define its own without code changes.
--
-- Tenant consistency: role_permissions carries organization_id and uses a
-- composite foreign key (organization_id, role_id) so a row can never point
-- at a role that belongs to a different organization.
-- =============================================================================

create table public.permissions (
  key         text primary key,
  description text not null,

  constraint permissions_key_format check (key ~ '^[a-z]+(\.[a-z_]+)+$')
);

comment on table public.permissions is
  'Capability catalog. Mirrored by PERMISSIONS in src/server/authz/permissions.ts (a test keeps them in sync).';

insert into public.permissions (key, description) values
  ('org.settings.manage', 'Edit organization name, branding, onboarding policy, email domains and profile questions'),
  ('member.read',         'View the member list and the profiles of members and applicants'),
  ('membership.review',   'Approve or reject membership requests'),
  ('membership.suspend',  'Suspend and reinstate members'),
  ('role.assign',         'Assign roles to and remove roles from members'),
  ('role.manage',         'Create custom roles and change which permissions a role carries'),
  ('audit.read',          'Read the organization audit log'),
  ('analytics.read',      'View organization reports');

create table public.organization_roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role_key        text not null,
  name            text not null,
  description     text,
  is_system       boolean not null default false,  -- seeded owner/officer/member; cannot be deleted via the API
  is_default      boolean not null default false,  -- given to newly approved members
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint organization_roles_key_unique  unique (organization_id, role_key),
  constraint organization_roles_org_id_key  unique (organization_id, id),   -- target of composite FKs
  constraint organization_roles_key_format  check (role_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint organization_roles_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint organization_roles_desc_length check (description is null or char_length(description) <= 300)
);

-- At most one default role per organization.
create unique index organization_roles_one_default_idx
  on public.organization_roles (organization_id)
  where is_default;

create trigger organization_roles_set_updated_at
  before update on public.organization_roles
  for each row execute function private.set_updated_at();

create trigger organization_roles_audit
  after insert or update or delete on public.organization_roles
  for each row execute function private.audit_row_change('role', 'role_key');

create table public.role_permissions (
  organization_id uuid not null,
  role_id         uuid not null,
  permission_key  text not null references public.permissions (key) on delete restrict,
  granted_at      timestamptz not null default now(),

  primary key (role_id, permission_key),
  constraint role_permissions_role_fk
    foreign key (organization_id, role_id)
    references public.organization_roles (organization_id, id)
    on delete cascade
);

create index role_permissions_org_idx on public.role_permissions (organization_id);

create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function private.audit_row_change('role_permission', 'role_id', 'permission_key');

-- -----------------------------------------------------------------------------
-- Every new organization starts with three system roles. Clubs can rename
-- them, change officer/member permissions, and add custom roles.
--   owner   - every permission (kept complete; see 0800 policies)
--   officer - day-to-day membership work and reports
--   member  - default role for approved members; no permissions in Phase 1
-- -----------------------------------------------------------------------------
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

create trigger organizations_seed_default_roles
  after insert on public.organizations
  for each row execute function private.seed_default_roles();
