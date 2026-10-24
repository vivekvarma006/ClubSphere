-- =============================================================================
-- 0100 Foundation helpers
--
-- Two schemas:
--   public  - tables. Reachable through the Supabase Data API, so every table
--             MUST have row level security enabled (enforced by a test).
--   private - security-definer functions and procedures. Not exposed through
--             the Data API. EXECUTE is granted function-by-function.
--
-- Error codes raised by ClubSphere procedures use the custom SQLSTATE class
-- "CS" so the application can map them without parsing messages:
--   CS401 not authenticated   CS403 forbidden   CS404 not found
--   CS409 state conflict      CS422 invalid input
-- =============================================================================

create schema if not exists private;

revoke all on schema private from public;
-- RLS policies are evaluated as the calling role, and several policies call
-- private helpers, so the API role needs USAGE (but not blanket EXECUTE).
grant usage on schema private to authenticated;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. ClubSphere
-- opts out and grants execute explicitly (see 0700_rls_and_grants.sql).
alter default privileges in schema private revoke execute on functions from public;

-- Keeps updated_at honest without trusting callers to set it.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
