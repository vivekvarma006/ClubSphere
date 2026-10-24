-- =============================================================================
-- 0700 Authorization helpers and membership procedures
--
-- All membership and role changes go through these SECURITY DEFINER
-- procedures. API roles have no INSERT/UPDATE/DELETE policies on the
-- membership tables, so there is no other write path.
--
-- Every procedure follows the same order:
--   1. resolve the actor from the verified session      (private.require_actor)
--   2. resolve the organization from the TARGET ROW, never from a
--      client-supplied organization id
--   3. lock the organization row                         (serializes changes)
--   4. check the actor's permission in that organization
--   5. lock and validate the target row
--   6. write; audit rows are added by triggers in the same transaction
--
-- Concurrency: step 3 makes authorization-changing operations within one
-- organization run one at a time. Without it, two owners suspending each
-- other at the same moment could both pass the "another owner remains"
-- check and leave the organization with no owner (write skew).
--
-- Disclosure: when the actor lacks permission, procedures report "not
-- found" rather than "forbidden", so officers of one club cannot probe for
-- the existence of another club's requests or members.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers used by RLS policies and the application (granted in 0800)
-- -----------------------------------------------------------------------------

create or replace function private.has_org_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_memberships m
      join public.organizations o     on o.id = m.organization_id
      join public.membership_roles mr on mr.membership_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
     where m.organization_id = p_org_id
       and m.user_id = (select auth.uid())
       and m.status = 'active'
       and o.status = 'active'
       and rp.permission_key = p_permission
  );
$$;

create or replace function private.my_org_permissions(p_org_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.permission_key order by rp.permission_key), '{}'::text[])
    from public.organization_memberships m
    join public.organizations o     on o.id = m.organization_id
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.organization_id = p_org_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
     and o.status = 'active';
$$;

create or replace function private.is_active_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_memberships m
     where m.organization_id = p_org_id
       and m.user_id = (select auth.uid())
       and m.status = 'active'
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- A profile is visible to people who have a reason to see it: officers with
-- member.read where the person is a member, and reviewers where the person
-- has applied.
create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.organization_memberships m
            where m.user_id = p_profile_id
              and private.has_org_permission(m.organization_id, 'member.read'))
      or exists (
           select 1 from public.membership_requests r
            where r.user_id = p_profile_id
              and private.has_org_permission(r.organization_id, 'membership.review'));
$$;

create or replace function private.is_owner_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_roles
     where id = p_role_id and role_key = 'owner' and is_system
  );
$$;

-- -----------------------------------------------------------------------------
-- Internal helpers (NOT granted to API roles)
-- -----------------------------------------------------------------------------

create or replace function private.require_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
       select 1 from auth.users u
        where u.id = v_actor and not coalesce(u.is_anonymous, false)) then
    raise exception 'authentication required' using errcode = 'CS401';
  end if;
  return v_actor;
end;
$$;

create or replace function private.role_permission_keys(p_role_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(permission_key), '{}'::text[])
    from public.role_permissions where role_id = p_role_id;
$$;

create or replace function private.membership_permission_keys(p_membership_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.permission_key), '{}'::text[])
    from public.membership_roles mr
    join public.role_permissions rp on rp.role_id = mr.role_id
   where mr.membership_id = p_membership_id;
$$;

