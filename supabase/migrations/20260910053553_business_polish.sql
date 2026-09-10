-- Business polish: atomic bulk purchase costs, auditable sale voids and weekly/monthly metrics.

do $business_polish_dependencies$
begin
  if to_regclass('public.business_catalog_items') is null then raise exception 'Missing dependency: public.business_catalog_items'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_sale_items') is null then raise exception 'Missing dependency: public.business_sale_items'; end if;
  if to_regclass('public.business_inventory_movements') is null then raise exception 'Missing dependency: public.business_inventory_movements'; end if;
  if to_regclass('public.business_inventory_location_settings') is null then raise exception 'Missing dependency: public.business_inventory_location_settings'; end if;
  if to_regclass('public.business_inventory_locations') is null then raise exception 'Missing dependency: public.business_inventory_locations'; end if;
  if to_regclass('public.business_inventory_location_balances') is null then raise exception 'Missing dependency: public.business_inventory_location_balances'; end if;
  if to_regclass('public.business_inventory_policies') is null then raise exception 'Missing dependency: public.business_inventory_policies'; end if;
  if to_regclass('public.business_orders') is null then raise exception 'Missing dependency: public.business_orders'; end if;
  if to_regclass('public.products') is null then raise exception 'Missing dependency: public.products'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.adjust_product_stock(uuid,integer,text,text,text,uuid)') is null then raise exception 'Missing dependency: public.adjust_product_stock(uuid, integer, text, text, text, uuid)'; end if;
end;
$business_polish_dependencies$;

alter table public.business_sales
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

comment on column public.business_sales.voided_at is 'When a local sale was fully voided. Voiding restores stock but never refunds an online payment.';
comment on column public.business_sales.void_reason is 'Short operator-provided reason for a full sale void.';

do $business_sale_void_consistency_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_sales'::regclass
      and conname = 'business_sales_void_consistency_check'
  ) then
    alter table public.business_sales
      add constraint business_sales_void_consistency_check
      check (
        (status = 'voided' and voided_at is not null and nullif(btrim(void_reason), '') is not null)
        or (status <> 'voided' and voided_at is null and void_reason is null)
      ) not valid;
  end if;
end;
$business_sale_void_consistency_constraint$;

do $business_inventory_movement_type_constraint$
begin
  alter table public.business_inventory_movements
    drop constraint if exists business_inventory_movements_type_check;
  alter table public.business_inventory_movements
    add constraint business_inventory_movements_type_check
    check (movement_type in ('sale', 'restock', 'manual_adjustment', 'return', 'transfer_to_workshop', 'void_sale'));
end;
$business_inventory_movement_type_constraint$;

create index if not exists business_sales_user_status_created_idx
  on public.business_sales (user_id, status, created_at desc);

create or replace function public.bulk_update_business_purchase_cost(
  p_catalog_item_ids uuid[],
  p_purchase_cost numeric
)
returns table(success boolean, updated_count integer, error_code text, message text)
language plpgsql
security definer
set search_path = public
as $bulk_purchase_cost$
declare
  current_user_id uuid := auth.uid();
  requested_count integer;
  owned_count integer;
  affected_count integer;
begin
  if current_user_id is null then
    return query select false, 0, 'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, 0, 'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  requested_count := coalesce(array_length(p_catalog_item_ids, 1), 0);
  if requested_count not between 1 and 500 or p_purchase_cost is null or p_purchase_cost < 0 then
    return query select false, 0, 'invalid_request'::text, 'La selección o el costo no son válidos.'::text;
    return;
  end if;
  if requested_count <> (select count(distinct item_id) from unnest(p_catalog_item_ids) requested(item_id)) then
    return query select false, 0, 'duplicate_items'::text, 'La selección contiene productos repetidos.'::text;
    return;
  end if;

  perform 1
  from public.business_catalog_items item
  where item.id = any(p_catalog_item_ids)
    and item.user_id = current_user_id
    and item.is_active
    and item.source_type = 'resale'
  order by item.id
  for update;

  select count(*)::integer into owned_count
  from public.business_catalog_items item
  where item.id = any(p_catalog_item_ids)
    and item.user_id = current_user_id
    and item.is_active
    and item.source_type = 'resale';
  if owned_count <> requested_count then
    return query select false, 0, 'invalid_items'::text,
      'Todos los productos deben ser artículos de reventa activos y pertenecerte.'::text;
    return;
  end if;

  update public.business_catalog_items item
  set purchase_cost = round(p_purchase_cost, 2),
      updated_at = now()
  where item.id = any(p_catalog_item_ids)
    and item.user_id = current_user_id
    and item.is_active
    and item.source_type = 'resale';
  get diagnostics affected_count = row_count;
  if affected_count <> requested_count then
    raise exception 'Bulk purchase cost update was not applied completely';
  end if;

  return query select true, affected_count, null::text,
    format('Costo actualizado en %s productos.', affected_count)::text;
