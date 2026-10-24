-- Minimal stand-in for the parts of a Supabase database that ClubSphere's
-- migrations rely on, so they can be tested on PGlite without Docker.
--
-- Mirrors Supabase behaviour that matters for security tests:
--   * API roles anon / authenticated / service_role (service_role bypasses RLS)
--   * auth.uid() reads the verified JWT "sub" claim from request.jwt.claims
--   * default privileges grant API roles ALL on new public tables, which is
--     why 0800_rls_and_grants.sql must revoke before granting
--
-- Not a full replica: real GoTrue tables have many more columns.

create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  is_anonymous       boolean not null default false,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
