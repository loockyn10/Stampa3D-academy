-- Archive commercial catalog items and sell from the combined showroom/depot stock.
-- Apply after 20260909022450_fix_missing_business_location_balances.sql.

do $$
begin
  if to_regclass('public.business_catalog_items') is null then raise exception 'Missing dependency: public.business_catalog_items'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_inventory_movements') is null then raise exception 'Missing dependency: public.business_inventory_movements'; end if;
  if to_regclass('public.business_inventory_location_settings') is null then raise exception 'Missing dependency: public.business_inventory_location_settings'; end if;
  if to_regclass('public.business_inventory_locations') is null then raise exception 'Missing dependency: public.business_inventory_locations'; end if;
  if to_regclass('public.business_inventory_location_balances') is null then raise exception 'Missing dependency: public.business_inventory_location_balances'; end if;
  if to_regprocedure('public.confirm_business_sale(uuid,jsonb,uuid)') is null then raise exception 'Missing dependency: public.confirm_business_sale(uuid,jsonb,uuid)'; end if;
  if to_regprocedure('public.ensure_business_inventory_location_balances(uuid)') is null then raise exception 'Missing dependency: public.ensure_business_inventory_location_balances(uuid)'; end if;
  if to_regprocedure('public.business_catalog_authoritative_stock(uuid)') is null then raise exception 'Missing dependency: public.business_catalog_authoritative_stock(uuid)'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
end
$$;

alter table public.business_inventory_movements
  add column if not exists location_breakdown jsonb;

comment on column public.business_inventory_movements.location_breakdown is
  'Optional sale consumption split, for example {"showroom": 2, "warehouse": 1}.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.business_inventory_movements'::regclass
      and conname = 'business_inventory_movements_location_breakdown_check'
  ) then
    alter table public.business_inventory_movements
      add constraint business_inventory_movements_location_breakdown_check
      check (location_breakdown is null or jsonb_typeof(location_breakdown) = 'object');
  end if;
end
$$;

