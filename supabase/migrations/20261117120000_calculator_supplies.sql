-- Calculadora V2 — costos detallados.
-- 1) Catálogo PERSONAL de insumos (public.calculator_supplies): nombre, categoría (componente / embalaje),
--    unidad de medida y costo unitario. Cada usuario ve y edita solo los suyos.
-- 2) Componentes por tipo de producto (public.calculator_product_type_supplies): qué insumos y en qué cantidad
--    usa cada tipo de producto PROPIO del usuario (calculator_product_types ya es por usuario).
--
-- Aditiva: no modifica tablas ni filas existentes. Sin filas nuevas, la calculadora calcula exactamente igual.
-- Los precios NO se copian a las asociaciones: el costo se lee siempre del catálogo, así que cambiar un insumo
-- actualiza todos los cálculos futuros. Los productos guardados conservan su snapshot (calculation_snapshot).
-- Apply after 20261116120000_discount_seats_confirmed_only.sql.

do $calculator_supplies_dependencies$
begin
  if to_regclass('auth.users') is null then raise exception 'Missing dependency: auth.users'; end if;
  if to_regclass('public.calculator_product_types') is null then raise exception 'Missing dependency: public.calculator_product_types'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
end;
$calculator_supplies_dependencies$;

-- Dimensión física de cada unidad. Solo se pueden convertir cantidades dentro de la misma dimensión
-- (100 g de un insumo cargado por kg = 0,1 kg). 'custom' (unidad personalizada) solo se combina consigo misma.
create or replace function public.calculator_unit_dimension(p_unit text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case p_unit
    when 'unit' then 'count'
    when 'm' then 'length'
    when 'cm' then 'length'
    when 'kg' then 'mass'
    when 'g' then 'mass'
    when 'l' then 'volume'
    when 'ml' then 'volume'
    when 'custom' then 'custom'
    else null
  end
$fn$;

create table if not exists public.calculator_supplies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  -- Unicidad sin distinguir mayúsculas ni espacios repetidos.
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  category text not null default 'component',
  unit text not null default 'unit',
  custom_unit_label text,
  -- 4 decimales: admite costos por gramo/centímetro sin errores de redondeo binario (numeric, no float).
  unit_cost numeric(14, 4) not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calculator_supplies_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint calculator_supplies_category_check check (category in ('component', 'packaging')),
  constraint calculator_supplies_unit_check check (calculator_unit_dimension(unit) is not null),
  constraint calculator_supplies_custom_unit_check check (
    (unit = 'custom' and custom_unit_label is not null and char_length(btrim(custom_unit_label)) between 1 and 20)
    or (unit <> 'custom' and custom_unit_label is null)
  ),
  constraint calculator_supplies_unit_cost_check check (unit_cost >= 0 and unit_cost <= 1000000000),
  -- Destino de la FK compuesta de las asociaciones: asociación e insumo siempre del mismo dueño.
  constraint calculator_supplies_id_user_key unique (id, user_id)
);

-- Sin duplicados entre los insumos activos de un usuario; un archivado puede compartir nombre con uno nuevo.
create unique index if not exists calculator_supplies_active_name_idx
  on public.calculator_supplies (user_id, name_key)
  where archived_at is null;
create index if not exists calculator_supplies_user_idx on public.calculator_supplies (user_id, archived_at);

create table if not exists public.calculator_product_type_supplies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_type_id uuid not null references public.calculator_product_types(id) on delete cascade,
  supply_id uuid not null,
  quantity numeric(14, 4) not null,
  -- Unidad en la que el usuario expresó la cantidad (p. ej. 'g' para un insumo cargado por 'kg').
  quantity_unit text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calculator_product_type_supplies_quantity_check check (quantity > 0 and quantity <= 1000000),
  constraint calculator_product_type_supplies_unit_check check (calculator_unit_dimension(quantity_unit) is not null),
  -- Un insumo aparece una sola vez por tipo: se edita la cantidad, no se duplica la fila.
  constraint calculator_product_type_supplies_unique unique (product_type_id, supply_id),
  -- Un insumo en uso no se puede borrar (se archiva o se quita antes de los tipos).
  constraint calculator_product_type_supplies_supply_owner_fkey
    foreign key (supply_id, user_id) references public.calculator_supplies (id, user_id) on delete restrict
);

create index if not exists calculator_product_type_supplies_user_type_idx
  on public.calculator_product_type_supplies (user_id, product_type_id, sort_order);
create index if not exists calculator_product_type_supplies_supply_idx
  on public.calculator_product_type_supplies (supply_id);

