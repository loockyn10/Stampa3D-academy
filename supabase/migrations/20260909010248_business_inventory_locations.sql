-- Optional showroom/depot distribution and replenishment for Mi Negocio.
-- The authoritative total remains products.stock_quantity (manufactured) or
-- business_catalog_items.resale_stock_quantity (resale). Location balances
-- are only a distribution of that total.

do $$
begin
  if to_regclass('public.business_catalog_items') is null then raise exception 'Missing dependency: public.business_catalog_items'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_sale_items') is null then raise exception 'Missing dependency: public.business_sale_items'; end if;
  if to_regclass('public.business_orders') is null then raise exception 'Missing dependency: public.business_orders'; end if;
  if to_regprocedure('public.confirm_business_sale(uuid,jsonb,uuid)') is null then raise exception 'Missing dependency: public.confirm_business_sale(uuid,jsonb,uuid)'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.set_updated_at()') is null then raise exception 'Missing dependency: public.set_updated_at()'; end if;
end
$$;

create table if not exists public.business_inventory_location_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locations_enabled boolean not null default false,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_inventory_location_settings_timezone_check check (length(btrim(timezone)) between 1 and 80)
);

create table if not exists public.business_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  location_type text not null default 'other',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_inventory_locations_code_check check (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  constraint business_inventory_locations_name_check check (length(btrim(name)) between 1 and 80),
  constraint business_inventory_locations_type_check check (location_type in ('showroom', 'warehouse', 'other')),
  unique (user_id, code)
);

create unique index if not exists business_catalog_items_user_id_uidx on public.business_catalog_items(user_id, id);
create unique index if not exists business_inventory_locations_user_id_uidx on public.business_inventory_locations(user_id, id);

create table if not exists public.business_inventory_location_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null,
  location_id uuid not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (catalog_item_id, location_id),
  constraint business_inventory_location_balances_catalog_owner_fkey foreign key(user_id,catalog_item_id) references public.business_catalog_items(user_id,id) on delete cascade,
  constraint business_inventory_location_balances_location_owner_fkey foreign key(user_id,location_id) references public.business_inventory_locations(user_id,id) on delete cascade,
  constraint business_inventory_location_balances_quantity_check check (quantity >= 0)
);

create table if not exists public.business_inventory_policies (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid primary key,
  showroom_target integer,
  stock_minimum integer,
  unit_weight_grams numeric(12, 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_inventory_policies_catalog_owner_fkey foreign key(user_id,catalog_item_id) references public.business_catalog_items(user_id,id) on delete cascade,
  constraint business_inventory_policies_showroom_target_check check (showroom_target is null or showroom_target >= 0),
  constraint business_inventory_policies_stock_minimum_check check (stock_minimum is null or stock_minimum >= 0),
  constraint business_inventory_policies_unit_weight_check check (unit_weight_grams is null or unit_weight_grams > 0)
);

create table if not exists public.business_inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null,
  from_location_id uuid not null,
  to_location_id uuid not null,
  quantity integer not null,
  operation_key uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint business_inventory_transfers_catalog_owner_fkey foreign key(user_id,catalog_item_id) references public.business_catalog_items(user_id,id) on delete restrict,
  constraint business_inventory_transfers_from_owner_fkey foreign key(user_id,from_location_id) references public.business_inventory_locations(user_id,id) on delete restrict,
  constraint business_inventory_transfers_to_owner_fkey foreign key(user_id,to_location_id) references public.business_inventory_locations(user_id,id) on delete restrict,
  constraint business_inventory_transfers_quantity_check check (quantity > 0),
  constraint business_inventory_transfers_locations_check check (from_location_id <> to_location_id),
  unique (user_id, operation_key, catalog_item_id)
);

create index if not exists business_inventory_locations_user_type_idx on public.business_inventory_locations(user_id, location_type) where is_active;
create index if not exists business_inventory_location_balances_user_idx on public.business_inventory_location_balances(user_id, catalog_item_id);
create index if not exists business_inventory_policies_user_idx on public.business_inventory_policies(user_id, catalog_item_id);
create index if not exists business_inventory_transfers_user_created_idx on public.business_inventory_transfers(user_id, created_at desc);

