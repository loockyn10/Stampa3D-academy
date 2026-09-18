-- Customer ledger (auditable current account), split sale payments (cash/transfer/debt)
-- and financial reversal on sale void.
-- Apply after 20260910140721_fix_business_sale_location_movements.sql.

do $business_customer_accounts_dependencies$
begin
  if to_regclass('public.clients') is null then raise exception 'Missing dependency: public.clients'; end if;
  if to_regclass('public.business_sales') is null then raise exception 'Missing dependency: public.business_sales'; end if;
  if to_regclass('public.business_sale_items') is null then raise exception 'Missing dependency: public.business_sale_items'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.confirm_business_sale(uuid,jsonb,uuid)') is null then raise exception 'Missing dependency: public.confirm_business_sale(uuid, jsonb, uuid)'; end if;
  if to_regprocedure('public.confirm_business_showroom_sale(uuid,jsonb,uuid)') is null then raise exception 'Missing dependency: public.confirm_business_showroom_sale(uuid, jsonb, uuid)'; end if;
  if to_regprocedure('public.void_business_sale(uuid,text)') is null then raise exception 'Missing dependency: public.void_business_sale(uuid, text)'; end if;
end;
$business_customer_accounts_dependencies$;

-- clients predates this migration history; is_active may already exist (Presupuestos form
-- already writes it). This is a safe no-op when the column is already there.
alter table public.clients add column if not exists is_active boolean not null default true;

-- The old 3-arg signatures must be dropped (not just replaced): adding a 4th
-- parameter with a default creates a distinct overload in Postgres, and
-- leaving the 3-arg one in place would make a plain 3-arg call ambiguous
-- between "the old function" and "the new one using its default".
drop function if exists public.confirm_business_sale(uuid, jsonb, uuid);
drop function if exists public.confirm_business_showroom_sale(uuid, jsonb, uuid);

create table if not exists public.customer_account_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  movement_type text not null,
  delta numeric(14, 2) not null,
  sale_id uuid references public.business_sales(id) on delete restrict,
  method text,
  note text,
  reference text,
  created_at timestamptz not null default now(),

  constraint customer_account_movements_type_check
    check (movement_type in ('sale_debt', 'payment', 'sale_reversal', 'adjustment')),
  constraint customer_account_movements_delta_check check (delta <> 0),
  constraint customer_account_movements_method_check check (method is null or method in ('cash', 'transfer')),
  constraint customer_account_movements_sale_link_check
    check ((movement_type in ('sale_debt', 'sale_reversal') and sale_id is not null) or movement_type not in ('sale_debt', 'sale_reversal'))
);

comment on table public.customer_account_movements is
  'Auditable customer current-account ledger. balance = sum(delta). Positive delta increases debt (sale_debt); negative reduces it (payment, sale_reversal).';

-- At most one sale_debt and at most one sale_reversal per sale: guarantees void_business_sale
-- cannot double-reverse the same sale, without any extra application-side locking.
create unique index if not exists customer_account_movements_sale_type_uidx
  on public.customer_account_movements (sale_id, movement_type)
  where movement_type in ('sale_debt', 'sale_reversal');

create index if not exists customer_account_movements_client_created_idx
  on public.customer_account_movements (user_id, client_id, created_at desc);

