-- =============================================================================
-- 0300 Identity: profiles and platform administrators
--
-- auth.users is owned by Supabase Auth. ClubSphere never stores passwords or
-- tokens; it keys everything on the stable auth user UUID.
-- =============================================================================

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  -- Copy of the Auth email, maintained by trigger and not writable by users.
  -- Eligibility checks read auth.users directly, never this column.
  email        text,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 100),
  constraint profiles_avatar_url_https    check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500))
);

comment on table public.profiles is
  'Organization-independent profile, one per auth user. Created by trigger on auth.users.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Profile provisioning. Runs inside the Auth signup transaction, so a profile
-- always exists for every auth user. Signing up creates a profile only; it
-- never creates memberships or grants any role.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := left(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1),
    ''
  )), 100);

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, case when v_name = '' then 'Member' else v_name end);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.sync_auth_user_email();

-- -----------------------------------------------------------------------------
-- Platform administrators: authority over ClubSphere itself (creating and
-- suspending organizations). Kept in its own table so that no organization
-- role can ever imply platform authority. Rows are written only by the
-- service role or a migration; there is no API write path.
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  note       text,

  constraint platform_admins_note_length check (note is null or char_length(note) <= 200)
);

create trigger platform_admins_audit
  after insert or update or delete on public.platform_admins
  for each row execute function private.audit_row_change('platform_admin', 'user_id');
