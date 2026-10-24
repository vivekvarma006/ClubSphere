-- =============================================================================
-- One-time bootstrap: make the first platform admin and create the first club.
--
-- Run in the Supabase SQL editor (as postgres) AFTER the people involved have
-- signed up through the app, so their auth users and profiles exist.
-- Replace the placeholders (REPLACE_...). Nothing club-specific lives in the
-- code; this is where the first club's identity is entered.
--
-- Tested by test/db/bootstrap.test.ts.
-- =============================================================================

begin;

-- Look the people up while still running as postgres (API roles cannot read
-- auth.users), and stop with a clear message if either has not signed up.
select set_config('bootstrap.admin_id', coalesce((select id::text from auth.users where email = 'REPLACE_platform_admin@example.com'), ''), true),
       set_config('bootstrap.owner_id', coalesce((select id::text from auth.users where email = 'REPLACE_owner@example.com'), ''), true);

do $$
begin
  if current_setting('bootstrap.admin_id') = '' then
    raise exception 'platform admin has not signed up yet';
  end if;
  if current_setting('bootstrap.owner_id') = '' then
    raise exception 'organization owner has not signed up yet';
  end if;
end $$;

-- 1. Platform admin: may create and suspend organizations. Grants NO
--    authority inside any organization.
insert into public.platform_admins (user_id, note)
values (current_setting('bootstrap.admin_id')::uuid, 'initial platform admin')
on conflict (user_id) do nothing;

-- 2. Act as that admin (create_organization checks auth.uid()) and create the
--    first organization with its first owner (may be the same person).
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('bootstrap.admin_id'), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

select private.create_organization(
  'REPLACE-club-slug',                 -- 3-50 chars: a-z, 0-9, single hyphens
  'REPLACE Club Name',
  current_setting('bootstrap.owner_id')::uuid
);

commit;

-- Afterwards the owner configures the club from the app (Phase 2) or in SQL, e.g.
--   update public.organizations set branding = '{"shortName": "..."}' where slug = '...';
--   insert into public.organization_email_domains (organization_id, domain) values (...);
--   insert into public.organization_profile_fields (organization_id, field_key, label, field_type, is_required) values (...);
