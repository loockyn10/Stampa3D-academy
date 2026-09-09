-- Extensible catalog barcodes and atomic, idempotent stock receipts by scan.
-- Apply after 20260909022450_fix_missing_business_location_balances.sql.

do $$
begin
  if to_regclass('public.business_catalog_items') is null then raise exception 'Missing dependency: public.business_catalog_items'; end if;
  if to_regclass('public.business_inventory_movements') is null then raise exception 'Missing dependency: public.business_inventory_movements'; end if;
  if to_regclass('public.business_inventory_policies') is null then raise exception 'Missing dependency: public.business_inventory_policies'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.set_updated_at()') is null then raise exception 'Missing dependency: public.set_updated_at()'; end if;
  if to_regprocedure('public.apply_business_location_stock_delta(uuid,integer)') is null then raise exception 'Missing dependency: public.apply_business_location_stock_delta(uuid, integer)'; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'business_catalog_items_user_id_uidx'
  ) then
    raise exception 'Missing dependency: unique index public.business_catalog_items_user_id_uidx';
  end if;
end
$$;

create table if not exists public.business_catalog_barcodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null,
  barcode text not null,
  barcode_type text not null,
  units_per_scan integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint business_catalog_barcodes_owner_item_fkey
    foreign key (user_id, catalog_item_id)
    references public.business_catalog_items(user_id, id)
    on delete cascade,
  constraint business_catalog_barcodes_type_check
    check (barcode_type in ('unit', 'case')),
  constraint business_catalog_barcodes_units_check
    check (
      (barcode_type = 'unit' and units_per_scan = 1)
      or (barcode_type = 'case' and units_per_scan between 2 and 100000)
    ),
  constraint business_catalog_barcodes_value_check
    check (char_length(btrim(barcode)) between 1 and 120)
);

create unique index if not exists business_catalog_barcodes_user_value_uidx
  on public.business_catalog_barcodes (user_id, lower(btrim(barcode)));
create unique index if not exists business_catalog_barcodes_item_type_uidx
  on public.business_catalog_barcodes (catalog_item_id, barcode_type);
create index if not exists business_catalog_barcodes_user_item_idx
  on public.business_catalog_barcodes (user_id, catalog_item_id);

insert into public.business_catalog_barcodes (
  user_id, catalog_item_id, barcode, barcode_type, units_per_scan
)
select item.user_id, item.id, btrim(item.barcode), 'unit', 1
from public.business_catalog_items item
where nullif(btrim(coalesce(item.barcode, '')), '') is not null
on conflict (catalog_item_id, barcode_type) do update
set barcode = excluded.barcode,
    units_per_scan = 1,
    updated_at = now();

create or replace function public.validate_business_catalog_barcode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  new.barcode := btrim(new.barcode);
  if new.barcode = '' or char_length(new.barcode) > 120 then
    raise exception using errcode = '22023', message = 'El código de barras no es válido.';
  end if;
  if new.barcode_type = 'unit' then new.units_per_scan := 1; end if;

  select item.user_id into owner_id
  from public.business_catalog_items item
  where item.id = new.catalog_item_id;
  if owner_id is null or owner_id <> new.user_id then
    raise exception using errcode = '42501', message = 'El producto no pertenece al usuario indicado.';
  end if;

  if exists (
    select 1
    from public.business_catalog_items item
    where item.user_id = new.user_id
      and lower(btrim(coalesce(item.barcode, ''))) = lower(new.barcode)
      and not (item.id = new.catalog_item_id and new.barcode_type = 'unit')
  ) then
    raise exception using errcode = '23505', message = 'Ese código ya identifica otro producto o presentación.';
  end if;

  return new;
end;
$$;

drop trigger if exists business_catalog_barcodes_validate on public.business_catalog_barcodes;
create trigger business_catalog_barcodes_validate
before insert or update on public.business_catalog_barcodes
for each row execute function public.validate_business_catalog_barcode();

