-- =============================================================================
-- 0200 Audit log
--
-- Append-only record of security-relevant changes. Rows are written only by
-- the security-definer trigger function below, never directly by API roles,
-- so the actor is always taken from the verified session (auth.uid()) and
-- cannot be forged by a client.
--
-- actor_id and organization_id deliberately have NO foreign keys: audit
-- history must survive the deletion of the user or organization it mentions,
-- and an ON DELETE SET NULL action would itself be an UPDATE of the log.
-- =============================================================================

create table public.audit_logs (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,                    -- null = system / migration / service role
  organization_id uuid,                    -- null = platform-level event
  action          text not null,
  target_type     text not null,
  target_id       text,
  metadata        jsonb not null default '{}'::jsonb,

  constraint audit_logs_action_format      check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  constraint audit_logs_target_type_format check (target_type ~ '^[a-z_]+$'),
  constraint audit_logs_metadata_object    check (jsonb_typeof(metadata) = 'object'),
  -- Metadata holds identifiers and changed column names, never values such
  -- as tokens or free text. The size cap is a backstop against misuse.
  constraint audit_logs_metadata_size      check (octet_length(metadata::text) <= 4096)
);

comment on table public.audit_logs is
  'Append-only audit trail. Written by private.audit_row_change(); UPDATE, DELETE and TRUNCATE are rejected by triggers.';

-- Organization audit screen: newest first within one organization.
create index audit_logs_org_time_idx
  on public.audit_logs (organization_id, occurred_at desc)
  where organization_id is not null;

-- "What did this person do?" investigations.
create index audit_logs_actor_time_idx
  on public.audit_logs (actor_id, occurred_at desc)
  where actor_id is not null;

-- -----------------------------------------------------------------------------
-- Append-only enforcement. Privileges are also revoked in 0800, but a trigger
-- holds even for roles that own the table.
-- -----------------------------------------------------------------------------
create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only (% rejected)', tg_op
    using errcode = 'CS403';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.prevent_audit_mutation();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.prevent_audit_mutation();

-- -----------------------------------------------------------------------------
-- Generic row-change auditor, attached as an AFTER trigger to audited tables.
--
--   tg_argv[0]      target_type written to the log (e.g. 'membership')
--   tg_argv[1..n]   extra key columns copied into metadata, for tables whose
--                   identity is a composite key rather than an id column
--
-- Only column NAMES are recorded for updates, plus from/to for status
-- changes. Values are not copied, so personal data stays in its own table
-- where RLS and deletion apply.
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old         jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_target_type text  := tg_argv[0];
  v_metadata    jsonb := '{}'::jsonb;
  v_changed     jsonb;
  v_action      text;
  v_org_id      uuid;
  i             int;
begin
  for i in 1 .. tg_nargs - 1 loop
    v_metadata := v_metadata || jsonb_build_object(tg_argv[i], v_row -> tg_argv[i]);
  end loop;

  if tg_op = 'INSERT' then
    v_action := v_target_type || '.created';
  elsif tg_op = 'DELETE' then
    v_action := v_target_type || '.deleted';
  else
    select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
      into v_changed
      from jsonb_each(v_row) as n
     where n.key <> 'updated_at'
       and n.value is distinct from v_old -> n.key;

    if v_changed = '[]'::jsonb then
      return null; -- no-op update, nothing to record
    end if;

    if v_row ? 'status' and (v_row -> 'status') is distinct from (v_old -> 'status') then
      v_action   := v_target_type || '.status_changed';
      v_metadata := v_metadata || jsonb_build_object('from', v_old -> 'status', 'to', v_row -> 'status');
    else
      v_action := v_target_type || '.updated';
    end if;
    v_metadata := v_metadata || jsonb_build_object('changed', v_changed);
  end if;

  v_org_id := case
    when v_target_type = 'organization' then (v_row ->> 'id')::uuid
    else (v_row ->> 'organization_id')::uuid
  end;

  insert into public.audit_logs (actor_id, organization_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_org_id, v_action, v_target_type, v_row ->> 'id', v_metadata);

  return null; -- AFTER trigger; return value is ignored
end;
$$;