create table if not exists public.business_sale_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.business_sales(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null check (method in ('cash', 'transfer')),
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

comment on table public.business_sale_payment_allocations is
  'Immediate payment lines (cash/transfer) captured at sale time by confirm_business_sale. Any remainder becomes a sale_debt ledger movement instead of an allocation row.';

create index if not exists business_sale_payment_allocations_sale_idx
  on public.business_sale_payment_allocations (sale_id);
create index if not exists business_sale_payment_allocations_user_created_idx
  on public.business_sale_payment_allocations (user_id, created_at desc);

alter table public.customer_account_movements enable row level security;
alter table public.business_sale_payment_allocations enable row level security;

drop policy if exists customer_account_movements_select_own on public.customer_account_movements;
create policy customer_account_movements_select_own on public.customer_account_movements
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists customer_account_movements_admin_all on public.customer_account_movements;
create policy customer_account_movements_admin_all on public.customer_account_movements
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists business_sale_payment_allocations_select_own on public.business_sale_payment_allocations;
create policy business_sale_payment_allocations_select_own on public.business_sale_payment_allocations
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists business_sale_payment_allocations_admin_all on public.business_sale_payment_allocations;
create policy business_sale_payment_allocations_admin_all on public.business_sale_payment_allocations
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- No insert/update policies: every write goes through the security-definer RPCs below,
-- exactly like business_sales/business_sale_items.
revoke all on table public.customer_account_movements from anon, authenticated;
revoke all on table public.business_sale_payment_allocations from anon, authenticated;
grant select on table public.customer_account_movements to authenticated;
grant select on table public.business_sale_payment_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_business_sale: adds p_payments (default null = full cash, preserves
-- the historical no-debt behavior for any caller that does not send it yet).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_business_sale(
  p_idempotency_key uuid,
  p_items jsonb,
  p_client_id uuid default null,
  p_payments jsonb default null
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
  payments_array jsonb;
  payment_element jsonb;
  payment_method text;
  payment_amount numeric(14, 2);
  sum_payments numeric(14, 2) := 0;
  debt_amount numeric(14, 2) := 0;
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

  -- Payment split: null means "full cash" (compat with callers that predate
  -- this parameter). An explicit empty array means "no immediate payment,
  -- the whole total becomes debt" and is valid. Debt is always derived, never
  -- sent as its own allocation.
  payments_array := coalesce(p_payments, jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', computed_total)));

  if jsonb_typeof(payments_array) <> 'array' or jsonb_array_length(payments_array) > 5 then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_payment'::text, 'El desglose de pago no es válido.'::text;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payments_array) as element
    where jsonb_typeof(element) <> 'object'
      or coalesce(element ->> 'method', '') not in ('cash', 'transfer')
      or coalesce(element ->> 'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      or (element ->> 'amount')::numeric <= 0
  ) then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'invalid_payment'::text, 'El desglose de pago contiene montos o métodos inválidos.'::text;
    return;
  end if;

  select round(coalesce(sum((element ->> 'amount')::numeric), 0), 2) into sum_payments
  from jsonb_array_elements(payments_array) as element;

  if sum_payments > computed_total then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'overpayment'::text, 'El pago inmediato no puede superar el total de la venta.'::text;
    return;
  end if;

  debt_amount := round(computed_total - sum_payments, 2);
  if debt_amount > 0 and p_client_id is null then
    return query select false, null::uuid, null::bigint, null::numeric, false, 'client_required'::text, 'Para vender con saldo pendiente necesitás seleccionar un cliente.'::text;
    return;
  end if;

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

  for payment_element in select * from jsonb_array_elements(payments_array)
  loop
    payment_method := payment_element ->> 'method';
    payment_amount := round((payment_element ->> 'amount')::numeric, 2);
    if payment_amount > 0 then
      insert into public.business_sale_payment_allocations (
        sale_id, user_id, method, amount
      ) values (
        created_sale_id, current_user_id, payment_method, payment_amount
      );
    end if;
  end loop;

  if debt_amount > 0 then
    insert into public.customer_account_movements (
      user_id, client_id, movement_type, delta, sale_id, reference
    ) values (
      current_user_id, p_client_id, 'sale_debt', debt_amount, created_sale_id,
      'SALE-' || lpad(created_sale_number::text, 6, '0')
    );
  end if;

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

-- ---------------------------------------------------------------------------
-- confirm_business_showroom_sale: threads p_payments through to the 3 internal
-- calls to confirm_business_sale (idempotency replay, locations-disabled
-- fallback, and the authoritative sale creation call).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_business_showroom_sale(
  p_idempotency_key uuid,
  p_items jsonb,
  p_client_id uuid default null,
  p_payments jsonb default null
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
    from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id, p_payments);
    return;
  end if;

  if not exists (
    select 1
    from public.business_inventory_location_settings settings
    where settings.user_id = current_user_id
      and settings.locations_enabled
  ) then
    return query select *
    from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id, p_payments);
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
  from public.confirm_business_sale(p_idempotency_key, p_items, p_client_id, p_payments);
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

-- ---------------------------------------------------------------------------
-- void_business_sale: same restoration logic as
-- 20260910140721_fix_business_sale_location_movements.sql, plus a compensating
-- sale_reversal ledger movement when the voided sale generated debt. Guarded
-- by the (sale_id, movement_type) unique index above, so a repeated void call
-- (blocked earlier by the already_voided check) can never double-reverse.
-- ---------------------------------------------------------------------------
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
  original_debt_delta numeric(14, 2);
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

  -- Reverse the financial effect of the sale, if any: at most one sale_debt
  -- movement can exist per sale (unique index above), so this reads it once
  -- and compensates it once. Original ledger rows are never deleted.
  select movement.delta into original_debt_delta
  from public.customer_account_movements movement
  where movement.sale_id = target_sale.id
    and movement.movement_type = 'sale_debt'
    and movement.user_id = current_user_id
  limit 1;

  if original_debt_delta is not null and not exists (
    select 1
    from public.customer_account_movements movement
    where movement.sale_id = target_sale.id
      and movement.movement_type = 'sale_reversal'
      and movement.user_id = current_user_id
  ) then
    insert into public.customer_account_movements (
      user_id, client_id, movement_type, delta, sale_id, reference
    ) values (
      current_user_id, target_sale.client_id, 'sale_reversal', -original_debt_delta, target_sale.id,
      'VOID-SALE-' || lpad(target_sale.sale_number::text, 6, '0')
    );
  end if;

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

-- ---------------------------------------------------------------------------
-- register_customer_payment: posts a payment movement against a client's
-- current account. Rejects overpayment (no partial adjustment, no silent cap).
-- ---------------------------------------------------------------------------
create or replace function public.register_customer_payment(
  p_client_id uuid,
  p_amount numeric,
  p_method text,
  p_note text default null
)
returns table (
  success boolean,
  movement_id uuid,
  new_balance numeric,
  error_code text,
  message text
)
language plpgsql
security definer
set search_path = public
as $register_customer_payment$
declare
  current_user_id uuid := auth.uid();
  current_balance numeric(14, 2) := 0;
  normalized_amount numeric(14, 2);
  normalized_note text := nullif(btrim(coalesce(p_note, '')), '');
  created_movement_id uuid;
begin
  if current_user_id is null then
    return query select false, null::uuid, null::numeric, 'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, null::uuid, null::numeric, 'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  if p_client_id is null then
    return query select false, null::uuid, null::numeric, 'invalid_request'::text, 'El cliente no es válido.'::text;
    return;
  end if;
  if p_method not in ('cash', 'transfer') then
    return query select false, null::uuid, null::numeric, 'invalid_request'::text, 'El método de cobro no es válido.'::text;
    return;
  end if;
  normalized_amount := round(coalesce(p_amount, 0), 2);
  if normalized_amount <= 0 then
    return query select false, null::uuid, null::numeric, 'invalid_amount'::text, 'Ingresá un monto mayor a cero.'::text;
    return;
  end if;
  if normalized_note is not null and length(normalized_note) > 300 then
    return query select false, null::uuid, null::numeric, 'invalid_request'::text, 'La nota es demasiado larga.'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer-payment:' || current_user_id::text || ':' || p_client_id::text, 0));

  perform 1
  from public.clients client
  where client.id = p_client_id and client.user_id = current_user_id
  for update;
  if not found then
    return query select false, null::uuid, null::numeric, 'client_not_found'::text, 'El cliente no existe o no te pertenece.'::text;
    return;
  end if;

  select coalesce(sum(movement.delta), 0) into current_balance
  from public.customer_account_movements movement
  where movement.client_id = p_client_id
    and movement.user_id = current_user_id;

  if normalized_amount > current_balance then
    return query select false, null::uuid, current_balance, 'overpayment'::text,
      'El cobro no puede superar el saldo pendiente del cliente.'::text;
    return;
  end if;

  insert into public.customer_account_movements (
    user_id, client_id, movement_type, delta, method, note
  ) values (
    current_user_id, p_client_id, 'payment', -normalized_amount, p_method, normalized_note
  ) returning id into created_movement_id;

  return query select true, created_movement_id, current_balance - normalized_amount, null::text,
    'Cobro registrado correctamente.'::text;
end;
$register_customer_payment$;

-- ---------------------------------------------------------------------------
-- get_business_clients_overview: listing for Mi Negocio > Clientes (name,
-- phone, email, last purchase, historical total, pending balance) in one
-- round trip, filtered and searched server-side.
-- ---------------------------------------------------------------------------
create or replace function public.get_business_clients_overview(p_search text default null)
returns table (
  client_id uuid,
  name text,
  phone text,
  email text,
  last_sale_at timestamptz,
  total_purchased numeric,
  balance numeric
)
language plpgsql
security definer
stable
set search_path = public
as $get_business_clients_overview$
declare
  current_user_id uuid := auth.uid();
  search_term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if current_user_id is null or public.has_platform_access(current_user_id) is distinct from true then
    return;
  end if;

  return query
  select
    client.id,
    client.name,
    client.phone,
    client.email,
    sales_agg.last_sale_at,
    coalesce(sales_agg.total_purchased, 0),
    coalesce(ledger_agg.balance, 0)
  from public.clients client
  left join (
    select sale.client_id, max(sale.created_at) as last_sale_at, sum(sale.total) as total_purchased
    from public.business_sales sale
    where sale.user_id = current_user_id and sale.status = 'completed'
    group by sale.client_id
  ) sales_agg on sales_agg.client_id = client.id
  left join (
    select movement.client_id, sum(movement.delta) as balance
    from public.customer_account_movements movement
    where movement.user_id = current_user_id
    group by movement.client_id
  ) ledger_agg on ledger_agg.client_id = client.id
  where client.user_id = current_user_id
    and coalesce(client.is_active, true) = true
    and (
      search_term is null
      or client.name ilike '%' || search_term || '%'
      or client.phone ilike '%' || search_term || '%'
      or client.email ilike '%' || search_term || '%'
    )
  order by client.name asc;
end;
$get_business_clients_overview$;

-- ---------------------------------------------------------------------------
-- get_business_metrics: same computation as
-- 20260910053553_business_polish.sql, plus cash-flow fields that distinguish
-- sale value from money actually collected (cashReceived, transferReceived,
-- newCredit, debtCollections) and the current total receivable
-- (outstandingReceivables, not period-scoped).
-- ---------------------------------------------------------------------------
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
  cash_received numeric := 0;
  transfer_received numeric := 0;
  new_credit numeric := 0;
  debt_collections numeric := 0;
  outstanding_receivables numeric := 0;
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

  select coalesce(sum(allocation.amount) filter (where allocation.method = 'cash'), 0),
    coalesce(sum(allocation.amount) filter (where allocation.method = 'transfer'), 0)
  into cash_received, transfer_received
  from public.business_sale_payment_allocations allocation
  join public.business_sales sale on sale.id = allocation.sale_id and sale.user_id = allocation.user_id
  where allocation.user_id = current_user_id
    and sale.status = 'completed'
    and allocation.created_at >= period_start and allocation.created_at < period_end;

  select coalesce(sum(movement.delta) filter (where movement.movement_type = 'sale_debt'), 0),
    coalesce(sum(-movement.delta) filter (where movement.movement_type = 'payment'), 0)
  into new_credit, debt_collections
  from public.customer_account_movements movement
  where movement.user_id = current_user_id
    and movement.created_at >= period_start and movement.created_at < period_end;

  select coalesce(sum(movement.delta), 0) into outstanding_receivables
  from public.customer_account_movements movement
  where movement.user_id = current_user_id;

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
    'topProducts', top_products,
    'cashReceived', cash_received,
    'transferReceived', transfer_received,
    'newCredit', new_credit,
    'debtCollections', debt_collections,
    'outstandingReceivables', outstanding_receivables
  );
end;
$business_metrics$;

revoke all on function public.confirm_business_sale(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.confirm_business_sale(uuid, jsonb, uuid, jsonb) to authenticated;
revoke all on function public.confirm_business_showroom_sale(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.confirm_business_showroom_sale(uuid, jsonb, uuid, jsonb) to authenticated;
revoke all on function public.void_business_sale(uuid, text) from public, anon;
grant execute on function public.void_business_sale(uuid, text) to authenticated;
revoke all on function public.register_customer_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.register_customer_payment(uuid, numeric, text, text) to authenticated;
revoke all on function public.get_business_clients_overview(text) from public, anon;
grant execute on function public.get_business_clients_overview(text) to authenticated;
revoke all on function public.get_business_metrics(text) from public, anon;
grant execute on function public.get_business_metrics(text) to authenticated;

notify pgrst, 'reload schema';