drop trigger if exists business_inventory_location_settings_updated_at on public.business_inventory_location_settings;
create trigger business_inventory_location_settings_updated_at before update on public.business_inventory_location_settings for each row execute function public.set_updated_at();
drop trigger if exists business_inventory_locations_updated_at on public.business_inventory_locations;
create trigger business_inventory_locations_updated_at before update on public.business_inventory_locations for each row execute function public.set_updated_at();
drop trigger if exists business_inventory_policies_updated_at on public.business_inventory_policies;
create trigger business_inventory_policies_updated_at before update on public.business_inventory_policies for each row execute function public.set_updated_at();

alter table public.business_inventory_location_settings enable row level security;
alter table public.business_inventory_locations enable row level security;
alter table public.business_inventory_location_balances enable row level security;
alter table public.business_inventory_policies enable row level security;
alter table public.business_inventory_transfers enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['business_inventory_location_settings','business_inventory_locations','business_inventory_location_balances','business_inventory_policies','business_inventory_transfers'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid() and public.has_platform_access(auth.uid()))', table_name || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_all', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', table_name || '_admin_all', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end
$$;

create or replace function public.business_catalog_authoritative_stock(p_catalog_item_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when item.source_type = 'manufactured'
    then coalesce(product.stock_quantity, 0)
    else coalesce(item.resale_stock_quantity, 0) end
  from public.business_catalog_items item
  left join public.products product on product.id = item.source_product_id and product.user_id = item.user_id
  where item.id = p_catalog_item_id;
$$;

create or replace function public.apply_business_location_stock_delta(p_catalog_item_id uuid, p_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  remaining integer := abs(coalesce(p_delta, 0));
  preferred_id uuid;
  target record;
  setting_value text;
  locations_are_enabled boolean := false;
begin
  if coalesce(p_delta, 0) = 0 then return; end if;
  select item.user_id into owner_id from public.business_catalog_items item where item.id = p_catalog_item_id;
  if owner_id is null then return; end if;
  select s.locations_enabled into locations_are_enabled
  from public.business_inventory_location_settings s where s.user_id = owner_id for share;
  if locations_are_enabled is distinct from true then return; end if;

  if p_delta > 0 then
    insert into public.business_inventory_location_balances(user_id, catalog_item_id, location_id, quantity)
    select owner_id, p_catalog_item_id, location.id, p_delta
    from public.business_inventory_locations location
    where location.user_id = owner_id and location.location_type = 'warehouse' and location.is_active
    order by location.sort_order, location.id limit 1
    on conflict (catalog_item_id, location_id) do update set quantity = public.business_inventory_location_balances.quantity + excluded.quantity, updated_at = now();
    return;
  end if;

  setting_value := current_setting('stampa.inventory_sale_location_id', true);
  if setting_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then preferred_id := setting_value::uuid; end if;
  for target in
    select balance.location_id, balance.quantity
    from public.business_inventory_location_balances balance
    join public.business_inventory_locations location on location.id = balance.location_id
    where balance.catalog_item_id = p_catalog_item_id and balance.user_id = owner_id and balance.quantity > 0
    order by case when balance.location_id = preferred_id then 0 when location.location_type = 'warehouse' then 1 when location.location_type = 'showroom' then 2 else 3 end, location.sort_order, location.id
    for update of balance
  loop
    update public.business_inventory_location_balances
    set quantity = quantity - least(quantity, remaining), updated_at = now()
    where catalog_item_id = p_catalog_item_id and location_id = target.location_id;
    remaining := remaining - least(target.quantity, remaining);
    exit when remaining = 0;
  end loop;
  if remaining <> 0 then raise exception 'Location distribution is inconsistent with authoritative stock'; end if;
end;
$$;

create or replace function public.sync_business_product_location_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare linked_item record;
begin
  if new.stock_quantity is not distinct from old.stock_quantity then return new; end if;
  for linked_item in select item.id from public.business_catalog_items item where item.source_type='manufactured' and item.source_product_id=new.id and item.user_id=new.user_id loop
    perform public.apply_business_location_stock_delta(linked_item.id, coalesce(new.stock_quantity,0)-coalesce(old.stock_quantity,0));
  end loop;
  return new;
end;
$$;

create or replace function public.sync_business_resale_location_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source_type='resale' then perform public.apply_business_location_stock_delta(new.id, coalesce(new.resale_stock_quantity,0));
    elsif new.source_type='manufactured' then perform public.apply_business_location_stock_delta(new.id, public.business_catalog_authoritative_stock(new.id)); end if;
  elsif new.source_type='resale' and new.resale_stock_quantity is distinct from old.resale_stock_quantity then
    perform public.apply_business_location_stock_delta(new.id, coalesce(new.resale_stock_quantity,0)-coalesce(old.resale_stock_quantity,0));
  end if;
  return new;
end;
$$;

drop trigger if exists products_sync_business_location_stock on public.products;
create trigger products_sync_business_location_stock after update of stock_quantity on public.products for each row execute function public.sync_business_product_location_stock();
drop trigger if exists catalog_sync_business_location_stock on public.business_catalog_items;
create trigger catalog_sync_business_location_stock after insert or update of resale_stock_quantity on public.business_catalog_items for each row execute function public.sync_business_resale_location_stock();

create or replace function public.configure_business_inventory_locations(p_enabled boolean, p_initial_location text default null)
returns table(success boolean, enabled boolean, initialized boolean, error_code text, message text)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  settings public.business_inventory_location_settings%rowtype;
  showroom_id uuid;
  warehouse_id uuid;
  destination_id uuid;
  item record;
  difference integer;
begin
  if current_user_id is null then return query select false,false,false,'unauthenticated'::text,'Necesitás iniciar sesión.'::text; return; end if;
  if public.has_platform_access(current_user_id) is distinct from true then return query select false,false,false,'forbidden'::text,'No tenés acceso a esta operación.'::text; return; end if;
  if p_enabled and coalesce(p_initial_location,'') not in ('showroom','warehouse','keep') then return query select false,false,false,'invalid_initial_location'::text,'Elegí dónde está tu stock actual.'::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('business-locations:'||current_user_id::text,0));
  insert into public.business_inventory_location_settings(user_id,locations_enabled) values(current_user_id,false) on conflict(user_id) do nothing;
  select s.* into settings from public.business_inventory_location_settings s where s.user_id=current_user_id for update;
  if not p_enabled then update public.business_inventory_location_settings set locations_enabled=false where user_id=current_user_id; return query select true,false,settings.initialized_at is not null,null::text,'Showroom desactivado.'::text; return; end if;

  insert into public.business_inventory_locations(user_id,code,name,location_type,sort_order) values
    (current_user_id,'showroom','Showroom','showroom',10),(current_user_id,'warehouse','Depósito','warehouse',20)
  on conflict(user_id,code) do update set is_active=true;
  select id into showroom_id from public.business_inventory_locations where user_id=current_user_id and code='showroom' for update;
  select id into warehouse_id from public.business_inventory_locations where user_id=current_user_id and code='warehouse' for update;
  destination_id := case when p_initial_location='showroom' then showroom_id else warehouse_id end;

  if settings.initialized_at is null then
    for item in select catalog.id, public.business_catalog_authoritative_stock(catalog.id) total from public.business_catalog_items catalog where catalog.user_id=current_user_id order by catalog.id loop
      insert into public.business_inventory_location_balances(user_id,catalog_item_id,location_id,quantity) values
        (current_user_id,item.id,showroom_id,case when destination_id=showroom_id then item.total else 0 end),
        (current_user_id,item.id,warehouse_id,case when destination_id=warehouse_id then item.total else 0 end)
      on conflict(catalog_item_id,location_id) do nothing;
    end loop;
    update public.business_inventory_location_settings set locations_enabled=true,initialized_at=now() where user_id=current_user_id;
  else
    update public.business_inventory_location_settings set locations_enabled=true where user_id=current_user_id;
    for item in select catalog.id, public.business_catalog_authoritative_stock(catalog.id) total from public.business_catalog_items catalog where catalog.user_id=current_user_id order by catalog.id loop
      insert into public.business_inventory_location_balances(user_id,catalog_item_id,location_id,quantity) values(current_user_id,item.id,showroom_id,0),(current_user_id,item.id,warehouse_id,0) on conflict do nothing;
      select item.total-coalesce(sum(balance.quantity),0)::integer into difference from public.business_inventory_location_balances balance where balance.catalog_item_id=item.id;
      perform public.apply_business_location_stock_delta(item.id,difference);
    end loop;
  end if;
  return query select true,true,true,null::text,'Showroom configurado.'::text;
end;
$$;

create or replace function public.save_business_inventory_policy(p_catalog_item_id uuid, p_showroom_target integer, p_stock_minimum integer, p_unit_weight_grams numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null or public.has_platform_access(current_user_id) is distinct from true then return false; end if;
  if (p_showroom_target is not null and p_showroom_target < 0) or (p_stock_minimum is not null and p_stock_minimum < 0) or (p_unit_weight_grams is not null and p_unit_weight_grams <= 0) then return false; end if;
  if not exists(select 1 from public.business_catalog_items item where item.id=p_catalog_item_id and item.user_id=current_user_id) then return false; end if;
  insert into public.business_inventory_policies(user_id,catalog_item_id,showroom_target,stock_minimum,unit_weight_grams)
  values(current_user_id,p_catalog_item_id,p_showroom_target,p_stock_minimum,p_unit_weight_grams)
  on conflict(catalog_item_id) do update set showroom_target=excluded.showroom_target,stock_minimum=excluded.stock_minimum,unit_weight_grams=excluded.unit_weight_grams,updated_at=now()
  where public.business_inventory_policies.user_id=current_user_id;
  return found;
end;
$$;

create or replace function public.replenish_business_showroom(p_catalog_item_ids uuid[], p_operation_key uuid)
returns table(success boolean, moved_units integer, product_count integer, replayed boolean, error_code text, message text)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid(); showroom_id uuid; warehouse_id uuid; item_id uuid; target integer; showroom_qty integer; warehouse_qty integer; move_qty integer; moved integer:=0; products_count integer:=0;
begin
  if current_user_id is null then return query select false,0,0,false,'unauthenticated'::text,'Necesitás iniciar sesión.'::text; return; end if;
  if public.has_platform_access(current_user_id) is distinct from true then return query select false,0,0,false,'forbidden'::text,'No tenés acceso.'::text; return; end if;
  if p_operation_key is null or coalesce(array_length(p_catalog_item_ids,1),0) not between 1 and 200 then return query select false,0,0,false,'invalid_request'::text,'La reposición no es válida.'::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('business-replenish:'||current_user_id::text||':'||p_operation_key::text,0));
  select coalesce(sum(t.quantity),0)::integer,count(*)::integer into moved,products_count from public.business_inventory_transfers t where t.user_id=current_user_id and t.operation_key=p_operation_key;
  if products_count>0 then return query select true,moved,products_count,true,null::text,'La reposición ya había sido aplicada.'::text; return; end if;
  if not exists(select 1 from public.business_inventory_location_settings s where s.user_id=current_user_id and s.locations_enabled) then return query select false,0,0,false,'locations_disabled'::text,'Showroom no está activado.'::text; return; end if;
  select id into showroom_id from public.business_inventory_locations where user_id=current_user_id and location_type='showroom' and is_active order by sort_order,id limit 1;
  select id into warehouse_id from public.business_inventory_locations where user_id=current_user_id and location_type='warehouse' and is_active order by sort_order,id limit 1;
  for item_id in select distinct requested_id from unnest(p_catalog_item_ids) as requested(requested_id) order by requested_id loop
    if not exists(select 1 from public.business_catalog_items item where item.id=item_id and item.user_id=current_user_id and item.is_active for update) then raise exception 'Catalog item does not belong to current user'; end if;
    select policy.showroom_target into target from public.business_inventory_policies policy where policy.catalog_item_id=item_id and policy.user_id=current_user_id;
    if target is null then continue; end if;
    select quantity into showroom_qty from public.business_inventory_location_balances where catalog_item_id=item_id and location_id=showroom_id for update;
    select quantity into warehouse_qty from public.business_inventory_location_balances where catalog_item_id=item_id and location_id=warehouse_id for update;
    move_qty:=least(greatest(target-coalesce(showroom_qty,0),0),coalesce(warehouse_qty,0));
    if move_qty<=0 then continue; end if;
    update public.business_inventory_location_balances set quantity=quantity-move_qty,updated_at=now() where catalog_item_id=item_id and location_id=warehouse_id and quantity>=move_qty;
    if not found then raise exception 'Insufficient warehouse stock'; end if;
    update public.business_inventory_location_balances set quantity=quantity+move_qty,updated_at=now() where catalog_item_id=item_id and location_id=showroom_id;
    if not found then raise exception 'Missing showroom balance'; end if;
    insert into public.business_inventory_transfers(user_id,catalog_item_id,from_location_id,to_location_id,quantity,operation_key,reason) values(current_user_id,item_id,warehouse_id,showroom_id,move_qty,p_operation_key,'Reposición de showroom');
    moved:=moved+move_qty; products_count:=products_count+1;
  end loop;
  return query select true,moved,products_count,false,null::text,case when moved=0 then 'No hay productos para reponer.' else 'Reposición confirmada.' end::text;
end;
$$;

create or replace function public.confirm_business_showroom_sale(p_idempotency_key uuid, p_items jsonb, p_client_id uuid default null)
returns table(success boolean,sale_id uuid,sale_number bigint,total_amount numeric,replayed boolean,error_code text,message text)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid:=auth.uid(); showroom_id uuid; requested record; available integer; sale_result record;
begin
  if current_user_id is null then return query select false,null::uuid,null::bigint,null::numeric,false,'unauthenticated'::text,'Necesitás iniciar sesión.'::text; return; end if;
  if public.has_platform_access(current_user_id) is distinct from true then return query select false,null::uuid,null::bigint,null::numeric,false,'forbidden'::text,'No tenés acceso.'::text; return; end if;
  if p_idempotency_key is null then return query select false,null::uuid,null::bigint,null::numeric,false,'invalid_idempotency_key'::text,'La venta no tiene una clave válida.'::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('business-sale:'||current_user_id::text||':'||p_idempotency_key::text,0));
  if exists(select 1 from public.business_sales sale where sale.user_id=current_user_id and sale.idempotency_key=p_idempotency_key) then
    return query select * from public.confirm_business_sale(p_idempotency_key,p_items,p_client_id); return;
  end if;
  if not exists(select 1 from public.business_inventory_location_settings s where s.user_id=current_user_id and s.locations_enabled) then
    return query select * from public.confirm_business_sale(p_idempotency_key,p_items,p_client_id); return;
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then return query select false,null::uuid,null::bigint,null::numeric,false,'invalid_items'::text,'El carrito no es válido.'::text; return; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e)<>'object' or coalesce(e->>'catalogItemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(e->>'quantity','') !~ '^[1-9][0-9]{0,4}$') then
    return query select false,null::uuid,null::bigint,null::numeric,false,'invalid_items'::text,'El carrito contiene productos o cantidades inválidas.'::text; return;
  end if;
  select id into showroom_id from public.business_inventory_locations where user_id=current_user_id and location_type='showroom' and is_active order by sort_order,id limit 1;
  for requested in select (e->>'catalogItemId')::uuid item_id,sum((e->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_items)e group by 1 order by 1 loop
    perform 1 from public.business_catalog_items item where item.id=requested.item_id and item.user_id=current_user_id and item.is_active for update;
    if not found then return query select false,null::uuid,null::bigint,null::numeric,false,'catalog_item_not_found'::text,'Un producto no existe, está inactivo o no te pertenece.'::text; return; end if;
    available:=0;
    select coalesce(balance.quantity,0) into available from public.business_inventory_location_balances balance join public.business_catalog_items item on item.id=balance.catalog_item_id where balance.catalog_item_id=requested.item_id and balance.location_id=showroom_id and item.user_id=current_user_id for update of balance;
    if coalesce(available,0)<requested.quantity then
      return query select false,null::uuid,null::bigint,null::numeric,false,'insufficient_showroom_stock'::text,format('No hay unidades suficientes de %s en showroom. Tenés %s en depósito.',(select name from public.business_catalog_items where id=requested.item_id),coalesce((select quantity from public.business_inventory_location_balances where catalog_item_id=requested.item_id and location_id in(select id from public.business_inventory_locations where user_id=current_user_id and location_type='warehouse' and is_active limit 1)),0))::text; return;
    end if;
  end loop;
  perform set_config('stampa.inventory_sale_location_id',showroom_id::text,true);
  select * into sale_result from public.confirm_business_sale(p_idempotency_key,p_items,p_client_id);
  perform set_config('stampa.inventory_sale_location_id','',true);
  return query select sale_result.success,sale_result.sale_id,sale_result.sale_number,sale_result.total_amount,sale_result.replayed,sale_result.error_code,sale_result.message;
end;
$$;

create or replace function public.get_business_replenishment_workspace(p_period text default 'week')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare current_user_id uuid:=auth.uid(); tz text:='America/Argentina/Buenos_Aires'; start_at timestamptz; end_at timestamptz; enabled boolean:=false; result jsonb;
begin
  if current_user_id is null or public.has_platform_access(current_user_id) is distinct from true then return null; end if;
  select s.locations_enabled,s.timezone into enabled,tz from public.business_inventory_location_settings s where s.user_id=current_user_id;
  tz:=coalesce(tz,'America/Argentina/Buenos_Aires');
  if p_period='month' then start_at:=(date_trunc('month',now() at time zone tz) at time zone tz); end_at:=((date_trunc('month',now() at time zone tz)+interval '1 month') at time zone tz);
  else start_at:=(date_trunc('week',now() at time zone tz) at time zone tz); end_at:=((date_trunc('week',now() at time zone tz)+interval '1 week') at time zone tz); end if;
  with sold as (
    select si.catalog_item_id,sum(si.quantity)::integer units,sum(si.subtotal)::numeric total
    from public.business_sale_items si
    join public.business_sales s on s.id=si.sale_id
    left join public.business_orders o on o.id=s.order_id and o.user_id=s.user_id
    where s.user_id=current_user_id and s.status='completed'
      and (s.order_id is null or o.status not in ('refunded'))
      and s.created_at>=start_at and s.created_at<end_at group by si.catalog_item_id
  ), rows as (
    select item.id,item.name,item.category,item.source_type,
      public.business_catalog_authoritative_stock(item.id) total_stock,
      coalesce(showroom.quantity,0) showroom_stock,coalesce(warehouse.quantity,0) warehouse_stock,
      policy.showroom_target,policy.stock_minimum,policy.unit_weight_grams,
      coalesce(sold.units,0) sold_units,coalesce(sold.total,0) sold_total
    from public.business_catalog_items item
    left join lateral (
      select coalesce(sum(balance.quantity),0)::integer quantity
      from public.business_inventory_location_balances balance
      join public.business_inventory_locations location on location.id=balance.location_id
      where balance.catalog_item_id=item.id and balance.user_id=current_user_id and location.location_type='showroom' and location.is_active
    ) showroom on true
    left join lateral (
      select coalesce(sum(balance.quantity),0)::integer quantity
      from public.business_inventory_location_balances balance
      join public.business_inventory_locations location on location.id=balance.location_id
      where balance.catalog_item_id=item.id and balance.user_id=current_user_id and location.location_type='warehouse' and location.is_active
    ) warehouse on true
    left join public.business_inventory_policies policy on policy.catalog_item_id=item.id and policy.user_id=current_user_id
    left join sold on sold.catalog_item_id=item.id
    where item.user_id=current_user_id and item.is_active
  )
  select jsonb_build_object('enabled',enabled,'initialized',exists(select 1 from public.business_inventory_location_settings s where s.user_id=current_user_id and s.initialized_at is not null),'timezone',tz,'period',case when p_period='month' then 'month' else 'week' end,'periodStart',start_at,'periodEnd',end_at,'items',coalesce(jsonb_agg(to_jsonb(rows) order by rows.name),'[]'::jsonb)) into result from rows;
  return result;
end;
$$;

revoke all on function public.business_catalog_authoritative_stock(uuid) from public,anon,authenticated;
revoke all on function public.apply_business_location_stock_delta(uuid,integer) from public,anon,authenticated;
revoke all on function public.sync_business_product_location_stock() from public,anon,authenticated;
revoke all on function public.sync_business_resale_location_stock() from public,anon,authenticated;
revoke all on function public.configure_business_inventory_locations(boolean,text) from public,anon;
grant execute on function public.configure_business_inventory_locations(boolean,text) to authenticated;
revoke all on function public.save_business_inventory_policy(uuid,integer,integer,numeric) from public,anon;
grant execute on function public.save_business_inventory_policy(uuid,integer,integer,numeric) to authenticated;
revoke all on function public.replenish_business_showroom(uuid[],uuid) from public,anon;
grant execute on function public.replenish_business_showroom(uuid[],uuid) to authenticated;
revoke all on function public.confirm_business_showroom_sale(uuid,jsonb,uuid) from public,anon;
grant execute on function public.confirm_business_showroom_sale(uuid,jsonb,uuid) to authenticated;
revoke all on function public.get_business_replenishment_workspace(text) from public,anon;
grant execute on function public.get_business_replenishment_workspace(text) to authenticated;

notify pgrst, 'reload schema';
