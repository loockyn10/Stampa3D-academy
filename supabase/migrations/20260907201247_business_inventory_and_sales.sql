-- Sprint 2/4: commercial inventory movements and atomic quick sales.
-- Apply after 20260907172205_business_catalog_foundation.sql.

do $$
begin
  if to_regclass('public.business_catalog_items') is null then
    raise exception 'Missing dependency: public.business_catalog_items';
  end if;
  if to_regclass('public.products') is null then
    raise exception 'Missing dependency: public.products';
  end if;
  if to_regclass('public.clients') is null then
    raise exception 'Missing dependency: public.clients';
  end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;
  if to_regprocedure('public.adjust_product_stock(uuid,integer,text,text,text,uuid)') is null then
    raise exception 'Missing dependency: public.adjust_product_stock(uuid, integer, text, text, text, uuid)';
  end if;
end
$$;

create table if not exists public.business_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_number bigint not null,
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'completed',
  currency text not null default 'ARS',
  subtotal numeric(14, 2) not null,
  total numeric(14, 2) not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint business_sales_number_check check (sale_number > 0),
  constraint business_sales_status_check check (status in ('completed', 'voided')),
  constraint business_sales_currency_check check (currency = 'ARS'),
  constraint business_sales_amounts_check check (subtotal >= 0 and total >= 0)
);

create table if not exists public.business_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.business_sales(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null references public.business_catalog_items(id) on delete restrict,
  source_type text not null,
  product_name_snapshot text not null,
  sku_snapshot text,
  barcode_snapshot text,
  unit_price numeric(14, 2) not null,
  quantity integer not null,
  subtotal numeric(14, 2) not null,
  created_at timestamptz not null default now(),

  constraint business_sale_items_source_type_check check (source_type in ('manufactured', 'resale')),
  constraint business_sale_items_quantity_check check (quantity > 0),
  constraint business_sale_items_amounts_check check (unit_price >= 0 and subtotal >= 0)
);

create table if not exists public.business_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null references public.business_catalog_items(id) on delete restrict,
  sale_id uuid references public.business_sales(id) on delete restrict,
  movement_type text not null,
  quantity_delta integer not null,
  previous_quantity integer not null,
  new_quantity integer not null,
  reason text,
  reference text,
  operation_key uuid not null,
  created_at timestamptz not null default now(),

  constraint business_inventory_movements_type_check
    check (movement_type in ('sale', 'restock', 'manual_adjustment', 'return', 'transfer_to_workshop')),
  constraint business_inventory_movements_delta_check check (quantity_delta <> 0),
  constraint business_inventory_movements_quantities_check check (previous_quantity >= 0 and new_quantity >= 0),
  constraint business_inventory_movements_sale_link_check
    check ((movement_type = 'sale' and sale_id is not null) or movement_type <> 'sale')
);

comment on table public.business_sales is 'Immutable commercial sale headers created by confirm_business_sale.';
comment on table public.business_sale_items is 'Price and identity snapshots for each catalog item sold.';
comment on table public.business_inventory_movements is 'Traceable commercial unit movements for manufactured and resale catalog items.';
comment on column public.business_inventory_movements.operation_key is 'Idempotency key shared by every movement in one operation.';

create unique index if not exists business_sales_user_idempotency_uidx
  on public.business_sales (user_id, idempotency_key);
create unique index if not exists business_sales_user_number_uidx
  on public.business_sales (user_id, sale_number);
create unique index if not exists business_sale_items_sale_catalog_uidx
  on public.business_sale_items (sale_id, catalog_item_id);
create unique index if not exists business_inventory_movements_operation_item_uidx
  on public.business_inventory_movements (user_id, operation_key, catalog_item_id, movement_type);

create index if not exists business_sales_user_created_idx
  on public.business_sales (user_id, created_at desc);
create index if not exists business_sales_client_idx
  on public.business_sales (client_id, created_at desc) where client_id is not null;
create index if not exists business_sale_items_sale_idx
  on public.business_sale_items (sale_id);
create index if not exists business_inventory_movements_item_created_idx
  on public.business_inventory_movements (catalog_item_id, created_at desc);
create index if not exists business_inventory_movements_user_created_idx
  on public.business_inventory_movements (user_id, created_at desc);
create index if not exists business_inventory_movements_sale_idx
  on public.business_inventory_movements (sale_id) where sale_id is not null;

drop trigger if exists business_sales_set_updated_at on public.business_sales;
create trigger business_sales_set_updated_at
before update on public.business_sales
for each row execute function public.set_updated_at();

