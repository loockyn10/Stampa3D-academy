-- Repair lazy creation of showroom/warehouse balances.
-- Apply after 20260909010248_business_inventory_locations.sql.
-- This patch never changes an existing balance. The backfill only inserts
-- missing rows; an absent warehouse receives only authoritative stock that is
-- not already represented by another location.

do $$
begin
  if to_regclass('public.business_inventory_location_settings') is null then raise exception 'Missing dependency: public.business_inventory_location_settings'; end if;
  if to_regclass('public.business_inventory_locations') is null then raise exception 'Missing dependency: public.business_inventory_locations'; end if;
  if to_regclass('public.business_inventory_location_balances') is null then raise exception 'Missing dependency: public.business_inventory_location_balances'; end if;
  if to_regclass('public.business_inventory_policies') is null then raise exception 'Missing dependency: public.business_inventory_policies'; end if;
  if to_regclass('public.business_inventory_transfers') is null then raise exception 'Missing dependency: public.business_inventory_transfers'; end if;
  if to_regprocedure('public.business_catalog_authoritative_stock(uuid)') is null then raise exception 'Missing dependency: public.business_catalog_authoritative_stock(uuid)'; end if;
end
$$;

create or replace function public.ensure_business_inventory_location_balances(p_catalog_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  showroom_id uuid;
  warehouse_id uuid;
begin
  select item.user_id into owner_id
  from public.business_catalog_items item
  where item.id = p_catalog_item_id;

  if owner_id is null or not exists (
    select 1
    from public.business_inventory_location_settings settings
    where settings.user_id = owner_id
      and settings.locations_enabled
  ) then
    return false;
  end if;

  select location.id into showroom_id
  from public.business_inventory_locations location
  where location.user_id = owner_id
    and location.location_type = 'showroom'
    and location.is_active
  order by location.sort_order, location.id
  limit 1;

  select location.id into warehouse_id
  from public.business_inventory_locations location
  where location.user_id = owner_id
    and location.location_type = 'warehouse'
    and location.is_active
  order by location.sort_order, location.id
  limit 1;

  if showroom_id is null or warehouse_id is null then
    return false;
  end if;

  insert into public.business_inventory_location_balances (
    user_id, catalog_item_id, location_id, quantity
  ) values (
    owner_id, p_catalog_item_id, showroom_id, 0
  ), (
    owner_id, p_catalog_item_id, warehouse_id, 0
  )
  on conflict (catalog_item_id, location_id) do nothing;

  return true;
end;
$$;

create or replace function public.apply_business_location_stock_delta(p_catalog_item_id uuid, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  remaining integer := abs(coalesce(p_delta, 0));
  preferred_id uuid;
  target record;
  setting_value text;
  locations_are_enabled boolean := false;
begin
  select item.user_id into owner_id
  from public.business_catalog_items item
  where item.id = p_catalog_item_id;

  if owner_id is null then return; end if;

  select settings.locations_enabled into locations_are_enabled
  from public.business_inventory_location_settings settings
  where settings.user_id = owner_id
  for share;

  if locations_are_enabled is distinct from true then return; end if;
  if public.ensure_business_inventory_location_balances(p_catalog_item_id) is distinct from true then
    raise exception 'Business inventory locations are not configured';
  end if;
  if coalesce(p_delta, 0) = 0 then return; end if;

  if p_delta > 0 then
    update public.business_inventory_location_balances balance
    set quantity = balance.quantity + p_delta,
        updated_at = now()
    where balance.catalog_item_id = p_catalog_item_id
      and balance.location_id = (
        select location.id
        from public.business_inventory_locations location
        where location.user_id = owner_id
          and location.location_type = 'warehouse'
          and location.is_active
        order by location.sort_order, location.id
        limit 1
      );
    if not found then raise exception 'Business warehouse balance could not be initialized'; end if;
    return;
  end if;

  setting_value := current_setting('stampa.inventory_sale_location_id', true);
  if setting_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    preferred_id := setting_value::uuid;
  end if;

  for target in
    select balance.location_id, balance.quantity
    from public.business_inventory_location_balances balance
    join public.business_inventory_locations location on location.id = balance.location_id
    where balance.catalog_item_id = p_catalog_item_id
      and balance.user_id = owner_id
      and balance.quantity > 0
    order by
      case
        when balance.location_id = preferred_id then 0
        when location.location_type = 'warehouse' then 1
        when location.location_type = 'showroom' then 2
        else 3
      end,
      location.sort_order,
      location.id
    for update of balance
  loop
    update public.business_inventory_location_balances balance
    set quantity = balance.quantity - least(balance.quantity, remaining),
        updated_at = now()
    where balance.catalog_item_id = p_catalog_item_id
      and balance.location_id = target.location_id;
    remaining := remaining - least(target.quantity, remaining);
    exit when remaining = 0;
  end loop;

  if remaining <> 0 then
    raise exception 'Location distribution is inconsistent with authoritative stock';
  end if;
end;
$$;

-- Existing enabled businesses: materialize missing showroom rows as zero.
insert into public.business_inventory_location_balances (
  user_id, catalog_item_id, location_id, quantity
)
select
  settings.user_id,
  item.id,
  showroom.id,
  0
from public.business_inventory_location_settings settings
join public.business_catalog_items item on item.user_id = settings.user_id
cross join lateral (
  select location.id
  from public.business_inventory_locations location
  where location.user_id = settings.user_id
    and location.location_type = 'showroom'
    and location.is_active
  order by location.sort_order, location.id
  limit 1
) showroom
where settings.locations_enabled
on conflict (catalog_item_id, location_id) do nothing;

-- If the warehouse row itself is absent, assign only stock not represented by
-- existing balances. Existing quantities are never updated by this backfill.
insert into public.business_inventory_location_balances (
  user_id, catalog_item_id, location_id, quantity
)
select
  settings.user_id,
  item.id,
  warehouse.id,
  greatest(
    coalesce(public.business_catalog_authoritative_stock(item.id), 0)
      - coalesce(existing.distributed_quantity, 0),
    0
  )::integer
from public.business_inventory_location_settings settings
join public.business_catalog_items item on item.user_id = settings.user_id
cross join lateral (
  select location.id
  from public.business_inventory_locations location
  where location.user_id = settings.user_id
    and location.location_type = 'warehouse'
    and location.is_active
  order by location.sort_order, location.id
  limit 1
) warehouse
left join lateral (
  select coalesce(sum(balance.quantity), 0)::integer as distributed_quantity
  from public.business_inventory_location_balances balance
  where balance.user_id = settings.user_id
    and balance.catalog_item_id = item.id
) existing on true
where settings.locations_enabled
on conflict (catalog_item_id, location_id) do nothing;

create or replace function public.replenish_business_showroom(
  p_catalog_item_ids uuid[],
  p_operation_key uuid
)
returns table (
  success boolean,
  moved_units integer,
  product_count integer,
  replayed boolean,
  error_code text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  showroom_id uuid;
  warehouse_id uuid;
  item_id uuid;
  target integer;
  showroom_qty integer;
  warehouse_qty integer;
  authoritative_qty integer;
  distributed_qty integer;
  move_qty integer;
  moved integer := 0;
  products_count integer := 0;
  catalog_item public.business_catalog_items%rowtype;
begin
  if current_user_id is null then
    return query select false, 0, 0, false, 'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, 0, 0, false, 'forbidden'::text, 'No tenés acceso.'::text;
    return;
  end if;
  if p_operation_key is null or coalesce(array_length(p_catalog_item_ids, 1), 0) not between 1 and 200 then
    return query select false, 0, 0, false, 'invalid_request'::text, 'La reposición no es válida.'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'business-replenish:' || current_user_id::text || ':' || p_operation_key::text,
    0
  ));

  select coalesce(sum(transfer.quantity), 0)::integer, count(*)::integer
  into moved, products_count
  from public.business_inventory_transfers transfer
  where transfer.user_id = current_user_id
    and transfer.operation_key = p_operation_key;

  if products_count > 0 then
    return query select true, moved, products_count, true, null::text, 'La reposición ya había sido aplicada.'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.business_inventory_location_settings settings
    where settings.user_id = current_user_id
      and settings.locations_enabled
  ) then
    return query select false, 0, 0, false, 'locations_disabled'::text, 'Showroom no está activado.'::text;
    return;
  end if;

  select location.id into showroom_id
  from public.business_inventory_locations location
  where location.user_id = current_user_id
    and location.location_type = 'showroom'
    and location.is_active
  order by location.sort_order, location.id
  limit 1;

  select location.id into warehouse_id
  from public.business_inventory_locations location
  where location.user_id = current_user_id
    and location.location_type = 'warehouse'
    and location.is_active
  order by location.sort_order, location.id
  limit 1;

  if showroom_id is null or warehouse_id is null then
    return query select false, 0, 0, false, 'locations_not_configured'::text, 'Showroom o depósito no están configurados.'::text;
    return;
  end if;

  if exists (
    select 1
    from unnest(p_catalog_item_ids) as requested(requested_id)
    left join public.business_catalog_items item
      on item.id = requested.requested_id
      and item.user_id = current_user_id
      and item.is_active
    where item.id is null
  ) then
    return query select false, 0, 0, false, 'catalog_item_not_found'::text, 'Un producto no existe, está inactivo o no te pertenece.'::text;
    return;
  end if;

  for item_id in
    select distinct requested_id
    from unnest(p_catalog_item_ids) as requested(requested_id)
    order by requested_id
  loop
    select item.* into catalog_item
    from public.business_catalog_items item
    where item.id = item_id
      and item.user_id = current_user_id
      and item.is_active
    for update;
    if not found then
      raise exception 'Catalog item changed while replenishment was being prepared';
    end if;

    if catalog_item.source_type = 'manufactured' and catalog_item.source_product_id is not null then
      perform 1
      from public.products product
      where product.id = catalog_item.source_product_id
        and product.user_id = current_user_id
      for update;
      if not found then
        raise exception 'Manufactured product source is missing';
      end if;
    end if;

    if public.ensure_business_inventory_location_balances(item_id) is distinct from true then
      raise exception 'Business inventory location balances could not be initialized';
    end if;

    -- Lock the whole distribution before reconciling or moving units. The
    -- catalog/source lock above keeps the authoritative total stable.
    perform 1
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = item_id
    order by balance.location_id
    for update;

    authoritative_qty := coalesce(public.business_catalog_authoritative_stock(item_id), 0);
    select coalesce(sum(balance.quantity), 0)::integer into distributed_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = item_id;

    if distributed_qty < authoritative_qty then
      update public.business_inventory_location_balances balance
      set quantity = balance.quantity + (authoritative_qty - distributed_qty),
          updated_at = now()
      where balance.user_id = current_user_id
        and balance.catalog_item_id = item_id
        and balance.location_id = warehouse_id;
      if not found then raise exception 'Warehouse balance reconciliation failed'; end if;
    elsif distributed_qty > authoritative_qty then
      raise exception 'Location distribution exceeds authoritative stock';
    end if;

    select policy.showroom_target into target
    from public.business_inventory_policies policy
    where policy.catalog_item_id = item_id
      and policy.user_id = current_user_id;
    if target is null then continue; end if;

    select balance.quantity into showroom_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = item_id
      and balance.location_id = showroom_id
    for update;

    select balance.quantity into warehouse_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = item_id
      and balance.location_id = warehouse_id
    for update;

    move_qty := least(
      greatest(target - coalesce(showroom_qty, 0), 0),
      coalesce(warehouse_qty, 0)
    );
    if move_qty <= 0 then continue; end if;

    update public.business_inventory_location_balances balance
    set quantity = balance.quantity - move_qty,
        updated_at = now()
    where balance.user_id = current_user_id
      and balance.catalog_item_id = item_id
      and balance.location_id = warehouse_id
      and balance.quantity >= move_qty;
    if not found then raise exception 'Insufficient warehouse stock'; end if;

    update public.business_inventory_location_balances balance
    set quantity = balance.quantity + move_qty,
        updated_at = now()
    where balance.user_id = current_user_id
      and balance.catalog_item_id = item_id
      and balance.location_id = showroom_id;
    if not found then raise exception 'Showroom balance initialization failed'; end if;

    insert into public.business_inventory_transfers (
      user_id, catalog_item_id, from_location_id, to_location_id,
      quantity, operation_key, reason
    ) values (
      current_user_id, item_id, warehouse_id, showroom_id,
      move_qty, p_operation_key, 'Reposición de showroom'
    );

    moved := moved + move_qty;
    products_count := products_count + 1;
  end loop;

  return query select
    true,
    moved,
    products_count,
    false,
    null::text,
    case when moved = 0 then 'No hay productos para reponer.' else 'Reposición confirmada.' end::text;
end;
$$;

revoke all on function public.ensure_business_inventory_location_balances(uuid) from public, anon, authenticated;
revoke all on function public.apply_business_location_stock_delta(uuid, integer) from public, anon, authenticated;
revoke all on function public.replenish_business_showroom(uuid[], uuid) from public, anon;
grant execute on function public.replenish_business_showroom(uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
