-- Record the real source location of quick-sale inventory movements and make
-- sale voids reversible without relying on a JSON column.
-- Apply after 20260910053553_business_polish.sql.

do $business_sale_location_dependencies$
begin
  if to_regclass('public.business_catalog_items') is null then raise exception 'Missing dependency: public.business_catalog_items'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_sale_items') is null then raise exception 'Missing dependency: public.business_sale_items'; end if;
  if to_regclass('public.business_inventory_movements') is null then raise exception 'Missing dependency: public.business_inventory_movements'; end if;
  if to_regclass('public.business_inventory_location_settings') is null then raise exception 'Missing dependency: public.business_inventory_location_settings'; end if;
  if to_regclass('public.business_inventory_locations') is null then raise exception 'Missing dependency: public.business_inventory_locations'; end if;
  if to_regclass('public.business_inventory_location_balances') is null then raise exception 'Missing dependency: public.business_inventory_location_balances'; end if;
  if to_regclass('public.products') is null then raise exception 'Missing dependency: public.products'; end if;
  if to_regprocedure('public.confirm_business_sale(uuid,jsonb,uuid)') is null then raise exception 'Missing dependency: public.confirm_business_sale(uuid, jsonb, uuid)'; end if;
  if to_regprocedure('public.ensure_business_inventory_location_balances(uuid)') is null then raise exception 'Missing dependency: public.ensure_business_inventory_location_balances(uuid)'; end if;
  if to_regprocedure('public.business_catalog_authoritative_stock(uuid)') is null then raise exception 'Missing dependency: public.business_catalog_authoritative_stock(uuid)'; end if;
  if to_regprocedure('public.adjust_product_stock(uuid,integer,text,text,text,uuid)') is null then raise exception 'Missing dependency: public.adjust_product_stock(uuid, integer, text, text, text, uuid)'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'business_sales' and column_name = 'voided_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'business_sales' and column_name = 'void_reason'
  ) then
    raise exception 'Missing dependency: business_sales void columns from 20260910053553_business_polish.sql';
  end if;
end;
$business_sale_location_dependencies$;

alter table public.business_inventory_movements
  add column if not exists location_id uuid;

do $business_inventory_movement_location_fkey$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.business_inventory_movements'::regclass
      and conname = 'business_inventory_movements_location_owner_fkey'
  ) then
    alter table public.business_inventory_movements
      add constraint business_inventory_movements_location_owner_fkey
      foreign key (user_id, location_id)
      references public.business_inventory_locations(user_id, id)
      on delete restrict;
  end if;
end;
$business_inventory_movement_location_fkey$;

comment on column public.business_inventory_movements.location_id is
  'Physical location directly affected by this movement. Null is retained for legacy and locations-disabled movements.';

create index if not exists business_inventory_movements_sale_location_idx
  on public.business_inventory_movements (sale_id, catalog_item_id, location_id)
  where sale_id is not null;