-- Normaliza textos, mantiene updated_at y protege la coherencia de unidades aunque la escritura no venga de la app.
create or replace function public.calculator_supplies_before_write()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  if new.custom_unit_label is not null then
    new.custom_unit_label := nullif(regexp_replace(btrim(new.custom_unit_label), '\s+', ' ', 'g'), '');
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.user_id is distinct from old.user_id then
      raise exception 'calculator_supply_owner_immutable' using errcode = '42501';
    end if;
    -- Cambiar de kg a g conserva el sentido de las cantidades ya cargadas (se convierten al calcular);
    -- cambiar de kg a metros no: se bloquea mientras el insumo esté en algún tipo de producto.
    if calculator_unit_dimension(new.unit) is distinct from calculator_unit_dimension(old.unit)
      and exists (select 1 from public.calculator_product_type_supplies s where s.supply_id = old.id) then
      raise exception 'calculator_supply_unit_in_use' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists calculator_supplies_before_write on public.calculator_supplies;
create trigger calculator_supplies_before_write
before insert or update on public.calculator_supplies
for each row execute function public.calculator_supplies_before_write();

-- La asociación solo vale si el tipo de producto es del mismo usuario y la unidad es compatible con la del insumo.
-- SECURITY DEFINER para verificar la propiedad sin depender de lo que la RLS deja ver; no expone datos (solo valida).
create or replace function public.calculator_product_type_supplies_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_supply public.calculator_supplies%rowtype;
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.user_id is distinct from old.user_id then
      raise exception 'calculator_supply_owner_immutable' using errcode = '42501';
    end if;
  end if;

  if not exists (
    select 1 from public.calculator_product_types t
    where t.id = new.product_type_id and t.user_id = new.user_id
  ) then
    raise exception 'calculator_product_type_not_owned' using errcode = '42501';
  end if;

  select * into v_supply from public.calculator_supplies where id = new.supply_id and user_id = new.user_id;
  if not found then
    raise exception 'calculator_supply_not_owned' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.supply_id is distinct from old.supply_id then
    if v_supply.archived_at is not null then
      raise exception 'calculator_supply_archived' using errcode = '23514';
    end if;
  end if;

  if calculator_unit_dimension(new.quantity_unit) is distinct from calculator_unit_dimension(v_supply.unit) then
    raise exception 'calculator_supply_unit_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$fn$;

revoke all on function public.calculator_product_type_supplies_before_write() from public, anon, authenticated;

drop trigger if exists calculator_product_type_supplies_before_write on public.calculator_product_type_supplies;
create trigger calculator_product_type_supplies_before_write
before insert or update on public.calculator_product_type_supplies
for each row execute function public.calculator_product_type_supplies_before_write();

-- RLS: solo el dueño, y solo con acceso a la plataforma (igual que calculator_product_types, que es Premium).
-- Sin policy de admin a propósito: los costos de cada negocio son privados.
alter table public.calculator_supplies enable row level security;
alter table public.calculator_product_type_supplies enable row level security;

drop policy if exists calculator_supplies_select_own on public.calculator_supplies;
create policy calculator_supplies_select_own on public.calculator_supplies
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_supplies_insert_own on public.calculator_supplies;
create policy calculator_supplies_insert_own on public.calculator_supplies
for insert to authenticated
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_supplies_update_own on public.calculator_supplies;
create policy calculator_supplies_update_own on public.calculator_supplies
for update to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()))
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_supplies_delete_own on public.calculator_supplies;
create policy calculator_supplies_delete_own on public.calculator_supplies
for delete to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_product_type_supplies_select_own on public.calculator_product_type_supplies;
create policy calculator_product_type_supplies_select_own on public.calculator_product_type_supplies
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_product_type_supplies_insert_own on public.calculator_product_type_supplies;
create policy calculator_product_type_supplies_insert_own on public.calculator_product_type_supplies
for insert to authenticated
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_product_type_supplies_update_own on public.calculator_product_type_supplies;
create policy calculator_product_type_supplies_update_own on public.calculator_product_type_supplies
for update to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()))
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists calculator_product_type_supplies_delete_own on public.calculator_product_type_supplies;
create policy calculator_product_type_supplies_delete_own on public.calculator_product_type_supplies
for delete to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

-- Privilegios mínimos: id, user_id y fechas no son editables desde el cliente.
revoke all on table public.calculator_supplies from anon, authenticated;
grant select, insert, delete on table public.calculator_supplies to authenticated;
grant update (name, category, unit, custom_unit_label, unit_cost, archived_at) on table public.calculator_supplies to authenticated;
grant all on table public.calculator_supplies to service_role;

revoke all on table public.calculator_product_type_supplies from anon, authenticated;
grant select, insert, delete on table public.calculator_product_type_supplies to authenticated;
grant update (quantity, quantity_unit, sort_order) on table public.calculator_product_type_supplies to authenticated;
grant all on table public.calculator_product_type_supplies to service_role;

notify pgrst, 'reload schema';
