-- =============================================================================
-- 0800 Row level security and privileges
--
-- Two independent layers decide what an API role may touch:
--   GRANTs  - which tables/columns a role may use at all
--   RLS     - which ROWS of those tables it may see or change
--
-- Supabase grants ALL on new public tables to anon and authenticated by
-- default, so this migration first revokes everything and then grants back
-- only what each table needs. anon (not signed in) gets nothing.
--
-- Membership tables have SELECT policies only: their writes happen inside
-- the security-definer procedures in 0700.
-- =============================================================================

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.profiles                    enable row level security;
alter table public.platform_admins             enable row level security;
alter table public.organizations               enable row level security;
alter table public.organization_email_domains  enable row level security;
alter table public.organization_profile_fields enable row level security;
alter table public.permissions                 enable row level security;
alter table public.organization_roles          enable row level security;
alter table public.role_permissions            enable row level security;
alter table public.membership_requests         enable row level security;
alter table public.organization_memberships    enable row level security;
alter table public.membership_roles            enable row level security;
alter table public.audit_logs                  enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.can_view_profile(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- platform_admins: you can see only whether YOU are one
-- -----------------------------------------------------------------------------
grant select on public.platform_admins to authenticated;

create policy platform_admins_select_own on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- organizations: active ones are listed for onboarding; status and slug
-- are not updatable through the API (platform procedures only)
-- -----------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant update (name, onboarding_policy, branding, settings) on public.organizations to authenticated;

create policy organizations_select on public.organizations
  for select to authenticated
  using (status = 'active' or private.is_active_member(id) or private.is_platform_admin());

create policy organizations_update on public.organizations
  for update to authenticated
  using (private.has_org_permission(id, 'org.settings.manage'))
  with check (private.has_org_permission(id, 'org.settings.manage'));

-- -----------------------------------------------------------------------------
-- organization configuration tables
-- -----------------------------------------------------------------------------
grant select, insert, delete on public.organization_email_domains to authenticated;

create policy organization_email_domains_select on public.organization_email_domains
  for select to authenticated
  using (exists (select 1 from public.organizations o where o.id = organization_id));

create policy organization_email_domains_insert on public.organization_email_domains
  for insert to authenticated
  with check (private.has_org_permission(organization_id, 'org.settings.manage'));

create policy organization_email_domains_delete on public.organization_email_domains
  for delete to authenticated
  using (private.has_org_permission(organization_id, 'org.settings.manage'));

grant select, insert, delete on public.organization_profile_fields to authenticated;
grant update (label, field_type, is_required, options, position) on public.organization_profile_fields to authenticated;

create policy organization_profile_fields_select on public.organization_profile_fields
  for select to authenticated
  using (exists (select 1 from public.organizations o where o.id = organization_id));

create policy organization_profile_fields_insert on public.organization_profile_fields
  for insert to authenticated
  with check (private.has_org_permission(organization_id, 'org.settings.manage'));

create policy organization_profile_fields_update on public.organization_profile_fields
  for update to authenticated
  using (private.has_org_permission(organization_id, 'org.settings.manage'))
  with check (private.has_org_permission(organization_id, 'org.settings.manage'));

create policy organization_profile_fields_delete on public.organization_profile_fields
  for delete to authenticated
  using (private.has_org_permission(organization_id, 'org.settings.manage'));

-- -----------------------------------------------------------------------------
-- RBAC tables
-- -----------------------------------------------------------------------------
grant select on public.permissions to authenticated;

create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

-- is_system and is_default are not insertable/updatable through the API.
grant select, delete on public.organization_roles to authenticated;
grant insert (organization_id, role_key, name, description) on public.organization_roles to authenticated;
grant update (name, description) on public.organization_roles to authenticated;

create policy organization_roles_select on public.organization_roles
  for select to authenticated
  using (private.is_active_member(organization_id));

create policy organization_roles_insert on public.organization_roles
  for insert to authenticated
  with check (private.has_org_permission(organization_id, 'role.manage'));

create policy organization_roles_update on public.organization_roles
  for update to authenticated
  using (private.has_org_permission(organization_id, 'role.manage'))
  with check (private.has_org_permission(organization_id, 'role.manage'));

create policy organization_roles_delete on public.organization_roles
  for delete to authenticated
  using (private.has_org_permission(organization_id, 'role.manage') and not is_system);

-- Granting or removing a permission on a role requires role.manage AND
-- holding that permission yourself, and the owner role cannot be edited.
-- This is what stops "give my own role every permission" escalation.
grant select, insert, delete on public.role_permissions to authenticated;

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (private.is_active_member(organization_id));

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    private.has_org_permission(organization_id, 'role.manage')
    and private.has_org_permission(organization_id, permission_key)
    and not private.is_owner_role(role_id)
  );

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    private.has_org_permission(organization_id, 'role.manage')
    and private.has_org_permission(organization_id, permission_key)
    and not private.is_owner_role(role_id)
  );

-- -----------------------------------------------------------------------------
-- Membership tables: read-only through the API
-- -----------------------------------------------------------------------------
grant select on public.membership_requests      to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.membership_roles         to authenticated;

create policy membership_requests_select on public.membership_requests
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_org_permission(organization_id, 'membership.review'));

create policy organization_memberships_select on public.organization_memberships
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_org_permission(organization_id, 'member.read'));

create policy membership_roles_select on public.membership_roles
  for select to authenticated
  using (private.has_org_permission(organization_id, 'member.read')
         or exists (select 1 from public.organization_memberships m
                     where m.id = membership_id and m.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- audit_logs: read-only, and only with audit.read (or platform admin)
-- -----------------------------------------------------------------------------
grant select on public.audit_logs to authenticated;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using ((organization_id is not null and private.has_org_permission(organization_id, 'audit.read'))
         or private.is_platform_admin());

-- -----------------------------------------------------------------------------
-- Function privileges: nothing by default, then exactly what is needed
-- -----------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function
  -- used inside RLS policies, which run as the caller
  private.has_org_permission(uuid, text),
  private.my_org_permissions(uuid),
  private.is_active_member(uuid),
  private.is_platform_admin(),
  private.can_view_profile(uuid),
  private.is_owner_role(uuid),
  -- procedures (each performs its own authorization)
  private.create_organization(text, text, uuid),
  private.set_organization_status(uuid, text),
  private.request_membership(text, jsonb),
  private.withdraw_membership_request(uuid),
  private.approve_membership_request(uuid),
  private.reject_membership_request(uuid, text),
  private.suspend_membership(uuid, text),
  private.reinstate_membership(uuid),
  private.assign_role(uuid, uuid),
  private.revoke_role(uuid, uuid)
to authenticated;
