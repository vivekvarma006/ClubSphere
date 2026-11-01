-- =============================================================================
-- Rollback for migrations 20261024000100 .. 20261024000900 (Phase 1 foundation)
--
-- DESTROYS ALL CLUBSPHERE DATA. Intended for development databases and for
-- the reversibility test (test/db/migrations.test.ts). Production recovery
-- uses forward-fix migrations and point-in-time restore instead; see
-- docs/DEPLOYMENT.md.
--
-- Objects are dropped in reverse dependency order so no CASCADE is needed
-- for ClubSphere's own objects; an unexpected dependency fails loudly.
-- =============================================================================

drop view if exists public.report_monthly_applications;
drop view if exists public.report_role_distribution;
drop view if exists public.report_review_turnaround;
drop view if exists public.report_org_membership_summary;

drop trigger if exists on_auth_user_email_changed on auth.users;
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.membership_roles;
drop table if exists public.organization_memberships;
drop table if exists public.membership_requests;
-- The hardened role-delete policy reads role_permissions (20261102000100).
-- Remove that dependency before dropping the child table.
drop policy if exists organization_roles_delete on public.organization_roles;
drop table if exists public.role_permissions;
drop table if exists public.organization_roles;
drop table if exists public.permissions;
drop table if exists public.organization_profile_fields;
drop table if exists public.organization_email_domains;
drop table if exists public.organizations;
drop table if exists public.platform_admins;
drop table if exists public.profiles;

-- audit_logs refuses TRUNCATE/DELETE via triggers; DROP TABLE is not blocked.
drop table if exists public.audit_logs;

-- Every remaining object in private is a ClubSphere function.
drop schema if exists private cascade;