create or replace function public.confirm_business_showroom_sale(
  p_idempotency_key uuid,
  p_items jsonb,
  p_client_id uuid default null
)
returns table (
  success boolean,
  sale_id uuid,
  sale_number bigint,
  total_amount numeric,
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
  requested record;
  catalog_item public.business_catalog_items%rowtype;
  source_product public.products%rowtype;
  authoritative_qty integer;
  distributed_qty integer;
  showroom_qty integer;
  warehouse_qty integer;
  showroom_consumed integer;
  warehouse_consumed integer;
  location_breakdowns jsonb := '{}'::jsonb;
  sale_result record;
  updated_movements integer;
begin
  if current_user_id is null then
    return query select false, null::uuid, null::bigint, null::numeric, false,
      'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, null::uuid, null::bigint, null::numeric, false,
      'forbidden'::text, 'No tenés acceso.'::text;
    return;
  end if;
  if p_idempotency_key is null then
    return query select false, null::uuid, null::bigint, null::numeric, false,
      'invalid_idempotency_key'::text, 'La venta no tiene una clave válida.'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'business-sale:' || current_user_id::text || ':' || p_idempotency_key::text,
    0
  ));

  -- A retry must replay before validating the now-reduced stock.
  if exists (
    select 1
    from public.business_sales sale
    where sale.user_id = current_user_id
      and sale.idempotency_key = p_idempotency_key
  ) then
    return query
      select * from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id);
    return;
  end if;

  if not exists (
    select 1
    from public.business_inventory_location_settings settings
    where settings.user_id = current_user_id
      and settings.locations_enabled
  ) then
    return query
      select * from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id);
    return;
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 50
    or exists (
      select 1
      from jsonb_array_elements(p_items) element
      where jsonb_typeof(element) <> 'object'
        or coalesce(element ->> 'catalogItemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(element ->> 'quantity', '') !~ '^[1-9][0-9]{0,4}$'
    ) then
    return query select false, null::uuid, null::bigint, null::numeric, false,
      'invalid_items'::text, 'El carrito contiene productos o cantidades inválidas.'::text;
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
    return query select false, null::uuid, null::bigint, null::numeric, false,
      'locations_not_configured'::text, 'Showroom o depósito no están configurados.'::text;
    return;
  end if;

  -- Catalog/source/balance rows are locked in deterministic item order. The
  -- source total and its location distribution cannot change until commit.
  for requested in
    select
      (element ->> 'catalogItemId')::uuid as item_id,
      sum((element ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) element
    group by (element ->> 'catalogItemId')::uuid
    order by (element ->> 'catalogItemId')::uuid
  loop
    if requested.quantity > 100000 then
      return query select false, null::uuid, null::bigint, null::numeric, false,
        'invalid_quantity'::text, 'La cantidad solicitada es demasiado grande.'::text;
      return;
    end if;

    select item.* into catalog_item
    from public.business_catalog_items item
    where item.id = requested.item_id
      and item.user_id = current_user_id
      and item.is_active
    for update;
    if not found then
      return query select false, null::uuid, null::bigint, null::numeric, false,
        'catalog_item_not_found'::text, 'Un producto no existe, fue eliminado o no te pertenece.'::text;
      return;
    end if;

    if catalog_item.source_type = 'manufactured' then
      select product.* into source_product
      from public.products product
      where product.id = catalog_item.source_product_id
        and product.user_id = current_user_id
        and product.is_active
      for update;
      if not found then
        return query select false, null::uuid, null::bigint, null::numeric, false,
          'source_product_not_found'::text, 'Un producto fabricado ya no está disponible.'::text;
        return;
      end if;
      authoritative_qty := coalesce(source_product.stock_quantity, 0);
    else
      authoritative_qty := coalesce(catalog_item.resale_stock_quantity, 0);
    end if;

    if public.ensure_business_inventory_location_balances(catalog_item.id) is distinct from true then
      raise exception 'Business inventory location balances could not be initialized';
    end if;

    perform 1
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id
    order by balance.location_id
    for update;

    select coalesce(sum(balance.quantity), 0)::integer into distributed_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id;

    -- A missing/short warehouse balance receives only authoritative units that
    -- are not represented at any location. Existing units are never duplicated.
    if distributed_qty < authoritative_qty then
      update public.business_inventory_location_balances balance
      set quantity = balance.quantity + (authoritative_qty - distributed_qty),
          updated_at = now()
      where balance.user_id = current_user_id
        and balance.catalog_item_id = catalog_item.id
        and balance.location_id = warehouse_id;
      if not found then raise exception 'Warehouse balance reconciliation failed'; end if;
    elsif distributed_qty > authoritative_qty then
      return query select false, null::uuid, null::bigint, null::numeric, false,
        'inventory_distribution_inconsistent'::text, format('El stock distribuido de %s supera su stock real.', catalog_item.name)::text;
      return;
    end if;

    select balance.quantity into showroom_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id
      and balance.location_id = showroom_id;

    select balance.quantity into warehouse_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id
      and balance.location_id = warehouse_id;

    if coalesce(showroom_qty, 0) + coalesce(warehouse_qty, 0) < requested.quantity then
      return query select false, null::uuid, null::bigint, null::numeric, false,
        'insufficient_stock'::text, format('No hay stock suficiente de %s.', catalog_item.name)::text;
      return;
    end if;

    showroom_consumed := least(coalesce(showroom_qty, 0), requested.quantity);
    warehouse_consumed := requested.quantity - showroom_consumed;
    location_breakdowns := jsonb_set(
      location_breakdowns,
      array[catalog_item.id::text],
      jsonb_build_object('showroom', showroom_consumed, 'warehouse', warehouse_consumed),
      true
    );
  end loop;

  -- The existing stock mutation remains authoritative. Its location trigger
  -- consumes the preferred showroom first, then the warehouse remainder.
  perform set_config('stampa.inventory_sale_location_id', showroom_id::text, true);
  select * into sale_result
  from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id);
  perform set_config('stampa.inventory_sale_location_id', '', true);

  if sale_result.success is distinct from true then
    return query select sale_result.success, sale_result.sale_id, sale_result.sale_number,
      sale_result.total_amount, sale_result.replayed, sale_result.error_code, sale_result.message;
    return;
  end if;

  update public.business_inventory_movements movement
  set location_breakdown = location_breakdowns -> (movement.catalog_item_id::text)
  where movement.user_id = current_user_id
    and movement.sale_id = sale_result.sale_id
    and movement.movement_type = 'sale';
  get diagnostics updated_movements = row_count;

  if updated_movements <> jsonb_object_length(location_breakdowns) then
    raise exception 'Sale location breakdown could not be recorded completely';
  end if;

  return query select sale_result.success, sale_result.sale_id, sale_result.sale_number,
    sale_result.total_amount, sale_result.replayed, sale_result.error_code, sale_result.message;
end;
$$;

revoke all on function public.confirm_business_showroom_sale(uuid, jsonb, uuid) from public, anon;
grant execute on function public.confirm_business_showroom_sale(uuid, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