alter table public.business_sales enable row level security;
alter table public.business_sale_items enable row level security;
alter table public.business_inventory_movements enable row level security;

drop policy if exists business_sales_select_own on public.business_sales;
create policy business_sales_select_own on public.business_sales
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists business_sale_items_select_own on public.business_sale_items;
create policy business_sale_items_select_own on public.business_sale_items
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists business_inventory_movements_select_own on public.business_inventory_movements;
create policy business_inventory_movements_select_own on public.business_inventory_movements
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists business_sales_admin_all on public.business_sales;
create policy business_sales_admin_all on public.business_sales
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists business_sale_items_admin_all on public.business_sale_items;
create policy business_sale_items_admin_all on public.business_sale_items
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists business_inventory_movements_admin_all on public.business_inventory_movements;
create policy business_inventory_movements_admin_all on public.business_inventory_movements
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.business_sales from anon, authenticated;
revoke all on table public.business_sale_items from anon, authenticated;
revoke all on table public.business_inventory_movements from anon, authenticated;
grant select on table public.business_sales to authenticated;
grant select on table public.business_sale_items to authenticated;
grant select on table public.business_inventory_movements to authenticated;

create or replace function public.adjust_business_inventory(
  p_catalog_item_id uuid,
  p_quantity_delta integer,
  p_reason text,
  p_idempotency_key uuid
)
returns table (
  success boolean,
  catalog_item_id uuid,
  previous_quantity integer,
  new_quantity integer,
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
  catalog_item public.business_catalog_items%rowtype;
  source_product public.products%rowtype;
  existing_movement public.business_inventory_movements%rowtype;
  previous_stock integer;
  resulting_stock integer;
  movement_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if current_user_id is null then
    return query select false, p_catalog_item_id, null::integer, null::integer, false, 'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_catalog_item_id, null::integer, null::integer, false, 'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  if p_idempotency_key is null then
    return query select false, p_catalog_item_id, null::integer, null::integer, false, 'invalid_idempotency_key'::text, 'La operación no tiene una clave válida.'::text;
    return;
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 or abs(p_quantity_delta::bigint) > 100000 then
    return query select false, p_catalog_item_id, null::integer, null::integer, false, 'invalid_quantity'::text, 'Ingresá una cantidad válida distinta de cero.'::text;
    return;
  end if;
  if movement_reason is null then
    return query select false, p_catalog_item_id, null::integer, null::integer, false, 'invalid_reason'::text, 'Indicá el motivo del ajuste.'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('business-adjust:' || current_user_id::text || ':' || p_idempotency_key::text, 0));

  select movement.* into existing_movement
  from public.business_inventory_movements as movement
  where movement.user_id = current_user_id
    and movement.operation_key = p_idempotency_key
    and movement.catalog_item_id = p_catalog_item_id
    and movement.movement_type in ('restock', 'manual_adjustment')
  limit 1;

  if found then
    return query select true, existing_movement.catalog_item_id, existing_movement.previous_quantity,
      existing_movement.new_quantity, true, null::text, 'El ajuste ya había sido aplicado.'::text;
    return;
  end if;

  select item.* into catalog_item
  from public.business_catalog_items as item
  where item.id = p_catalog_item_id
    and item.user_id = current_user_id
    and item.is_active = true
  for update;

  if not found then
    return query select false, p_catalog_item_id, null::integer, null::integer, false, 'catalog_item_not_found'::text, 'El producto no existe, está inactivo o no te pertenece.'::text;
    return;
  end if;

  if catalog_item.source_type = 'manufactured' then
    select product.* into source_product
    from public.products as product
    where product.id = catalog_item.source_product_id
      and product.user_id = current_user_id
      and product.is_active = true
    for update;
    if not found then
      return query select false, catalog_item.id, null::integer, null::integer, false, 'source_product_not_found'::text, 'No se encontró el producto fabricado vinculado.'::text;
      return;
    end if;
    previous_stock := coalesce(source_product.stock_quantity, 0);
  else
    previous_stock := coalesce(catalog_item.resale_stock_quantity, 0);
  end if;

  if previous_stock::bigint + p_quantity_delta::bigint > 2147483647 then
    return query select false, catalog_item.id, previous_stock, previous_stock, false, 'stock_overflow'::text, 'El ajuste supera el máximo de stock permitido.'::text;
    return;
  end if;
  resulting_stock := previous_stock + p_quantity_delta;
  if resulting_stock < 0 then
    return query select false, catalog_item.id, previous_stock, previous_stock, false, 'insufficient_stock'::text, 'No hay stock suficiente para aplicar el ajuste.'::text;
    return;
  end if;

  if catalog_item.source_type = 'manufactured' then
    perform public.adjust_product_stock(
      p_product_id => catalog_item.source_product_id,
      p_quantity_delta => p_quantity_delta,
      p_movement_type => case when p_quantity_delta > 0 then 'manual_add' else 'manual_subtract' end,
      p_reason => coalesce(movement_reason, 'Ajuste manual desde Mi Negocio'),
      p_source_type => 'business_catalog_item',
      p_source_id => catalog_item.id
    );
    select coalesce(product.stock_quantity, 0) into resulting_stock
    from public.products as product
    where product.id = catalog_item.source_product_id;
    if resulting_stock is distinct from previous_stock + p_quantity_delta then
      raise exception 'adjust_product_stock no actualizó el stock esperado';
    end if;
  else
    update public.business_catalog_items as item
    set resale_stock_quantity = resulting_stock
    where item.id = catalog_item.id
      and item.user_id = current_user_id;
    if not found then
      raise exception 'No se pudo actualizar el inventario de reventa';
    end if;
  end if;

  insert into public.business_inventory_movements (
    user_id, catalog_item_id, sale_id, movement_type, quantity_delta,
    previous_quantity, new_quantity, reason, reference, operation_key
  ) values (
    current_user_id, catalog_item.id, null,
    case when p_quantity_delta > 0 then 'restock' else 'manual_adjustment' end,
    p_quantity_delta, previous_stock, resulting_stock,
    coalesce(movement_reason, 'Ajuste manual desde Mi Negocio'), null, p_idempotency_key
  );

  return query select true, catalog_item.id, previous_stock, resulting_stock, false,
    null::text, 'Inventario actualizado.'::text;