-- The original uniqueness rule allowed only one movement per product. A sale
-- may now consume the same product from two locations, while null keeps the
-- previous one-movement idempotency guarantee for all legacy operations.
create unique index if not exists business_inventory_movements_operation_item_location_uidx
  on public.business_inventory_movements (
    user_id,
    operation_key,
    catalog_item_id,
    movement_type,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop index if exists public.business_inventory_movements_operation_item_uidx;

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
as $confirm_location_sale$
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
  location_splits jsonb := '{}'::jsonb;
  split jsonb;
  sale_result record;
  original_movement_id uuid;
  original_movement_count integer;
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

  -- Replay before validating stock, because the first execution already
  -- consumed it. confirm_business_sale is the idempotency authority.
  if exists (
    select 1
    from public.business_sales sale
    where sale.user_id = current_user_id
      and sale.idempotency_key = p_idempotency_key
  ) then
    return query select *
    from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id);
    return;
  end if;

  if not exists (
    select 1
    from public.business_inventory_location_settings settings
    where settings.user_id = current_user_id
      and settings.locations_enabled
  ) then
    return query select *
    from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id);
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

  -- Catalog, source and location rows are locked in product order. The total
  -- shown by the client is advisory; this loop always recalculates it.
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
        'catalog_item_not_found'::text, 'Un producto no existe, está inactivo o no te pertenece.'::text;
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

    authoritative_qty := coalesce(public.business_catalog_authoritative_stock(catalog_item.id), 0);
    select coalesce(sum(balance.quantity), 0)::integer into distributed_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id;

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
        'inventory_inconsistent'::text, format('La distribución de stock de %s necesita revisión.', catalog_item.name)::text;
      return;
    end if;

    select balance.quantity into showroom_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id
      and balance.location_id = showroom_id
    for update;

    select balance.quantity into warehouse_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = catalog_item.id
      and balance.location_id = warehouse_id
    for update;

    if coalesce(showroom_qty, 0) + coalesce(warehouse_qty, 0) < requested.quantity then
      return query select false, null::uuid, null::bigint, null::numeric, false,
        'insufficient_stock'::text, format('No hay stock suficiente de %s.', catalog_item.name)::text;
      return;
    end if;

    showroom_consumed := least(coalesce(showroom_qty, 0), requested.quantity);
    warehouse_consumed := requested.quantity - showroom_consumed;
    location_splits := jsonb_set(
      location_splits,
      array[catalog_item.id::text],
      jsonb_build_object(
        'showroomBefore', coalesce(showroom_qty, 0),
        'warehouseBefore', coalesce(warehouse_qty, 0),
        'showroomConsumed', showroom_consumed,
        'warehouseConsumed', warehouse_consumed
      ),
      true
    );
  end loop;

  -- The existing total remains authoritative. Its trigger consumes the
  -- preferred showroom first and then the warehouse remainder directly.
  perform set_config('stampa.inventory_sale_location_id', showroom_id::text, true);
  select * into sale_result
  from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id);
  perform set_config('stampa.inventory_sale_location_id', '', true);

  if sale_result.success is distinct from true then
    return query select sale_result.success, sale_result.sale_id, sale_result.sale_number,
      sale_result.total_amount, sale_result.replayed, sale_result.error_code, sale_result.message;
    return;
  end if;

  for requested in
    select
      (element ->> 'catalogItemId')::uuid as item_id,
      sum((element ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) element
    group by (element ->> 'catalogItemId')::uuid
    order by (element ->> 'catalogItemId')::uuid
  loop
    split := location_splits -> (requested.item_id::text);
    showroom_consumed := (split ->> 'showroomConsumed')::integer;
    warehouse_consumed := (split ->> 'warehouseConsumed')::integer;

    select count(*)::integer into original_movement_count
    from public.business_inventory_movements movement
    where movement.user_id = current_user_id
      and movement.sale_id = sale_result.sale_id
      and movement.catalog_item_id = requested.item_id
      and movement.movement_type = 'sale';
    if original_movement_count <> 1 then
      raise exception 'Sale movement could not be localized unambiguously';
    end if;

    select movement.id into original_movement_id
    from public.business_inventory_movements movement
    where movement.user_id = current_user_id
      and movement.sale_id = sale_result.sale_id
      and movement.catalog_item_id = requested.item_id
      and movement.movement_type = 'sale'
    for update;

    if showroom_consumed > 0 then
      update public.business_inventory_movements movement
      set location_id = showroom_id,
          quantity_delta = -showroom_consumed,
          previous_quantity = (split ->> 'showroomBefore')::integer,
          new_quantity = (split ->> 'showroomBefore')::integer - showroom_consumed
      where movement.id = original_movement_id;
      get diagnostics updated_movements = row_count;
      if updated_movements <> 1 then raise exception 'Showroom sale movement was not recorded'; end if;

      if warehouse_consumed > 0 then
        insert into public.business_inventory_movements (
          user_id, catalog_item_id, sale_id, location_id, movement_type,
          quantity_delta, previous_quantity, new_quantity, reason, reference, operation_key
        ) values (
          current_user_id, requested.item_id, sale_result.sale_id, warehouse_id, 'sale',
          -warehouse_consumed, (split ->> 'warehouseBefore')::integer,
          (split ->> 'warehouseBefore')::integer - warehouse_consumed,
          format('Venta rápida N.º %s', sale_result.sale_number),
          'SALE-' || lpad(sale_result.sale_number::text, 6, '0'), p_idempotency_key
        );
      end if;
    else
      update public.business_inventory_movements movement
      set location_id = warehouse_id,
          quantity_delta = -warehouse_consumed,
          previous_quantity = (split ->> 'warehouseBefore')::integer,
          new_quantity = (split ->> 'warehouseBefore')::integer - warehouse_consumed
      where movement.id = original_movement_id;
      get diagnostics updated_movements = row_count;
      if updated_movements <> 1 then raise exception 'Warehouse sale movement was not recorded'; end if;
    end if;

    select balance.quantity into showroom_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = requested.item_id
      and balance.location_id = showroom_id;
    select balance.quantity into warehouse_qty
    from public.business_inventory_location_balances balance
    where balance.user_id = current_user_id
      and balance.catalog_item_id = requested.item_id
      and balance.location_id = warehouse_id;
    if showroom_qty is distinct from (split ->> 'showroomBefore')::integer - showroom_consumed
      or warehouse_qty is distinct from (split ->> 'warehouseBefore')::integer - warehouse_consumed then
      raise exception 'Location balances did not match the recorded sale movements';
    end if;
  end loop;

  return query select sale_result.success, sale_result.sale_id, sale_result.sale_number,
    sale_result.total_amount, sale_result.replayed, sale_result.error_code, sale_result.message;
end;
$confirm_location_sale$;

create or replace function public.void_business_sale(
  p_sale_id uuid,
  p_reason text
)
returns table(success boolean, sale_id uuid, restored_units integer, error_code text, message text)
language plpgsql
security definer
set search_path = public
as $void_sale_by_location$
declare
  current_user_id uuid := auth.uid();
  target_sale public.business_sales%rowtype;
  sold_item record;
  catalog_item public.business_catalog_items%rowtype;
  source_product public.products%rowtype;
  source_location record;
  previous_stock integer;
  resulting_stock integer;
  restore_quantity integer;
  total_restored integer := 0;
  locations_enabled boolean := false;
  warehouse_id uuid;
  movement_count integer;
  localized_count integer;
  invalid_movement_count integer;
  movement_total integer;
  distributed_qty integer;
  relocate_quantity integer;
  resulting_location_quantity integer;
  updated_sales integer;
begin
  if current_user_id is null then
    return query select false, p_sale_id, 0, 'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_sale_id, 0, 'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  if p_sale_id is null or nullif(btrim(coalesce(p_reason, '')), '') is null or length(btrim(p_reason)) > 120 then
    return query select false, p_sale_id, 0, 'invalid_request'::text, 'La venta o el motivo no son válidos.'::text;
    return;
  end if;

  select sale.* into target_sale
  from public.business_sales sale
  where sale.id = p_sale_id
    and sale.user_id = current_user_id
  for update;
  if not found then
    return query select false, p_sale_id, 0, 'sale_not_found'::text, 'La venta no existe o no te pertenece.'::text;
    return;
  end if;
  if target_sale.status = 'voided' then
    return query select false, target_sale.id, 0, 'already_voided'::text,
      'La venta ya estaba anulada; el stock no se modificó.'::text;
    return;
  end if;
  if target_sale.status <> 'completed' then
    return query select false, target_sale.id, 0, 'invalid_status'::text,
      'Esta venta no se puede eliminar en su estado actual.'::text;
    return;
  end if;
  if target_sale.order_id is not null then
    return query select false, target_sale.id, 0, 'online_sale'::text,
      'Esta venta está asociada a un pago online y no puede eliminarse desde acá.'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.business_sale_items item
    where item.sale_id = target_sale.id
      and item.user_id = current_user_id
  ) then
    return query select false, target_sale.id, 0, 'incomplete_history'::text,
      'No se puede restaurar esta venta porque no tiene detalle de productos.'::text;
    return;
  end if;

  select coalesce(settings.locations_enabled, false) into locations_enabled
  from public.business_inventory_location_settings settings
  where settings.user_id = current_user_id
  for share;
  locations_enabled := coalesce(locations_enabled, false);

  if locations_enabled then
    select location.id into warehouse_id
    from public.business_inventory_locations location
    where location.user_id = current_user_id
      and location.location_type = 'warehouse'
      and location.is_active
    order by location.sort_order, location.id
    limit 1;
    if warehouse_id is null then
      return query select false, target_sale.id, 0, 'locations_not_configured'::text,
        'No se encontró el depósito activo para restaurar la venta.'::text;
      return;
    end if;
  end if;

  -- Validate and lock the complete sale before restoring the first unit. This
  -- prevents a later invalid item from committing a partial void.
  for sold_item in
    select item.catalog_item_id, item.quantity
    from public.business_sale_items item
    where item.sale_id = target_sale.id
      and item.user_id = current_user_id
    order by item.catalog_item_id
  loop
    select item.* into catalog_item
    from public.business_catalog_items item
    where item.id = sold_item.catalog_item_id
      and item.user_id = current_user_id
    for update;
    if not found then
      return query select false, target_sale.id, 0, 'incomplete_history'::text,
        'No se encontró un producto original de esta venta.'::text;
      return;
    end if;

    if catalog_item.source_type = 'manufactured' then
      select product.* into source_product
      from public.products product
      where product.id = catalog_item.source_product_id
        and product.user_id = current_user_id
      for update;
      if not found then
        return query select false, target_sale.id, 0, 'incomplete_history'::text,
          'No se encontró el producto fabricado original de esta venta.'::text;
        return;
      end if;
    end if;

    perform 1
    from public.business_inventory_movements movement
    where movement.sale_id = target_sale.id
      and movement.user_id = current_user_id
      and movement.catalog_item_id = sold_item.catalog_item_id
      and movement.movement_type = 'sale'
    order by movement.location_id nulls first, movement.id
    for update;

    select
      count(*)::integer,
      count(movement.location_id)::integer,
      (count(*) filter (where movement.quantity_delta >= 0))::integer,
      coalesce(sum(-movement.quantity_delta), 0)::integer
    into movement_count, localized_count, invalid_movement_count, movement_total
    from public.business_inventory_movements movement
    where movement.sale_id = target_sale.id
      and movement.user_id = current_user_id
      and movement.catalog_item_id = sold_item.catalog_item_id
      and movement.movement_type = 'sale';

    if movement_count = 0 or movement_total <> sold_item.quantity then
      return query select false, target_sale.id, 0, 'incomplete_history'::text,
        'No se puede restaurar esta venta con seguridad porque su historial de stock está incompleto.'::text;
      return;
    end if;
    if invalid_movement_count > 0 or localized_count not in (0, movement_count) then
      return query select false, target_sale.id, 0, 'invalid_history'::text,
        'No se puede restaurar esta venta porque sus movimientos de stock no son válidos.'::text;
      return;
    end if;
    if localized_count = movement_count and exists (
      select 1
      from public.business_inventory_movements movement
      left join public.business_inventory_locations location
        on location.id = movement.location_id
        and location.user_id = current_user_id
      where movement.sale_id = target_sale.id
        and movement.user_id = current_user_id
        and movement.catalog_item_id = sold_item.catalog_item_id
        and movement.movement_type = 'sale'
        and location.id is null
    ) then
      return query select false, target_sale.id, 0, 'invalid_history'::text,
        'No se encontró una ubicación original de esta venta.'::text;
      return;
    end if;
  end loop;

  for sold_item in
    select item.catalog_item_id, item.quantity
    from public.business_sale_items item
    where item.sale_id = target_sale.id
      and item.user_id = current_user_id
    order by item.catalog_item_id
  loop
    perform 1
    from public.business_inventory_movements movement
    where movement.sale_id = target_sale.id
      and movement.user_id = current_user_id
      and movement.catalog_item_id = sold_item.catalog_item_id
      and movement.movement_type = 'sale'
    order by movement.location_id nulls first, movement.id
    for update;

    select
      count(*)::integer,
      count(movement.location_id)::integer,
      (count(*) filter (where movement.quantity_delta >= 0))::integer,
      coalesce(sum(-movement.quantity_delta), 0)::integer
    into movement_count, localized_count, invalid_movement_count, movement_total
    from public.business_inventory_movements movement
    where movement.sale_id = target_sale.id
      and movement.user_id = current_user_id
      and movement.catalog_item_id = sold_item.catalog_item_id
      and movement.movement_type = 'sale';

    if movement_count = 0 or movement_total <> sold_item.quantity then
      return query select false, target_sale.id, 0, 'incomplete_history'::text,
        'No se puede restaurar esta venta con seguridad porque su historial de stock está incompleto.'::text;
      return;
    end if;
    if invalid_movement_count > 0 or localized_count not in (0, movement_count) then
      return query select false, target_sale.id, 0, 'invalid_history'::text,
        'No se puede restaurar esta venta porque sus movimientos de stock no son válidos.'::text;
      return;
    end if;
    if localized_count = movement_count and exists (
      select 1
      from public.business_inventory_movements movement
      left join public.business_inventory_locations location
        on location.id = movement.location_id
        and location.user_id = current_user_id
      where movement.sale_id = target_sale.id
        and movement.user_id = current_user_id
        and movement.catalog_item_id = sold_item.catalog_item_id
        and movement.movement_type = 'sale'
        and location.id is null
    ) then
      return query select false, target_sale.id, 0, 'invalid_history'::text,
        'No se encontró una ubicación original de esta venta.'::text;
      return;
    end if;

    select item.* into catalog_item
    from public.business_catalog_items item
    where item.id = sold_item.catalog_item_id
      and item.user_id = current_user_id
    for update;
    if not found then raise exception 'Catalog item for sale void was not found'; end if;

    restore_quantity := sold_item.quantity;
    if catalog_item.source_type = 'manufactured' then
      select product.* into source_product
      from public.products product
      where product.id = catalog_item.source_product_id
        and product.user_id = current_user_id
      for update;
      if not found then raise exception 'Manufactured source for sale void was not found'; end if;
      previous_stock := coalesce(source_product.stock_quantity, 0);
    else
      previous_stock := coalesce(catalog_item.resale_stock_quantity, 0);
    end if;

    if locations_enabled then
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
      if distributed_qty < previous_stock then
        update public.business_inventory_location_balances balance
        set quantity = balance.quantity + (previous_stock - distributed_qty),
            updated_at = now()
        where balance.user_id = current_user_id
          and balance.catalog_item_id = catalog_item.id
          and balance.location_id = warehouse_id;
        if not found then raise exception 'Warehouse balance reconciliation failed'; end if;
      elsif distributed_qty > previous_stock then
        raise exception 'Location distribution exceeds authoritative stock';
      end if;
    elsif localized_count = movement_count then
      perform 1
      from public.business_inventory_location_balances balance
      where balance.user_id = current_user_id
        and balance.catalog_item_id = catalog_item.id
        and balance.location_id in (
          select movement.location_id
          from public.business_inventory_movements movement
          where movement.sale_id = target_sale.id
            and movement.user_id = current_user_id
            and movement.catalog_item_id = catalog_item.id
            and movement.movement_type = 'sale'
        )
      order by balance.location_id
      for update;
    end if;

    if catalog_item.source_type = 'manufactured' then
      perform public.adjust_product_stock(
        p_product_id => source_product.id,
        p_quantity_delta => restore_quantity,
        p_movement_type => 'manual_add',
        p_reason => format('Anulación venta N.º %s: %s', target_sale.sale_number, btrim(p_reason)),
        p_source_type => 'business_sale',
        p_source_id => target_sale.id
      );
      select coalesce(product.stock_quantity, 0) into resulting_stock
      from public.products product
      where product.id = source_product.id;
      if resulting_stock is distinct from previous_stock + restore_quantity then
        raise exception 'Product stock was not restored completely';
      end if;
    else
      resulting_stock := previous_stock + restore_quantity;
      update public.business_catalog_items item
      set resale_stock_quantity = resulting_stock,
          updated_at = now()
      where item.id = catalog_item.id
        and item.user_id = current_user_id;
      if not found then raise exception 'Resale stock was not restored completely'; end if;
    end if;

    if localized_count = movement_count then
      if locations_enabled then
        select coalesce(sum(-movement.quantity_delta), 0)::integer into relocate_quantity
        from public.business_inventory_movements movement
        where movement.sale_id = target_sale.id
          and movement.user_id = current_user_id
          and movement.catalog_item_id = catalog_item.id
          and movement.movement_type = 'sale'
          and movement.location_id <> warehouse_id;

        if relocate_quantity > 0 then
          update public.business_inventory_location_balances balance
          set quantity = balance.quantity - relocate_quantity,
              updated_at = now()
          where balance.user_id = current_user_id
            and balance.catalog_item_id = catalog_item.id
            and balance.location_id = warehouse_id
            and balance.quantity >= relocate_quantity;
          if not found then raise exception 'Warehouse balance could not redistribute restored stock'; end if;
        end if;
      end if;

      for source_location in
        select movement.location_id, sum(-movement.quantity_delta)::integer as quantity
        from public.business_inventory_movements movement
        where movement.sale_id = target_sale.id
          and movement.user_id = current_user_id
          and movement.catalog_item_id = catalog_item.id
          and movement.movement_type = 'sale'
        group by movement.location_id
        order by movement.location_id
      loop
        if not locations_enabled or source_location.location_id <> warehouse_id then
          insert into public.business_inventory_location_balances (
            user_id, catalog_item_id, location_id, quantity
          ) values (
            current_user_id, catalog_item.id, source_location.location_id, 0
          ) on conflict (catalog_item_id, location_id) do nothing;

          update public.business_inventory_location_balances balance
          set quantity = balance.quantity + source_location.quantity,
              updated_at = now()
          where balance.user_id = current_user_id
            and balance.catalog_item_id = catalog_item.id
            and balance.location_id = source_location.location_id;
          if not found then raise exception 'Original location balance could not restore stock'; end if;
        end if;

        select balance.quantity into resulting_location_quantity
        from public.business_inventory_location_balances balance
        where balance.user_id = current_user_id
          and balance.catalog_item_id = catalog_item.id
          and balance.location_id = source_location.location_id;

        insert into public.business_inventory_movements (
          user_id, catalog_item_id, sale_id, location_id, movement_type,
          quantity_delta, previous_quantity, new_quantity, reason, reference, operation_key
        ) values (
          current_user_id, catalog_item.id, target_sale.id, source_location.location_id, 'void_sale',
          source_location.quantity, resulting_location_quantity - source_location.quantity,
          resulting_location_quantity, btrim(p_reason),
          'VOID-SALE-' || lpad(target_sale.sale_number::text, 6, '0'), target_sale.id
        );
      end loop;
    elsif locations_enabled then
      -- Legacy sales have no source location. The only safe deterministic
      -- fallback is the active warehouse; no historical split is invented.
      select balance.quantity into resulting_location_quantity
      from public.business_inventory_location_balances balance
      where balance.user_id = current_user_id
        and balance.catalog_item_id = catalog_item.id
        and balance.location_id = warehouse_id;

      insert into public.business_inventory_movements (
        user_id, catalog_item_id, sale_id, location_id, movement_type,
        quantity_delta, previous_quantity, new_quantity, reason, reference, operation_key
      ) values (
        current_user_id, catalog_item.id, target_sale.id, warehouse_id, 'void_sale',
        restore_quantity, resulting_location_quantity - restore_quantity,
        resulting_location_quantity, btrim(p_reason) || ' (venta legacy restaurada en depósito)',
        'VOID-SALE-' || lpad(target_sale.sale_number::text, 6, '0'), target_sale.id
      );
    else
      insert into public.business_inventory_movements (
        user_id, catalog_item_id, sale_id, location_id, movement_type,
        quantity_delta, previous_quantity, new_quantity, reason, reference, operation_key
      ) values (
        current_user_id, catalog_item.id, target_sale.id, null, 'void_sale',
        restore_quantity, previous_stock, resulting_stock, btrim(p_reason),
        'VOID-SALE-' || lpad(target_sale.sale_number::text, 6, '0'), target_sale.id
      );
    end if;

    total_restored := total_restored + restore_quantity;
  end loop;

  update public.business_sales sale
  set status = 'voided',
      voided_at = now(),
      void_reason = btrim(p_reason),
      updated_at = now()
  where sale.id = target_sale.id
    and sale.user_id = current_user_id
    and sale.status = 'completed';
  get diagnostics updated_sales = row_count;
  if updated_sales <> 1 then raise exception 'Sale could not be marked as voided'; end if;

  return query select true, target_sale.id, total_restored, null::text,
    'Venta eliminada y stock restaurado.'::text;
end;
$void_sale_by_location$;

revoke all on function public.confirm_business_showroom_sale(uuid, jsonb, uuid) from public, anon;
grant execute on function public.confirm_business_showroom_sale(uuid, jsonb, uuid) to authenticated;
revoke all on function public.void_business_sale(uuid, text) from public, anon;
grant execute on function public.void_business_sale(uuid, text) to authenticated;

notify pgrst, 'reload schema';