end;
$bulk_purchase_cost$;

create or replace function public.void_business_sale(
  p_sale_id uuid,
  p_reason text
)
returns table(success boolean, sale_id uuid, restored_units integer, error_code text, message text)
language plpgsql
security definer
set search_path = public
as $void_sale$
declare
  current_user_id uuid := auth.uid();
  target_sale public.business_sales%rowtype;
  original_movement record;
  catalog_item public.business_catalog_items%rowtype;
  source_product public.products%rowtype;
  previous_stock integer;
  resulting_stock integer;
  restore_quantity integer;
  total_restored integer := 0;
  locations_enabled boolean := false;
  showroom_id uuid;
  warehouse_id uuid;
  showroom_restore integer;
  warehouse_restore integer;
  original_count integer;
  sale_item_count integer;
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
    return query select false, target_sale.id, 0, 'already_voided'::text, 'La venta ya estaba anulada; el stock no se modificó.'::text;
    return;
  end if;
  if target_sale.status <> 'completed' then
    return query select false, target_sale.id, 0, 'invalid_status'::text, 'Esta venta no se puede eliminar en su estado actual.'::text;
    return;
  end if;
  if target_sale.order_id is not null then
    return query select false, target_sale.id, 0, 'online_sale'::text,
      'Esta venta está asociada a un pago online y no puede eliminarse desde acá.'::text;
    return;
  end if;

  select count(*)::integer into original_count
  from public.business_inventory_movements movement
  where movement.sale_id = target_sale.id
    and movement.user_id = current_user_id
    and movement.movement_type = 'sale';
  select count(*)::integer into sale_item_count
  from public.business_sale_items item
  where item.sale_id = target_sale.id
    and item.user_id = current_user_id;
  if original_count = 0 or original_count <> sale_item_count then
    return query select false, target_sale.id, 0, 'incomplete_history'::text,
      'No se puede restaurar esta venta con seguridad porque su historial de stock está incompleto.'::text;
    return;
  end if;
  if exists (
    select 1 from public.business_inventory_movements movement
    where movement.sale_id = target_sale.id
      and movement.user_id = current_user_id
      and movement.movement_type = 'sale'
      and (
        movement.quantity_delta >= 0
        or (
          movement.location_breakdown is not null
          and (
            coalesce((movement.location_breakdown ->> 'showroom')::integer, -1) < 0
            or coalesce((movement.location_breakdown ->> 'warehouse')::integer, -1) < 0
            or coalesce((movement.location_breakdown ->> 'showroom')::integer, 0)
              + coalesce((movement.location_breakdown ->> 'warehouse')::integer, 0) <> -movement.quantity_delta
          )
        )
      )
  ) then
    return query select false, target_sale.id, 0, 'invalid_history'::text,
      'No se puede restaurar esta venta porque su distribución de stock no es válida.'::text;
    return;
  end if;

  select coalesce(settings.locations_enabled, false) into locations_enabled
  from public.business_inventory_location_settings settings
  where settings.user_id = current_user_id
  for share;
  select location.id into showroom_id from public.business_inventory_locations location
  where location.user_id = current_user_id and location.location_type = 'showroom' and location.is_active
  order by location.sort_order, location.id limit 1;
  select location.id into warehouse_id from public.business_inventory_locations location
  where location.user_id = current_user_id and location.location_type = 'warehouse' and location.is_active
  order by location.sort_order, location.id limit 1;

  for original_movement in
    select movement.*
    from public.business_inventory_movements movement
    where movement.sale_id = target_sale.id
      and movement.user_id = current_user_id
      and movement.movement_type = 'sale'
    order by movement.catalog_item_id
    for update
  loop
    restore_quantity := -original_movement.quantity_delta;
    select item.* into catalog_item
    from public.business_catalog_items item
    where item.id = original_movement.catalog_item_id
      and item.user_id = current_user_id
    for update;
    if not found then raise exception 'Catalog item for sale void was not found'; end if;

    if catalog_item.source_type = 'manufactured' then
      select product.* into source_product
      from public.products product
      where product.id = catalog_item.source_product_id
        and product.user_id = current_user_id
      for update;
      if not found then raise exception 'Manufactured source for sale void was not found'; end if;
      previous_stock := coalesce(source_product.stock_quantity, 0);
      perform public.adjust_product_stock(
        p_product_id => source_product.id,
        p_quantity_delta => restore_quantity,
        p_movement_type => 'manual_add',
        p_reason => format('Anulación venta N.º %s: %s', target_sale.sale_number, btrim(p_reason)),
        p_source_type => 'business_sale',
        p_source_id => target_sale.id
      );
      select coalesce(product.stock_quantity, 0) into resulting_stock
      from public.products product where product.id = source_product.id;
      if resulting_stock is distinct from previous_stock + restore_quantity then
        raise exception 'Product stock was not restored completely';
      end if;
    else
      previous_stock := coalesce(catalog_item.resale_stock_quantity, 0);
      resulting_stock := previous_stock + restore_quantity;
      update public.business_catalog_items item
      set resale_stock_quantity = resulting_stock,
          updated_at = now()
      where item.id = catalog_item.id and item.user_id = current_user_id;
      if not found then raise exception 'Resale stock was not restored completely'; end if;
    end if;

    if original_movement.location_breakdown is not null then
      if showroom_id is null or warehouse_id is null then
        raise exception 'Inventory locations required for exact restoration were not found';
      end if;
      showroom_restore := coalesce((original_movement.location_breakdown ->> 'showroom')::integer, 0);
      warehouse_restore := coalesce((original_movement.location_breakdown ->> 'warehouse')::integer, 0);
      insert into public.business_inventory_location_balances(user_id, catalog_item_id, location_id, quantity)
      values (current_user_id, catalog_item.id, showroom_id, 0), (current_user_id, catalog_item.id, warehouse_id, 0)
      on conflict (catalog_item_id, location_id) do nothing;
      perform 1 from public.business_inventory_location_balances balance
      where balance.catalog_item_id = catalog_item.id and balance.user_id = current_user_id
      order by balance.location_id for update;
      if locations_enabled then
        update public.business_inventory_location_balances balance
        set quantity = balance.quantity - showroom_restore, updated_at = now()
        where balance.catalog_item_id = catalog_item.id and balance.location_id = warehouse_id
          and balance.quantity >= showroom_restore;
        if not found then raise exception 'Warehouse balance could not redistribute restored stock'; end if;
        update public.business_inventory_location_balances balance
        set quantity = balance.quantity + showroom_restore, updated_at = now()
        where balance.catalog_item_id = catalog_item.id and balance.location_id = showroom_id;
        if not found then raise exception 'Showroom balance could not restore stock'; end if;
      else
        update public.business_inventory_location_balances balance
        set quantity = balance.quantity + showroom_restore, updated_at = now()
        where balance.catalog_item_id = catalog_item.id and balance.location_id = showroom_id;
        update public.business_inventory_location_balances balance
        set quantity = balance.quantity + warehouse_restore, updated_at = now()
        where balance.catalog_item_id = catalog_item.id and balance.location_id = warehouse_id;
      end if;
    end if;

    insert into public.business_inventory_movements (
      user_id, catalog_item_id, sale_id, movement_type, quantity_delta,
      previous_quantity, new_quantity, reason, reference, operation_key, location_breakdown
    ) values (
      current_user_id, catalog_item.id, target_sale.id, 'void_sale', restore_quantity,
      previous_stock, resulting_stock, btrim(p_reason),
      'VOID-SALE-' || lpad(target_sale.sale_number::text, 6, '0'), target_sale.id,
      original_movement.location_breakdown
    );
    total_restored := total_restored + restore_quantity;
  end loop;

  update public.business_sales sale
  set status = 'voided', voided_at = now(), void_reason = btrim(p_reason), updated_at = now()
  where sale.id = target_sale.id and sale.user_id = current_user_id and sale.status = 'completed';
  get diagnostics updated_sales = row_count;
  if updated_sales <> 1 then raise exception 'Sale could not be marked as voided'; end if;

  return query select true, target_sale.id, total_restored, null::text,
    'Venta eliminada y stock restaurado.'::text;
