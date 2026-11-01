-- Deleting a role cascades to its permissions AND membership assignments.
-- RLS on those child tables does not authorize foreign-key cascades, so
-- the parent policy must enforce both capabilities and the subset rule.
alter policy organization_roles_delete on public.organization_roles
  using (
    private.has_org_permission(organization_id, 'role.manage')
    and private.has_org_permission(organization_id, 'role.assign')
    and not is_system
    and not exists (
      select 1 from public.role_permissions rp
       where rp.role_id = organization_roles.id
         and not private.has_org_permission(rp.organization_id, rp.permission_key)
    )
  );
