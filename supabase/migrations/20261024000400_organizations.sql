-- =============================================================================
-- 0400 Organizations and their configuration
--
-- Everything that differs between clubs lives in these rows: name, slug,
-- branding, onboarding policy, eligible email domains and the profile
-- questions asked on joining. Adding a club is an INSERT, not a code change.
-- =============================================================================

create table public.organizations (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  name              text not null,
  status            text not null default 'active',
  -- 'approval_required' is the only policy that accepts requests today.
  -- 'invite_only' and 'closed' reject self-service requests.
  onboarding_policy text not null default 'approval_required',
  branding          jsonb not null default '{}'::jsonb,  -- validated by OrganizationBrandingSchema
  settings          jsonb not null default '{}'::jsonb,  -- validated by OrganizationSettingsSchema
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint organizations_slug_key           unique (slug),
  constraint organizations_slug_format        check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' and slug !~ '--'),
  constraint organizations_name_length        check (char_length(btrim(name)) between 2 and 120),
  constraint organizations_status_valid       check (status in ('active', 'suspended', 'archived')),
  constraint organizations_onboarding_valid   check (onboarding_policy in ('approval_required', 'invite_only', 'closed')),
  constraint organizations_branding_object    check (jsonb_typeof(branding) = 'object'),
  constraint organizations_settings_object    check (jsonb_typeof(settings) = 'object')
);

comment on column public.organizations.status is
  'suspended/archived organizations grant no permissions to anyone (see private.has_org_permission).';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function private.audit_row_change('organization');

-- -----------------------------------------------------------------------------
-- Optional email-domain eligibility. If an organization has no rows here,
-- any verified email may request membership. Matching is exact on the domain
-- of the VERIFIED auth email, and only decides who may ask to join. It never
-- grants a role.
-- -----------------------------------------------------------------------------
create table public.organization_email_domains (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  domain          text not null,
  created_at      timestamptz not null default now(),

  primary key (organization_id, domain),
  constraint organization_email_domains_format check (
    domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and char_length(domain) <= 253
  )
);

create trigger organization_email_domains_audit
  after insert or update or delete on public.organization_email_domains
  for each row execute function private.audit_row_change('organization_email_domain', 'domain');

-- -----------------------------------------------------------------------------
-- Organization-specific questions asked when requesting membership (e.g.
-- "roll number" for one club, "portfolio URL" for another). Answers are
-- stored on the request and validated against these definitions by
-- private.validate_profile_answers().
-- -----------------------------------------------------------------------------
create table public.organization_profile_fields (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  field_key       text not null,
  label           text not null,
  field_type      text not null,
  is_required     boolean not null default false,
  options         jsonb,               -- only for field_type = 'select': array of strings
  position        smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint organization_profile_fields_key_unique  unique (organization_id, field_key),
  constraint organization_profile_fields_key_format  check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint organization_profile_fields_label_len   check (char_length(btrim(label)) between 1 and 100),
  constraint organization_profile_fields_type_valid  check (field_type in ('text', 'long_text', 'number', 'select', 'url')),
  constraint organization_profile_fields_options     check (
    (field_type = 'select') = (options is not null)
    and (options is null or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 50))
  )
);

create trigger organization_profile_fields_set_updated_at
  before update on public.organization_profile_fields
  for each row execute function private.set_updated_at();

create trigger organization_profile_fields_audit
  after insert or update or delete on public.organization_profile_fields
  for each row execute function private.audit_row_change('organization_profile_field', 'field_key');