end;
$$;

create or replace function public.confirm_business_sale(
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
  existing_sale public.business_sales%rowtype;
  created_sale_id uuid;
  created_sale_number bigint;
  computed_total numeric(14, 2) := 0;
  requested_item record;
  catalog_item public.business_catalog_items%rowtype;
  source_product public.products%rowtype;
  previous_stock integer;
  resulting_stock integer;
  item_subtotal numeric(14, 2);
begin
  if current_user_id is null then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  if p_idempotency_key is null then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_idempotency_key'::text, 'La venta no tiene una clave válida.'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('business-sale:' || current_user_id::text || ':' || p_idempotency_key::text, 0));

  select sale.* into existing_sale
  from public.business_sales as sale
  where sale.user_id = current_user_id
    and sale.idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_sale.status = 'completed' then
      return query select true, existing_sale.id, existing_sale.sale_number, existing_sale.total,
        true, null::text, 'La venta ya había sido registrada.'::text;
    else
      return query select false, existing_sale.id, existing_sale.sale_number, existing_sale.total,
        true, 'sale_not_completed'::text, 'La clave ya pertenece a una venta no completada.'::text;
    end if;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_items'::text, 'El carrito debe contener entre 1 y 50 productos.'::text;
    return;
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_items'::text, 'El carrito debe contener entre 1 y 50 productos.'::text;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as element
    where jsonb_typeof(element) <> 'object'
      or coalesce(element ->> 'catalogItemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(element ->> 'quantity', '') !~ '^[1-9][0-9]{0,4}$'
  ) then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_items'::text, 'El carrito contiene productos o cantidades inválidas.'::text;
    return;
  end if;

  if p_client_id is not null and not exists (
    select 1 from public.clients as client
    where client.id = p_client_id and client.user_id = current_user_id
  ) then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'client_not_found'::text, 'El cliente no existe o no te pertenece.'::text;
    return;
  end if;

  -- Lock every catalog/source row in deterministic order and validate the whole
  -- cart before creating the sale. This prevents overselling under concurrency.
  for requested_item in
    select
      (element ->> 'catalogItemId')::uuid as catalog_item_id,
      sum((element ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as element
    group by (element ->> 'catalogItemId')::uuid
    order by (element ->> 'catalogItemId')::uuid
  loop
    if requested_item.quantity > 100000 then
      return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_quantity'::text, 'La cantidad solicitada es demasiado grande.'::text;
      return;
    end if;

    select item.* into catalog_item
    from public.business_catalog_items as item
    where item.id = requested_item.catalog_item_id
      and item.user_id = current_user_id
      and item.is_active = true
    for update;
    if not found then
      return query select false, null::uuid, null::bigint, null::numeric, false, 'catalog_item_not_found'::text, 'Un producto no existe, está inactivo o no te pertenece.'::text;
      return;
    end if;

    if catalog_item.source_type = 'manufactured' then
      select product.* into source_product
      from public.products as product
      where product.id = catalog_item.source_product_id
        and product.user_id = current_user_id
        and product.is_active = true
      for update;
      if not found then
        return query select false, null::uuid, null::bigint, null::numeric, false, 'source_product_not_found'::text, 'Un producto fabricado ya no está disponible.'::text;
        return;
      end if;
      previous_stock := coalesce(source_product.stock_quantity, 0);
    else
      previous_stock := coalesce(catalog_item.resale_stock_quantity, 0);
    end if;

    if previous_stock < requested_item.quantity then
      return query select false, null::uuid, null::bigint, null::numeric, false, 'insufficient_stock'::text,
        format('No hay stock suficiente de %s.', catalog_item.name)::text;
      return;
    end if;
    computed_total := computed_total + catalog_item.sale_price * requested_item.quantity;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('business-sale-number:' || current_user_id::text, 0));
  select coalesce(max(sale.sale_number), 0) + 1 into created_sale_number
  from public.business_sales as sale
  where sale.user_id = current_user_id;

  insert into public.business_sales (
    user_id, sale_number, client_id, status, currency, subtotal, total, idempotency_key
  ) values (
    current_user_id, created_sale_number, p_client_id, 'completed', 'ARS',
    computed_total, computed_total, p_idempotency_key
  ) returning id into created_sale_id;

  for requested_item in
    select
      (element ->> 'catalogItemId')::uuid as catalog_item_id,
      sum((element ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as element
    group by (element ->> 'catalogItemId')::uuid
    order by (element ->> 'catalogItemId')::uuid
  loop
    select item.* into catalog_item
    from public.business_catalog_items as item
    where item.id = requested_item.catalog_item_id;

    item_subtotal := catalog_item.sale_price * requested_item.quantity;
    insert into public.business_sale_items (
      sale_id, user_id, catalog_item_id, source_type, product_name_snapshot,
      sku_snapshot, barcode_snapshot, unit_price, quantity, subtotal
    ) values (
      created_sale_id, current_user_id, catalog_item.id, catalog_item.source_type,
      catalog_item.name, catalog_item.sku, catalog_item.barcode,
      catalog_item.sale_price, requested_item.quantity, item_subtotal
    );

    if catalog_item.source_type = 'manufactured' then
      select coalesce(product.stock_quantity, 0) into previous_stock
      from public.products as product
      where product.id = catalog_item.source_product_id;
      perform public.adjust_product_stock(
        p_product_id => catalog_item.source_product_id,
        p_quantity_delta => -requested_item.quantity,
        p_movement_type => 'manual_subtract',
        p_reason => format('Venta rápida N.º %s', created_sale_number),
        p_source_type => 'business_sale',
        p_source_id => created_sale_id
      );
      select coalesce(product.stock_quantity, 0) into resulting_stock
      from public.products as product
      where product.id = catalog_item.source_product_id;
      if resulting_stock is distinct from previous_stock - requested_item.quantity then
        raise exception 'adjust_product_stock no actualizó el stock esperado';
      end if;
    else
      previous_stock := coalesce(catalog_item.resale_stock_quantity, 0);
      resulting_stock := previous_stock - requested_item.quantity;
      update public.business_catalog_items as item
      set resale_stock_quantity = resulting_stock
      where item.id = catalog_item.id and item.user_id = current_user_id;
      if not found then
        raise exception 'No se pudo actualizar el inventario de reventa';
      end if;
    end if;

    insert into public.business_inventory_movements (
      user_id, catalog_item_id, sale_id, movement_type, quantity_delta,
      previous_quantity, new_quantity, reason, reference, operation_key
    ) values (
      current_user_id, catalog_item.id, created_sale_id, 'sale', -requested_item.quantity,
      previous_stock, resulting_stock, format('Venta rápida N.º %s', created_sale_number),
      'SALE-' || lpad(created_sale_number::text, 6, '0'), p_idempotency_key
    );
  end loop;

  return query select true, created_sale_id, created_sale_number, computed_total,
    false, null::text, 'Venta registrada correctamente.'::text;
end;
$$;

revoke all on function public.adjust_business_inventory(uuid, integer, text, uuid) from public, anon;
grant execute on function public.adjust_business_inventory(uuid, integer, text, uuid) to authenticated;
revoke all on function public.confirm_business_sale(uuid, jsonb, uuid) from public, anon;
grant execute on function public.confirm_business_sale(uuid, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
