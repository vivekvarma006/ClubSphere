drop function private.claim_meal(uuid,uuid,text), private.create_meal_slot(uuid,uuid,uuid,text), private.adjust_inventory(uuid,uuid,text,int,text);
drop table public.food_claims, public.meal_slots, public.stock_movements, public.inventory_items;
drop function private.apply_stock_movement(), private.require_module(uuid,text,text), private.module_enabled(uuid,text);
alter table public.event_registrations drop constraint registrations_org_id_key;
delete from public.role_permissions where permission_key in ('food.distribute','inventory.manage');
delete from public.role_template_permissions where permission_key in ('food.distribute','inventory.manage');
delete from public.permissions where key in ('food.distribute','inventory.manage');
