-- =============================================================================
-- 0600 Membership requests, memberships and role assignments
--
-- A request ("I would like to join") is kept separate from a membership
-- ("you are in"), because they have different lifecycles and different
-- people may see them:
--
--   membership_requests       pending -> approved | rejected | withdrawn
--   organization_memberships  active <-> suspended
--   membership_roles          which organization roles a membership holds
--
-- Logging in creates neither. Memberships are created only by
-- private.approve_membership_request() or private.create_organization().
-- =============================================================================

create table public.membership_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'pending',
  answers          jsonb not null default '{}'::jsonb,  -- validated against organization_profile_fields
  applied_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  rejection_reason text,
  withdrawn_at     timestamptz,
  updated_at       timestamptz not null default now(),

  constraint membership_requests_org_id_key       unique (organization_id, id),
  constraint membership_requests_status_valid     check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint membership_requests_answers_object   check (jsonb_typeof(answers) = 'object'),
  -- Review metadata must agree with status, whatever code path wrote the row.
  constraint membership_requests_review_consistent check (
       (status = 'pending'               and reviewed_at is null     and withdrawn_at is null)
    or (status in ('approved','rejected') and reviewed_at is not null and withdrawn_at is null)
    or (status = 'withdrawn'             and reviewed_at is null     and withdrawn_at is not null)
  ),
  constraint membership_requests_reason_only_on_reject check (rejection_reason is null or status = 'rejected'),
  constraint membership_requests_reason_length check (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 500),
  constraint membership_requests_review_after_apply check (reviewed_at is null or reviewed_at >= applied_at)
);

-- At most ONE pending request per user per organization. This partial unique
-- index is what makes duplicate submissions and double-clicks harmless, even
-- when two requests race (see private.request_membership).
create unique index membership_requests_one_pending_idx
  on public.membership_requests (organization_id, user_id)
  where status = 'pending';

-- Reviewer queue: oldest pending first, keyset-paginated on (applied_at, id).
create index membership_requests_queue_idx
  on public.membership_requests (organization_id, status, applied_at, id);

-- "My requests" page.
create index membership_requests_user_idx
  on public.membership_requests (user_id, applied_at desc);

create trigger membership_requests_set_updated_at
  before update on public.membership_requests
  for each row execute function private.set_updated_at();

create trigger membership_requests_audit
  after insert or update or delete on public.membership_requests
  for each row execute function private.audit_row_change('membership_request', 'user_id');

-- -----------------------------------------------------------------------------

create table public.organization_memberships (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  status            text not null default 'active',
  joined_at         timestamptz not null default now(),
  source_request_id uuid,
  suspended_at      timestamptz,
  suspended_by      uuid references public.profiles (id) on delete set null,
  suspension_reason text,
  updated_at        timestamptz not null default now(),

  constraint organization_memberships_one_per_user unique (organization_id, user_id),
  constraint organization_memberships_org_id_key   unique (organization_id, id),
  constraint organization_memberships_status_valid check (status in ('active', 'suspended')),
  constraint organization_memberships_suspension_consistent check ((status = 'suspended') = (suspended_at is not null)),
  constraint organization_memberships_reason_only_suspended check (suspension_reason is null or status = 'suspended'),
  constraint organization_memberships_reason_length check (suspension_reason is null or char_length(btrim(suspension_reason)) between 1 and 500),
  -- The originating request must belong to the same organization.
  constraint organization_memberships_request_fk
    foreign key (organization_id, source_request_id)
    references public.membership_requests (organization_id, id)
);

-- "Which organizations am I in?" (the unique constraint above already
-- serves lookups that start with organization_id).
create index organization_memberships_user_idx
  on public.organization_memberships (user_id);

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function private.set_updated_at();

create trigger organization_memberships_audit
  after insert or update or delete on public.organization_memberships
  for each row execute function private.audit_row_change('membership', 'user_id');

-- -----------------------------------------------------------------------------

create table public.membership_roles (
  organization_id uuid not null,
  membership_id   uuid not null,
  role_id         uuid not null,
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid references public.profiles (id) on delete set null,

  primary key (membership_id, role_id),
  -- Both composite FKs share organization_id, so the membership and the role
  -- are guaranteed to belong to the SAME organization. A role from club B can
  -- never be attached to a membership in club A, even by a buggy query.
  constraint membership_roles_membership_fk
    foreign key (organization_id, membership_id)
    references public.organization_memberships (organization_id, id)
    on delete cascade,
  constraint membership_roles_role_fk
    foreign key (organization_id, role_id)
    references public.organization_roles (organization_id, id)
    on delete cascade
);

create index membership_roles_role_idx on public.membership_roles (role_id);
create index membership_roles_org_idx  on public.membership_roles (organization_id);

create trigger membership_roles_audit
  after insert or update or delete on public.membership_roles
  for each row execute function private.audit_row_change('membership_role', 'membership_id', 'role_id');