-- Locks the organization row (SELECT ... FOR UPDATE). Concurrent callers for
-- the same organization queue here until the holder commits or rolls back.
create or replace function private.lock_organization(p_org_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.organizations where id = p_org_id for update;
  if not found then
    raise exception 'organization not found' using errcode = 'CS404';
  end if;
end;
$$;

create or replace function private.assert_keeps_an_owner(p_org_id uuid, p_leaving_membership_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (
       select 1 from public.membership_roles mr
        where mr.membership_id = p_leaving_membership_id
          and private.is_owner_role(mr.role_id))
     and not exists (
       select 1
         from public.organization_memberships m
         join public.membership_roles mr on mr.membership_id = m.id
        where m.organization_id = p_org_id
          and m.id <> p_leaving_membership_id
          and m.status = 'active'
          and private.is_owner_role(mr.role_id)) then
    raise exception 'an organization must keep at least one active owner' using errcode = 'CS409';
  end if;
end;
$$;

-- Validates request answers against the organization's profile questions.
-- This is the database-level backstop; the application validates the same
-- rules with Zod first to give friendlier messages.
create or replace function private.validate_profile_answers(p_org_id uuid, p_answers jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  f         public.organization_profile_fields;
  v         jsonb;
  v_text    text;
  v_max_len int;
  v_unknown text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be a JSON object' using errcode = 'CS422';
  end if;

  select k into v_unknown
    from jsonb_object_keys(p_answers) as k
   where not exists (
           select 1 from public.organization_profile_fields pf
            where pf.organization_id = p_org_id and pf.field_key = k)
   limit 1;
  if v_unknown is not null then
    raise exception 'unknown profile field "%"', left(v_unknown, 40) using errcode = 'CS422';
  end if;

  for f in
    select * from public.organization_profile_fields where organization_id = p_org_id order by position
  loop
    v := p_answers -> f.field_key;

    if v is null or jsonb_typeof(v) = 'null'
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if f.is_required then
        raise exception 'profile field "%" is required', f.field_key using errcode = 'CS422';
      end if;
      continue;
    end if;

    if f.field_type = 'number' then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'profile field "%" must be a number', f.field_key using errcode = 'CS422';
      end if;
    elsif f.field_type = 'select' then
      if jsonb_typeof(v) <> 'string' or not (f.options @> jsonb_build_array(v)) then
        raise exception 'profile field "%" must be one of the listed options', f.field_key using errcode = 'CS422';
      end if;
    else
      if jsonb_typeof(v) <> 'string' then
        raise exception 'profile field "%" must be text', f.field_key using errcode = 'CS422';
      end if;
      v_text := v #>> '{}';
      v_max_len := case f.field_type when 'long_text' then 2000 when 'url' then 500 else 200 end;
      if char_length(v_text) > v_max_len then
        raise exception 'profile field "%" is too long', f.field_key using errcode = 'CS422';
      end if;
      if f.field_type = 'url' and v_text !~ '^https?://[^[:space:]]+$' then
        raise exception 'profile field "%" must be a web address', f.field_key using errcode = 'CS422';
      end if;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Platform procedures
-- -----------------------------------------------------------------------------

create or replace function private.create_organization(p_slug text, p_name text, p_owner_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         uuid := private.require_actor();
  v_org_id        uuid;
  v_owner_role    uuid;
  v_membership_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'platform administrator required' using errcode = 'CS403';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner_user_id) then
    raise exception 'owner profile not found' using errcode = 'CS404';
  end if;

  insert into public.organizations (slug, name, created_by)
  values (p_slug, p_name, v_actor)
  returning id into v_org_id;              -- trigger seeds owner/officer/member roles

  select id into v_owner_role
    from public.organization_roles
   where organization_id = v_org_id and role_key = 'owner';

  insert into public.organization_memberships (organization_id, user_id)
  values (v_org_id, p_owner_user_id)
  returning id into v_membership_id;

  insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
  values (v_org_id, v_membership_id, v_owner_role, v_actor);

  return v_org_id;
end;
$$;

create or replace function private.set_organization_status(p_org_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  if not private.is_platform_admin() then
    raise exception 'platform administrator required' using errcode = 'CS403';
  end if;
  perform private.lock_organization(p_org_id);
  update public.organizations set status = p_status where id = p_org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Membership requests
-- -----------------------------------------------------------------------------

-- Returns the id of the caller's pending request. Idempotent: retries,
-- double-clicks and concurrent duplicates all return the same request.
create or replace function private.request_membership(p_org_slug text, p_answers jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := private.require_actor();
  v_answers    jsonb := coalesce(p_answers, '{}'::jsonb);
  v_org        public.organizations;
  v_email      text;
  v_confirmed  timestamptz;
  v_domain     text;
  v_request_id uuid;
begin
  select * into v_org from public.organizations where slug = p_org_slug;
  if not found or v_org.status <> 'active' then
    raise exception 'organization not found' using errcode = 'CS404';
  end if;
  if v_org.onboarding_policy <> 'approval_required' then
    raise exception 'this organization is not accepting membership requests' using errcode = 'CS403';
  end if;

  -- Eligibility is decided from Supabase Auth's record, not from anything
  -- the user can edit.
  select u.email, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = v_actor;
  if v_confirmed is null then
    raise exception 'verify your email address before requesting membership' using errcode = 'CS403';
  end if;

  v_domain := lower(substring(v_email from '@([^@]+)$'));
  if exists (select 1 from public.organization_email_domains d where d.organization_id = v_org.id)
     and not exists (select 1 from public.organization_email_domains d
                      where d.organization_id = v_org.id and d.domain = v_domain) then
    raise exception 'your email domain is not eligible for this organization' using errcode = 'CS403';
  end if;

  if exists (select 1 from public.organization_memberships m
              where m.organization_id = v_org.id and m.user_id = v_actor) then
    raise exception 'you are already a member of this organization' using errcode = 'CS409';
  end if;

  perform private.validate_profile_answers(v_org.id, v_answers);

  select id into v_request_id
    from public.membership_requests
   where organization_id = v_org.id and user_id = v_actor and status = 'pending';
  if found then
    return v_request_id;
  end if;

  begin
    insert into public.membership_requests (organization_id, user_id, answers)
    values (v_org.id, v_actor, v_answers)
    returning id into v_request_id;
  exception when unique_violation then
    -- A concurrent submission committed first; the partial unique index
    -- rejected ours. Return the winner instead of creating a duplicate.
    select id into v_request_id
      from public.membership_requests
     where organization_id = v_org.id and user_id = v_actor and status = 'pending';
  end;

  return v_request_id;
end;
$$;

create or replace function private.withdraw_membership_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_actor();
begin
  update public.membership_requests
     set status = 'withdrawn', withdrawn_at = now()
   where id = p_request_id and user_id = v_actor and status = 'pending';

  if not found then
    if exists (select 1 from public.membership_requests where id = p_request_id and user_id = v_actor) then
      raise exception 'membership request is no longer pending' using errcode = 'CS409';
    end if;
    raise exception 'membership request not found' using errcode = 'CS404';
  end if;
end;
$$;

-- Returns the new membership id.
create or replace function private.approve_membership_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         uuid := private.require_actor();
  v_org_id        uuid;
  v_req           public.membership_requests;
  v_default_role  uuid;
  v_membership_id uuid;
begin
  select organization_id into v_org_id from public.membership_requests where id = p_request_id;
  if v_org_id is null then
    raise exception 'membership request not found' using errcode = 'CS404';
  end if;

  perform private.lock_organization(v_org_id);

  if not private.has_org_permission(v_org_id, 'membership.review') then
    raise exception 'membership request not found' using errcode = 'CS404';
  end if;

  -- Row lock: a second reviewer approving or rejecting the same request
  -- waits here, then re-reads the row and sees it is no longer pending.
  select * into v_req from public.membership_requests where id = p_request_id for update;

  if v_req.user_id = v_actor then
    raise exception 'you cannot review your own membership request' using errcode = 'CS403';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'membership request has already been %', v_req.status using errcode = 'CS409';
  end if;

  select id into v_default_role
    from public.organization_roles
   where organization_id = v_org_id and is_default;
  if v_default_role is null then
    raise exception 'organization has no default role configured' using errcode = 'CS409';
  end if;

  begin
    insert into public.organization_memberships (organization_id, user_id, source_request_id)
    values (v_org_id, v_req.user_id, v_req.id)
    returning id into v_membership_id;
  exception when unique_violation then
    raise exception 'applicant is already a member of this organization' using errcode = 'CS409';
  end;

  insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
  values (v_org_id, v_membership_id, v_default_role, v_actor);

  update public.membership_requests
     set status = 'approved', reviewed_at = now(), reviewed_by = v_actor
   where id = p_request_id;

  return v_membership_id;
end;
$$;

create or replace function private.reject_membership_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.require_actor();
  v_org_id uuid;
  v_req    public.membership_requests;
begin
  select organization_id into v_org_id from public.membership_requests where id = p_request_id;
  if v_org_id is null then
    raise exception 'membership request not found' using errcode = 'CS404';
  end if;

  perform private.lock_organization(v_org_id);

  if not private.has_org_permission(v_org_id, 'membership.review') then
    raise exception 'membership request not found' using errcode = 'CS404';
  end if;

  select * into v_req from public.membership_requests where id = p_request_id for update;

  if v_req.user_id = v_actor then
    raise exception 'you cannot review your own membership request' using errcode = 'CS403';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'membership request has already been %', v_req.status using errcode = 'CS409';
  end if;

  update public.membership_requests
     set status = 'rejected', reviewed_at = now(), reviewed_by = v_actor,
         rejection_reason = nullif(btrim(p_reason), '')
   where id = p_request_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Suspension
--
-- Rank rule: you may only act on someone whose every permission you also
-- hold. An officer therefore cannot suspend an owner, and nobody can use a
-- suspension to remove a peer with more authority.
-- -----------------------------------------------------------------------------

create or replace function private.suspend_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.require_actor();
  v_org_id uuid;
  v_m      public.organization_memberships;
begin
  select organization_id into v_org_id from public.organization_memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  perform private.lock_organization(v_org_id);

  if not private.has_org_permission(v_org_id, 'membership.suspend') then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  select * into v_m from public.organization_memberships where id = p_membership_id for update;

  if v_m.user_id = v_actor then
    raise exception 'you cannot suspend your own membership' using errcode = 'CS403';
  end if;
  if v_m.status <> 'active' then
    raise exception 'membership is not active' using errcode = 'CS409';
  end if;
  if not (private.membership_permission_keys(p_membership_id) <@ private.my_org_permissions(v_org_id)) then
    raise exception 'you cannot suspend a member who holds permissions you do not have' using errcode = 'CS403';
  end if;

  perform private.assert_keeps_an_owner(v_org_id, p_membership_id);

  update public.organization_memberships
     set status = 'suspended', suspended_at = now(), suspended_by = v_actor,
         suspension_reason = nullif(btrim(p_reason), '')
   where id = p_membership_id;
end;
$$;

create or replace function private.reinstate_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.require_actor();
  v_org_id uuid;
  v_m      public.organization_memberships;
begin
  select organization_id into v_org_id from public.organization_memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  perform private.lock_organization(v_org_id);

  if not private.has_org_permission(v_org_id, 'membership.suspend') then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  select * into v_m from public.organization_memberships where id = p_membership_id for update;

  if v_m.user_id = v_actor then
    raise exception 'you cannot reinstate your own membership' using errcode = 'CS403';
  end if;
  if v_m.status <> 'suspended' then
    raise exception 'membership is not suspended' using errcode = 'CS409';
  end if;
  if not (private.membership_permission_keys(p_membership_id) <@ private.my_org_permissions(v_org_id)) then
    raise exception 'you cannot reinstate a member who holds permissions you do not have' using errcode = 'CS403';
  end if;

  update public.organization_memberships
     set status = 'active', suspended_at = null, suspended_by = null, suspension_reason = null
   where id = p_membership_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Role assignment
--
-- Escalation rule: you can only hand out (or take away) a role whose every
-- permission you hold yourself. Privilege can flow down, never up.
-- -----------------------------------------------------------------------------

create or replace function private.assign_role(p_membership_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.require_actor();
  v_org_id uuid;
  v_m      public.organization_memberships;
begin
  select organization_id into v_org_id from public.organization_memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  perform private.lock_organization(v_org_id);

  if not private.has_org_permission(v_org_id, 'role.assign') then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  select * into v_m from public.organization_memberships where id = p_membership_id for update;
  if v_m.status <> 'active' then
    raise exception 'roles can only be assigned to active members' using errcode = 'CS409';
  end if;

  -- The role must belong to the same organization (the composite FK would
  -- also reject it, but this gives a clear error).
  if not exists (select 1 from public.organization_roles where id = p_role_id and organization_id = v_org_id) then
    raise exception 'role not found' using errcode = 'CS404';
  end if;
  if not (private.role_permission_keys(p_role_id) <@ private.my_org_permissions(v_org_id)) then
    raise exception 'you cannot assign a role that carries permissions you do not have' using errcode = 'CS403';
  end if;

  insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
  values (v_org_id, p_membership_id, p_role_id, v_actor)
  on conflict (membership_id, role_id) do nothing;
end;
$$;

create or replace function private.revoke_role(p_membership_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.require_actor();
  v_org_id uuid;
begin
  select organization_id into v_org_id from public.organization_memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;

  perform private.lock_organization(v_org_id);

  if not private.has_org_permission(v_org_id, 'role.assign') then
    raise exception 'membership not found' using errcode = 'CS404';
  end if;
  if not exists (select 1 from public.organization_roles where id = p_role_id and organization_id = v_org_id) then
    raise exception 'role not found' using errcode = 'CS404';
  end if;
  if not (private.role_permission_keys(p_role_id) <@ private.my_org_permissions(v_org_id)) then
    raise exception 'you cannot remove a role that carries permissions you do not have' using errcode = 'CS403';
  end if;

  if private.is_owner_role(p_role_id) then
    perform private.assert_keeps_an_owner(v_org_id, p_membership_id);
  end if;

  delete from public.membership_roles
   where membership_id = p_membership_id and role_id = p_role_id;
end;
$$;
