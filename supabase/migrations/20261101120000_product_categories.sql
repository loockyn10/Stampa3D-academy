-- Mi Taller -> Productos: categorías personalizadas por usuario.
-- Aditiva: crea public.product_categories y agrega products.category_id (nullable).
-- No modifica filas existentes: todos los productos actuales quedan "sin categoría" (category_id = null).
-- Apply after 20261031090000_tool_tutorial_versions.sql.
--
-- Requiere PostgreSQL 15+ (Supabase) por ON DELETE SET NULL (columna).

do $product_categories_dependencies$
begin
  if to_regclass('public.products') is null then raise exception 'Missing dependency: public.products'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'product_categories requires PostgreSQL 15+ (ON DELETE SET NULL (column))';
  end if;
end;
$product_categories_dependencies$;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- Clave de unicidad: ignora mayúsculas y espacios sobrantes/repetidos.
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint product_categories_user_name_key unique (user_id, name_key),
  -- Destino de la clave foránea compuesta de products: obliga a que producto y categoría sean del mismo usuario.
  constraint product_categories_id_user_key unique (id, user_id)
);

-- Normaliza el nombre aunque la escritura no venga de la app (REST directo) y mantiene updated_at.
create or replace function public.product_categories_before_write()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists product_categories_before_write on public.product_categories;
create trigger product_categories_before_write
before insert or update on public.product_categories
for each row execute function public.product_categories_before_write();

alter table public.products add column if not exists category_id uuid;

-- (category_id, user_id) -> (id, user_id): un producto solo puede apuntar a una categoría del mismo dueño,
-- sin depender de que el frontend envíe un user_id honesto. MATCH SIMPLE: con category_id null no valida nada.
-- Al borrar la categoría solo se pone en null category_id (user_id es NOT NULL y no debe tocarse): los productos se conservan.
do $product_categories_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass and conname = 'products_category_owner_fkey'
  ) then
    alter table public.products
      add constraint products_category_owner_fkey
      foreign key (category_id, user_id)
      references public.product_categories (id, user_id)
      on delete set null (category_id);
  end if;
end;
$product_categories_fk$;

create index if not exists products_user_category_idx on public.products (user_id, category_id);

alter table public.product_categories enable row level security;

drop policy if exists product_categories_select_own on public.product_categories;
create policy product_categories_select_own on public.product_categories
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_categories_insert_own on public.product_categories;
create policy product_categories_insert_own on public.product_categories
for insert to authenticated
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_categories_update_own on public.product_categories;
create policy product_categories_update_own on public.product_categories
for update to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()))
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_categories_delete_own on public.product_categories;
create policy product_categories_delete_own on public.product_categories
for delete to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_categories_admin_all on public.product_categories;
create policy product_categories_admin_all on public.product_categories
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Privilegios mínimos: solo el nombre es editable; user_id/id nunca cambian.
revoke all on table public.product_categories from anon, authenticated;
grant select, insert, delete on table public.product_categories to authenticated;
grant update (name) on table public.product_categories to authenticated;
grant all on table public.product_categories to service_role;
