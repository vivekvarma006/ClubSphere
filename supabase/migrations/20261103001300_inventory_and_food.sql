-- Optional modules are opt-in. Locks serialize stock/claim writes with club suspension.
create function private.module_enabled(p_org uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_member(p_org) and exists (
    select 1 from public.organizations where id = p_org and status = 'active'
    and settings->'features'->p_feature = 'true'::jsonb);
$$;
create function private.require_module(p_org uuid, p_feature text, p_permission text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_actor();
  perform 1 from public.organizations where id = p_org for no key update;
  if not private.module_enabled(p_org, p_feature) or
     (p_permission is not null and not private.has_org_permission(p_org, p_permission)) then
    raise exception 'module not available' using errcode = 'CS404';
  end if;
end;
$$;
select private.register_permission('food.distribute', 'Distribute event meals', array['officer','volunteer']);
select private.register_permission('inventory.manage', 'Manage inventory and meal slots', array['officer']);
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  quantity int not null default 0 check (quantity >= 0),
  unique (organization_id, id), unique (organization_id, name)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  item_id uuid not null, delta int not null check (delta <> 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, item_id) references public.inventory_items(organization_id,id)
);
create function private.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.inventory_items set quantity = quantity + new.delta
  where id = new.item_id and organization_id = new.organization_id;
  return null;
end;
$$;
create trigger stock_apply after insert on public.stock_movements for each row execute function private.apply_stock_movement();
create table public.meal_slots (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  event_id uuid not null, item_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  unique (organization_id,id), unique (event_id,id), unique (event_id,name),
  foreign key (organization_id,event_id) references public.events(organization_id,id),
  foreign key (organization_id,item_id) references public.inventory_items(organization_id,id)
);
alter table public.event_registrations add constraint registrations_org_id_key unique (organization_id,id);
create table public.food_claims (
  organization_id uuid not null, event_id uuid not null,
  registration_id uuid not null, meal_slot_id uuid not null,
  claimed_at timestamptz not null default now(), claimed_by uuid default auth.uid() references public.profiles(id),
  primary key (registration_id,meal_slot_id),
  foreign key (organization_id,registration_id) references public.event_registrations(organization_id,id),
  foreign key (event_id,registration_id) references public.event_registrations(event_id,id),
  foreign key (organization_id,meal_slot_id) references public.meal_slots(organization_id,id),
  foreign key (event_id,meal_slot_id) references public.meal_slots(event_id,id)
);
create function private.adjust_inventory(p_org uuid, p_item uuid, p_name text, p_delta int, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_item;
begin
  perform private.require_module(p_org,'inventory','inventory.manage');
  if v_id is null then
    insert into public.inventory_items(organization_id,name) values(p_org,p_name) returning id into v_id;
  elsif not exists(select 1 from public.inventory_items where id=v_id and organization_id=p_org) then
    raise exception 'item not found' using errcode='CS404';
  end if;
  insert into public.stock_movements(organization_id,item_id,delta,reason) values(p_org,v_id,p_delta,p_reason);
  return v_id;
end;
$$;
create function private.create_meal_slot(p_org uuid,p_event uuid,p_item uuid,p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_module(p_org,'inventory','inventory.manage');
  insert into public.meal_slots(organization_id,event_id,item_id,name) values(p_org,p_event,p_item,p_name) returning id into v_id;
  return v_id;
end;
$$;
create function private.claim_meal(p_event uuid,p_slot uuid,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_item uuid; v_reg uuid; v_name text; v_inserted uuid;
begin
  select organization_id into v_org from public.events where id=p_event and status='published';
  perform private.require_module(v_org,'inventory','food.distribute');
  select item_id into v_item from public.meal_slots where id=p_slot and event_id=p_event and organization_id=v_org;
  if not found then raise exception 'meal slot not found' using errcode='CS404'; end if;
  select r.id,p.display_name into v_reg,v_name from public.registration_credentials c
    join public.event_registrations r on r.id=c.registration_id
    join public.profiles p on p.id=r.user_id
    join public.event_attendance a on a.registration_id=r.id
    where c.token=p_token and r.event_id=p_event and r.organization_id=v_org and r.status='registered';
  if not found then raise exception 'checked-in registration not found' using errcode='CS404'; end if;
  insert into public.food_claims(organization_id,event_id,registration_id,meal_slot_id)
    values(v_org,p_event,v_reg,p_slot) on conflict do nothing returning registration_id into v_inserted;
  if v_inserted is null then return jsonb_build_object('status','already_claimed','display_name',v_name); end if;
  -- The CHECK on quantity rejects out-of-stock and rolls the claim back too.
  insert into public.stock_movements(organization_id,item_id,delta,reason) values(v_org,v_item,-1,'Event meal');
  return jsonb_build_object('status','claimed','display_name',v_name);
end;
$$;
alter table public.inventory_items enable row level security;
revoke all on public.inventory_items from public,anon,authenticated;
grant select on public.inventory_items to authenticated;
create policy inventory_items_read on public.inventory_items for select to authenticated using (
  private.module_enabled(organization_id,'inventory') and (private.has_org_permission(organization_id,'inventory.manage') or private.has_org_permission(organization_id,'food.distribute')));
create trigger inventory_items_audit after insert or update or delete on public.inventory_items for each row execute function private.audit_row_change('inventory_items');
create index inventory_items_org_idx on public.inventory_items(organization_id);
alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from public,anon,authenticated;
grant select on public.stock_movements to authenticated;
create policy stock_movements_read on public.stock_movements for select to authenticated using (
  private.module_enabled(organization_id,'inventory') and (private.has_org_permission(organization_id,'inventory.manage') or private.has_org_permission(organization_id,'food.distribute')));
create trigger stock_movements_audit after insert or update or delete on public.stock_movements for each row execute function private.audit_row_change('stock_movements');
create index stock_movements_org_idx on public.stock_movements(organization_id);
alter table public.meal_slots enable row level security;
revoke all on public.meal_slots from public,anon,authenticated;
grant select on public.meal_slots to authenticated;
create policy meal_slots_read on public.meal_slots for select to authenticated using (
  private.module_enabled(organization_id,'inventory') and (private.has_org_permission(organization_id,'inventory.manage') or private.has_org_permission(organization_id,'food.distribute')));
create trigger meal_slots_audit after insert or update or delete on public.meal_slots for each row execute function private.audit_row_change('meal_slots');
create index meal_slots_org_idx on public.meal_slots(organization_id);
alter table public.food_claims enable row level security;
revoke all on public.food_claims from public,anon,authenticated;
grant select on public.food_claims to authenticated;
create policy food_claims_read on public.food_claims for select to authenticated using (
  private.module_enabled(organization_id,'inventory') and (private.has_org_permission(organization_id,'inventory.manage') or private.has_org_permission(organization_id,'food.distribute')));
create trigger food_claims_audit after insert or update or delete on public.food_claims for each row execute function private.audit_row_change('food_claim','registration_id','meal_slot_id');
create index food_claims_org_idx on public.food_claims(organization_id);
revoke all on function private.module_enabled(uuid,text), private.require_module(uuid,text,text), private.apply_stock_movement(), private.adjust_inventory(uuid,uuid,text,int,text), private.create_meal_slot(uuid,uuid,uuid,text), private.claim_meal(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.module_enabled(uuid,text), private.adjust_inventory(uuid,uuid,text,int,text), private.create_meal_slot(uuid,uuid,uuid,text), private.claim_meal(uuid,uuid,text) to authenticated;