end;
$void_sale$;

create or replace function public.get_business_metrics(p_period text default 'week')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $business_metrics$
declare
  current_user_id uuid := auth.uid();
  business_timezone text := 'America/Argentina/Buenos_Aires';
  period_start timestamptz;
  period_end timestamptz;
  previous_start timestamptz;
  current_revenue numeric := 0;
  current_sales integer := 0;
  current_units integer := 0;
  current_weight_kg numeric := 0;
  previous_revenue numeric := 0;
  previous_sales integer := 0;
  top_products jsonb := '[]'::jsonb;
begin
  if current_user_id is null or public.has_platform_access(current_user_id) is distinct from true then
    return null;
  end if;
  select coalesce(settings.timezone, business_timezone) into business_timezone
  from public.business_inventory_location_settings settings
  where settings.user_id = current_user_id;
  business_timezone := coalesce(business_timezone, 'America/Argentina/Buenos_Aires');

  if p_period = 'month' then
    period_start := date_trunc('month', now() at time zone business_timezone) at time zone business_timezone;
    period_end := (date_trunc('month', now() at time zone business_timezone) + interval '1 month') at time zone business_timezone;
    previous_start := (date_trunc('month', now() at time zone business_timezone) - interval '1 month') at time zone business_timezone;
  else
    period_start := date_trunc('week', now() at time zone business_timezone) at time zone business_timezone;
    period_end := (date_trunc('week', now() at time zone business_timezone) + interval '1 week') at time zone business_timezone;
    previous_start := (date_trunc('week', now() at time zone business_timezone) - interval '1 week') at time zone business_timezone;
  end if;

  select coalesce(sum(sale.total), 0), count(*)::integer
  into current_revenue, current_sales
  from public.business_sales sale
  left join public.business_orders source_order on source_order.id = sale.order_id and source_order.user_id = sale.user_id
  where sale.user_id = current_user_id
    and sale.status = 'completed'
    and sale.created_at >= period_start and sale.created_at < period_end
    and (sale.order_id is null or source_order.status <> 'refunded');

  select coalesce(sum(sale.total), 0), count(*)::integer
  into previous_revenue, previous_sales
  from public.business_sales sale
  left join public.business_orders source_order on source_order.id = sale.order_id and source_order.user_id = sale.user_id
  where sale.user_id = current_user_id
    and sale.status = 'completed'
    and sale.created_at >= previous_start and sale.created_at < period_start
    and (sale.order_id is null or source_order.status <> 'refunded');

  select coalesce(sum(item.quantity), 0)::integer,
    coalesce(round(sum(case when policy.unit_weight_grams > 0 then item.quantity * policy.unit_weight_grams else 0 end) / 1000, 3), 0)
  into current_units, current_weight_kg
  from public.business_sale_items item
  join public.business_sales sale on sale.id = item.sale_id and sale.user_id = item.user_id
  left join public.business_orders source_order on source_order.id = sale.order_id and source_order.user_id = sale.user_id
  left join public.business_inventory_policies policy on policy.catalog_item_id = item.catalog_item_id and policy.user_id = item.user_id
  where sale.user_id = current_user_id
    and sale.status = 'completed'
    and sale.created_at >= period_start and sale.created_at < period_end
    and (sale.order_id is null or source_order.status <> 'refunded');

  select coalesce(jsonb_agg(jsonb_build_object(
    'catalogItemId', ranked.catalog_item_id,
    'name', ranked.product_name,
    'units', ranked.units,
    'revenue', ranked.revenue,
    'kilograms', ranked.kilograms
  ) order by ranked.units desc, ranked.revenue desc), '[]'::jsonb)
  into top_products
  from (
    select item.catalog_item_id,
      max(item.product_name_snapshot) product_name,
      sum(item.quantity)::integer units,
      sum(item.subtotal)::numeric revenue,
      case when max(policy.unit_weight_grams) > 0
        then round(sum(item.quantity) * max(policy.unit_weight_grams) / 1000, 3)
        else null end kilograms
    from public.business_sale_items item
    join public.business_sales sale on sale.id = item.sale_id and sale.user_id = item.user_id
    left join public.business_orders source_order on source_order.id = sale.order_id and source_order.user_id = sale.user_id
    left join public.business_inventory_policies policy on policy.catalog_item_id = item.catalog_item_id and policy.user_id = item.user_id
    where sale.user_id = current_user_id
      and sale.status = 'completed'
      and sale.created_at >= period_start and sale.created_at < period_end
      and (sale.order_id is null or source_order.status <> 'refunded')
    group by item.catalog_item_id
    order by units desc, revenue desc
    limit 5
  ) ranked;

  return jsonb_build_object(
    'period', case when p_period = 'month' then 'month' else 'week' end,
    'timezone', business_timezone,
    'periodStart', period_start,
    'periodEnd', period_end,
    'revenue', current_revenue,
    'salesCount', current_sales,
    'averageTicket', case when current_sales > 0 then round(current_revenue / current_sales, 2) else 0 end,
    'unitsSold', current_units,
    'filamentKilograms', current_weight_kg,
    'comparison', jsonb_build_object(
      'revenuePercent', case when previous_revenue > 0 then round((current_revenue - previous_revenue) * 100 / previous_revenue, 1) else null end,
      'salesPercent', case when previous_sales > 0 then round((current_sales - previous_sales)::numeric * 100 / previous_sales, 1) else null end
    ),
    'topProducts', top_products
  );
end;
$business_metrics$;

revoke all on function public.bulk_update_business_purchase_cost(uuid[], numeric) from public, anon;
grant execute on function public.bulk_update_business_purchase_cost(uuid[], numeric) to authenticated;
revoke all on function public.void_business_sale(uuid, text) from public, anon;
grant execute on function public.void_business_sale(uuid, text) to authenticated;
revoke all on function public.get_business_metrics(text) from public, anon;
grant execute on function public.get_business_metrics(text) to authenticated;

notify pgrst, 'reload schema';