create or replace function public.sync_business_catalog_unit_barcode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.barcode, '')), '') is null then
    delete from public.business_catalog_barcodes barcode
    where barcode.catalog_item_id = new.id
      and barcode.user_id = new.user_id
      and barcode.barcode_type = 'unit';
  else
    insert into public.business_catalog_barcodes (
      user_id, catalog_item_id, barcode, barcode_type, units_per_scan
    ) values (
      new.user_id, new.id, btrim(new.barcode), 'unit', 1
    )
    on conflict (catalog_item_id, barcode_type) do update
    set barcode = excluded.barcode,
        units_per_scan = 1,
        updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists business_catalog_items_sync_unit_barcode on public.business_catalog_items;
create trigger business_catalog_items_sync_unit_barcode
after insert or update of barcode on public.business_catalog_items
for each row execute function public.sync_business_catalog_unit_barcode();

drop trigger if exists business_catalog_barcodes_set_updated_at on public.business_catalog_barcodes;
create trigger business_catalog_barcodes_set_updated_at
before update on public.business_catalog_barcodes
for each row execute function public.set_updated_at();

alter table public.business_catalog_barcodes enable row level security;

drop policy if exists business_catalog_barcodes_select_own on public.business_catalog_barcodes;
create policy business_catalog_barcodes_select_own
on public.business_catalog_barcodes for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists business_catalog_barcodes_admin_all on public.business_catalog_barcodes;
create policy business_catalog_barcodes_admin_all
on public.business_catalog_barcodes for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.business_catalog_barcodes from anon, authenticated;
grant select on table public.business_catalog_barcodes to authenticated;

