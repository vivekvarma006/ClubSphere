-- SECURITY INVOKER wrappers preserve the established RLS and subset-grant rules.
create function private.save_club_settings(p_org uuid,p_name text,p_policy text,p_branding jsonb,p_settings jsonb,p_domains jsonb,p_fields jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='CS401'; end if;
  if not private.has_org_permission(p_org,'org.settings.manage') then raise exception 'organization not found' using errcode='CS404'; end if;
  update public.organizations set name=p_name,onboarding_policy=p_policy,branding=p_branding,settings=p_settings where id=p_org;
  delete from public.organization_email_domains where organization_id=p_org;
  insert into public.organization_email_domains(organization_id,domain) select p_org,value from jsonb_array_elements_text(p_domains);
  delete from public.organization_profile_fields where organization_id=p_org;
  insert into public.organization_profile_fields(organization_id,field_key,label,field_type,is_required,options,position)
  select p_org,f->>'key',f->>'label',f->>'type',coalesce((f->>'required')::boolean,false),f->'options',(n-1)::smallint
  from jsonb_array_elements(p_fields) with ordinality a(f,n);
end;
$$;
create function private.save_custom_role(p_org uuid,p_role uuid,p_key text,p_name text,p_permissions text[]) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid:=p_role;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='CS401'; end if;
  if not private.has_org_permission(p_org,'role.manage') then raise exception 'organization not found' using errcode='CS404'; end if;
  if v_id is null then
    insert into public.organization_roles(organization_id,role_key,name) values(p_org,p_key,p_name) returning id into v_id;
  else
    if not exists(select 1 from public.organization_roles where id=v_id and organization_id=p_org and not is_system) then
      raise exception 'custom role not found' using errcode='CS404'; end if;
    -- Reject a replacement that RLS would otherwise partially apply.
    if exists(select 1 from public.role_permissions where role_id=v_id and not private.has_org_permission(p_org,permission_key)) then
      raise exception 'role contains permissions you do not hold' using errcode='CS403'; end if;
    update public.organization_roles set name=p_name where id=v_id and organization_id=p_org;
    delete from public.role_permissions where role_id=v_id and organization_id=p_org;
  end if;
  insert into public.role_permissions(organization_id,role_id,permission_key) select p_org,v_id,unnest(p_permissions);
  return v_id;
end;
$$;
revoke all on function private.save_club_settings(uuid,text,text,jsonb,jsonb,jsonb,jsonb),private.save_custom_role(uuid,uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function private.save_club_settings(uuid,text,text,jsonb,jsonb,jsonb,jsonb),private.save_custom_role(uuid,uuid,text,text,text[]) to authenticated;
-- DELETE remains subject to the parent policy that checks cascading role assignments.
create function private.delete_custom_role(p_org uuid,p_role uuid) returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.organization_roles where id=p_role and organization_id=p_org and not is_system;
  if not found then raise exception 'role not found or cannot be deleted' using errcode='CS404'; end if;
end;
$$;
revoke all on function private.delete_custom_role(uuid,uuid) from public,anon,authenticated;
grant execute on function private.delete_custom_role(uuid,uuid) to authenticated;