create or replace function public.save_business_catalog_barcodes(
  p_catalog_item_id uuid,
  p_unit_barcode text,
  p_case_barcode text,
  p_case_units_per_scan integer
)
returns table (
  success boolean,
  catalog_item_id uuid,
  unit_barcode text,
  case_barcode text,
  case_units_per_scan integer,
  error_code text,
  message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_unit text := nullif(btrim(coalesce(p_unit_barcode, '')), '');
  normalized_case text := nullif(btrim(coalesce(p_case_barcode, '')), '');
begin
  if current_user_id is null then
    return query select false, p_catalog_item_id, null::text, null::text, null::integer,
      'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_catalog_item_id, null::text, null::text, null::integer,
      'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  if normalized_unit is not null and char_length(normalized_unit) > 120 then
    return query select false, p_catalog_item_id, null::text, null::text, null::integer,
      'invalid_unit_barcode'::text, 'El código unitario no es válido.'::text;
    return;
  end if;
  if normalized_case is not null and (
    char_length(normalized_case) > 120
    or p_case_units_per_scan is null
    or p_case_units_per_scan not between 2 and 100000
  ) then
    return query select false, p_catalog_item_id, null::text, null::text, null::integer,
      'invalid_case_barcode'::text, 'Indicá un código de caja y al menos 2 unidades por caja.'::text;
    return;
  end if;
  if normalized_unit is not null and normalized_case is not null
    and lower(normalized_unit) = lower(normalized_case) then
    return query select false, p_catalog_item_id, null::text, null::text, null::integer,
      'duplicate_barcode'::text, 'El código unitario y el de caja deben ser diferentes.'::text;
    return;
  end if;

  perform 1
  from public.business_catalog_items item
  where item.id = p_catalog_item_id
    and item.user_id = current_user_id
    and item.is_active
  for update;
  if not found then
    return query select false, p_catalog_item_id, null::text, null::text, null::integer,
      'catalog_item_not_found'::text, 'El producto no existe, está archivado o no te pertenece.'::text;
    return;
  end if;

  update public.business_catalog_items item
  set barcode = normalized_unit
  where item.id = p_catalog_item_id
    and item.user_id = current_user_id;

  if normalized_case is null then
    delete from public.business_catalog_barcodes barcode
    where barcode.catalog_item_id = p_catalog_item_id
      and barcode.user_id = current_user_id
      and barcode.barcode_type = 'case';
  else
    insert into public.business_catalog_barcodes (
      user_id, catalog_item_id, barcode, barcode_type, units_per_scan
    ) values (
      current_user_id, p_catalog_item_id, normalized_case, 'case', p_case_units_per_scan
    )
    on conflict (catalog_item_id, barcode_type) do update
    set barcode = excluded.barcode,
        units_per_scan = excluded.units_per_scan,
        updated_at = now();
  end if;

  return query
  select true, p_catalog_item_id, normalized_unit, normalized_case,
    case when normalized_case is null then null else p_case_units_per_scan end,
    null::text, 'Códigos actualizados.'::text;
end;
$$;

create or replace function public.confirm_business_stock_receipt(
  p_operation_key uuid,
  p_scans jsonb
)
returns table (
  success boolean,
  operation_key uuid,
  total_units integer,
  product_count integer,
  replayed boolean,
  error_code text,
  message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested record;
  catalog_item public.business_catalog_items%rowtype;
  previous_stock integer;
  resulting_stock integer;
  replay_units bigint;
  replay_products integer;
  receipt_units bigint := 0;
  receipt_products integer := 0;
begin
  if current_user_id is null then
    return query select false, p_operation_key, 0, 0, false,
      'unauthenticated'::text, 'Necesitás iniciar sesión.'::text;
    return;
  end if;
  if public.has_platform_access(current_user_id) is distinct from true then
    return query select false, p_operation_key, 0, 0, false,
      'forbidden'::text, 'No tenés acceso a esta operación.'::text;
    return;
  end if;
  if p_operation_key is null or p_scans is null
    or jsonb_typeof(p_scans) <> 'array'
    or jsonb_array_length(p_scans) not between 1 and 100
    or exists (
      select 1 from jsonb_array_elements(p_scans) scan
      where jsonb_typeof(scan) <> 'object'
        or char_length(btrim(coalesce(scan ->> 'barcode', ''))) not between 1 and 120
        or coalesce(scan ->> 'scanCount', '') !~ '^[1-9][0-9]{0,4}$'
    ) then
    return query select false, p_operation_key, 0, 0, false,
      'invalid_scans'::text, 'El ingreso contiene códigos o cantidades inválidas.'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'business-stock-receipt:' || current_user_id::text,
    0
  ));

  select coalesce(sum(movement.quantity_delta), 0)::bigint, count(*)::integer
  into replay_units, replay_products
  from public.business_inventory_movements movement
  where movement.user_id = current_user_id
    and movement.operation_key = p_operation_key
    and movement.movement_type = 'restock'
    and movement.reference = 'barcode_stock_receipt';
  if replay_products > 0 then
    return query select true, p_operation_key, replay_units::integer, replay_products, true,
      null::text, 'El ingreso ya había sido aplicado.'::text;
    return;
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(scan ->> 'barcode')) barcode
      from jsonb_array_elements(p_scans) scan
      group by lower(btrim(scan ->> 'barcode'))
    ) requested_scan
    left join public.business_catalog_barcodes barcode
      on barcode.user_id = current_user_id
      and lower(btrim(barcode.barcode)) = requested_scan.barcode
    where barcode.id is null
  ) then
    return query select false, p_operation_key, 0, 0, false,
      'barcode_not_found'::text, 'Uno de los códigos no está asignado a tu catálogo.'::text;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_scans) scan
    join public.business_catalog_barcodes barcode
      on barcode.user_id = current_user_id
      and lower(btrim(barcode.barcode)) = lower(btrim(scan ->> 'barcode'))
    join public.business_catalog_items item on item.id = barcode.catalog_item_id
    where item.is_active is distinct from true
  ) then
    return query select false, p_operation_key, 0, 0, false,
      'catalog_item_archived'::text, 'Uno de los códigos pertenece a un producto archivado.'::text;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_scans) scan
    join public.business_catalog_barcodes barcode
      on barcode.user_id = current_user_id
      and lower(btrim(barcode.barcode)) = lower(btrim(scan ->> 'barcode'))
    join public.business_catalog_items item on item.id = barcode.catalog_item_id
    where item.source_type <> 'resale'
  ) then
    return query select false, p_operation_key, 0, 0, false,
      'manufactured_not_supported'::text, 'Los productos fabricados se ingresan desde Mi Taller.'::text;
    return;
  end if;

  perform 1
  from public.business_catalog_barcodes barcode
  where barcode.user_id = current_user_id
    and lower(btrim(barcode.barcode)) in (
      select lower(btrim(scan ->> 'barcode'))
      from jsonb_array_elements(p_scans) scan
    )
  order by barcode.id
  for share;

  perform 1
  from public.business_catalog_items item
  where item.user_id = current_user_id
    and item.id in (
      select barcode.catalog_item_id
      from public.business_catalog_barcodes barcode
      where barcode.user_id = current_user_id
        and lower(btrim(barcode.barcode)) in (
          select lower(btrim(scan ->> 'barcode'))
          from jsonb_array_elements(p_scans) scan
        )
    )
  order by item.id
  for update;

  if exists (
    select 1
    from (
      select
        barcode.catalog_item_id,
        sum((scan ->> 'scanCount')::bigint * barcode.units_per_scan::bigint)::bigint quantity
      from jsonb_array_elements(p_scans) scan
      join public.business_catalog_barcodes barcode
        on barcode.user_id = current_user_id
        and lower(btrim(barcode.barcode)) = lower(btrim(scan ->> 'barcode'))
      group by barcode.catalog_item_id
    ) requested_item
    join public.business_catalog_items item on item.id = requested_item.catalog_item_id
    where requested_item.quantity not between 1 and 100000
      or coalesce(item.resale_stock_quantity, 0)::bigint + requested_item.quantity > 2147483647
  ) then
    return query select false, p_operation_key, 0, 0, false,
      'invalid_quantity'::text, 'La cantidad o el stock resultante de un producto está fuera del rango permitido.'::text;
    return;
  end if;

  for requested in
    select
      barcode.catalog_item_id,
      sum((scan ->> 'scanCount')::bigint * barcode.units_per_scan::bigint)::bigint quantity
    from jsonb_array_elements(p_scans) scan
    join public.business_catalog_barcodes barcode
      on barcode.user_id = current_user_id
      and lower(btrim(barcode.barcode)) = lower(btrim(scan ->> 'barcode'))
    group by barcode.catalog_item_id
    order by barcode.catalog_item_id
  loop
    select item.* into catalog_item
    from public.business_catalog_items item
    where item.id = requested.catalog_item_id
      and item.user_id = current_user_id
      and item.is_active
      and item.source_type = 'resale';
    if not found then
      raise exception 'Catalog item changed while confirming stock receipt';
    end if;

    previous_stock := coalesce(catalog_item.resale_stock_quantity, 0);
    resulting_stock := previous_stock + requested.quantity::integer;

    update public.business_catalog_items item
    set resale_stock_quantity = resulting_stock
    where item.id = catalog_item.id
      and item.user_id = current_user_id;
    if not found then raise exception 'Stock receipt update failed'; end if;

    insert into public.business_inventory_movements (
      user_id, catalog_item_id, sale_id, movement_type, quantity_delta,
      previous_quantity, new_quantity, reason, reference, operation_key
    ) values (
      current_user_id, catalog_item.id, null, 'restock', requested.quantity::integer,
      previous_stock, resulting_stock, 'Ingreso de mercadería por escáner',
      'barcode_stock_receipt', p_operation_key
    );

    receipt_units := receipt_units + requested.quantity;
    receipt_products := receipt_products + 1;
  end loop;

  return query select true, p_operation_key, receipt_units::integer, receipt_products, false,
    null::text, 'Ingreso de stock confirmado.'::text;
end;
$$;

revoke all on function public.validate_business_catalog_barcode() from public, anon, authenticated;
revoke all on function public.sync_business_catalog_unit_barcode() from public, anon, authenticated;
revoke all on function public.save_business_catalog_barcodes(uuid, text, text, integer) from public, anon;
grant execute on function public.save_business_catalog_barcodes(uuid, text, text, integer) to authenticated;
revoke all on function public.confirm_business_stock_receipt(uuid, jsonb) from public, anon;
grant execute on function public.confirm_business_stock_receipt(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
