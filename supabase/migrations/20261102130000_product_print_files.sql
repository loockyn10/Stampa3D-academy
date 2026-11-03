-- Mi Taller -> Productos: biblioteca de archivos de impresión (proyectos 3MF) por producto.
-- Aditiva: crea public.product_print_files y el bucket privado `product-print-files`.
-- No modifica filas ni columnas existentes; los productos actuales quedan sin archivos.
-- Apply after 20261102120000_community_links.sql.
--
-- Modelo de acceso:
--   * Tabla: el dueño LEE sus filas por RLS (+ has_platform_access). Puede insertar filas `pending`,
--     editar solo metadatos y eliminar. `status`, `file_size` y `storage_path` los fija el servidor
--     (service_role) después de verificar el archivo subido.
--   * Bucket: PRIVADO y SIN policies para anon/authenticated. Subida, lectura y borrado pasan siempre por
--     Server Actions / rutas del servidor (signed upload URL, URL firmada de corta duración).

do $print_files_dependencies$
begin
  if to_regclass('public.products') is null then raise exception 'Missing dependency: public.products'; end if;
  if to_regclass('public.product_components') is null then raise exception 'Missing dependency: public.product_components'; end if;
  if to_regclass('public.printers') is null then raise exception 'Missing dependency: public.printers'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regclass('storage.buckets') is null then raise exception 'Missing dependency: storage.buckets'; end if;
  -- Las claves foráneas y el CHECK de la ruta asumen ids uuid: se comprueba antes de crear nada.
  if exists (
    select 1
    from (values ('products', 'id'), ('products', 'user_id'), ('product_components', 'id'), ('product_components', 'product_id'),
                 ('product_components', 'user_id'), ('printers', 'id'), ('printers', 'user_id')) as expected(table_name, column_name)
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = expected.table_name and c.column_name = expected.column_name
    where c.data_type is distinct from 'uuid'
  ) then
    raise exception 'product_print_files requires uuid id/user_id/product_id columns on products, product_components and printers';
  end if;
end;
$print_files_dependencies$;

create table if not exists public.product_print_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- Pieza (opcional). Un archivo puede ser un proyecto completo con varias piezas: null = todo el producto.
  component_id uuid references public.product_components(id) on delete set null,
  -- Nombre identificativo del proyecto (lo escribe el usuario).
  name text not null,
  -- Laminador. Se valida contra el registro de la app (src/lib/print-files/slicers.ts); en la base solo la forma,
  -- así sumar un laminador no exige una migration.
  slicer text not null,
  -- Impresora (opcional): referencia al catálogo propio de Mi Taller y/o nombre libre.
  printer_id uuid references public.printers(id) on delete set null,
  printer_name text,
  -- Nombre original del archivo subido (solo para mostrar y nombrar la descarga).
  file_name text not null,
  -- {user_id}/{product_id}/{file_id}.3mf dentro del bucket privado. Único: un objeto, una fila.
  storage_path text not null,
  file_size bigint,
  -- 'pending' hasta que el servidor verificó el objeto subido; la UI solo muestra 'ready'.
  status text not null default 'pending',
  -- Reemplazo en curso: al quedar 'ready' el servidor elimina la fila y el objeto anteriores.
  replaces_id uuid,
  -- Datos opcionales de ESTA configuración. Nunca alimentan el costo ni el tiempo del producto.
  est_minutes integer,
  est_grams numeric(10, 2),
  material text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_print_files_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint product_print_files_slicer_shape check (slicer ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint product_print_files_printer_name_length check (printer_name is null or char_length(btrim(printer_name)) between 1 and 80),
  constraint product_print_files_file_name_length check (char_length(file_name) between 1 and 180),
  constraint product_print_files_status_check check (status in ('pending', 'ready')),
  constraint product_print_files_ready_has_size check (status = 'pending' or (file_size is not null and file_size > 0)),
  constraint product_print_files_est_minutes_check check (est_minutes is null or est_minutes between 1 and 100000),
  constraint product_print_files_est_grams_check check (est_grams is null or (est_grams > 0 and est_grams <= 1000000)),
  constraint product_print_files_material_length check (material is null or char_length(btrim(material)) between 1 and 60),
  constraint product_print_files_storage_path_key unique (storage_path),
  -- El objeto vive siempre bajo la carpeta del dueño y del producto, y es un .3mf con id uuid.
  constraint product_print_files_storage_path_scope check (
    storage_path like user_id::text || '/' || product_id::text || '/%'
    and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.3mf$'
  )
);

create index if not exists product_print_files_user_product_idx on public.product_print_files (user_id, product_id);
create index if not exists product_print_files_component_idx on public.product_print_files (component_id) where component_id is not null;

-- Pertenencia: producto, pieza e impresora deben ser del mismo usuario (y la pieza del mismo producto), sin depender
-- del user_id que mande el cliente ni de la RLS de tablas no versionadas. SECURITY DEFINER para ver las tres tablas.
create or replace function public.product_print_files_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  if new.printer_name is not null then
    new.printer_name := nullif(regexp_replace(btrim(new.printer_name), '\s+', ' ', 'g'), '');
  end if;
  if new.material is not null then
    new.material := nullif(regexp_replace(btrim(new.material), '\s+', ' ', 'g'), '');
  end if;

  if not exists (select 1 from public.products p where p.id = new.product_id and p.user_id = new.user_id) then
    raise exception 'product_print_files: el producto no pertenece al usuario' using errcode = '23503';
  end if;
  if new.component_id is not null and not exists (
    select 1 from public.product_components c
    where c.id = new.component_id and c.product_id = new.product_id and c.user_id = new.user_id
  ) then
    raise exception 'product_print_files: la pieza no pertenece a este producto' using errcode = '23503';
  end if;
  if new.printer_id is not null and not exists (
    select 1 from public.printers pr where pr.id = new.printer_id and pr.user_id = new.user_id
  ) then
    raise exception 'product_print_files: la impresora no pertenece al usuario' using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

revoke all on function public.product_print_files_before_write() from public;

drop trigger if exists product_print_files_before_write on public.product_print_files;
create trigger product_print_files_before_write
before insert or update on public.product_print_files
for each row execute function public.product_print_files_before_write();

alter table public.product_print_files enable row level security;

drop policy if exists product_print_files_select_own on public.product_print_files;
create policy product_print_files_select_own on public.product_print_files
for select to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_print_files_insert_own on public.product_print_files;
create policy product_print_files_insert_own on public.product_print_files
for insert to authenticated
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()) and status = 'pending');

drop policy if exists product_print_files_update_own on public.product_print_files;
create policy product_print_files_update_own on public.product_print_files
for update to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()))
with check (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_print_files_delete_own on public.product_print_files;
create policy product_print_files_delete_own on public.product_print_files
for delete to authenticated
using (user_id = auth.uid() and public.has_platform_access(auth.uid()));

drop policy if exists product_print_files_admin_all on public.product_print_files;
create policy product_print_files_admin_all on public.product_print_files
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Privilegios mínimos. El cliente nunca puede marcar un archivo como 'ready' ni cambiar su ruta o tamaño.
revoke all on table public.product_print_files from anon, authenticated;
grant select, delete on table public.product_print_files to authenticated;
grant insert (id, user_id, product_id, component_id, name, slicer, printer_id, printer_name, file_name, storage_path, replaces_id, est_minutes, est_grams, material)
  on table public.product_print_files to authenticated;
grant update (name, slicer, component_id, printer_id, printer_name, est_minutes, est_grams, material)
  on table public.product_print_files to authenticated;
grant all on table public.product_print_files to service_role;

-- Bucket PRIVADO. Sin policies sobre storage.objects para este bucket: anon y authenticated no pueden leer, escribir ni
-- listar; solo el servidor (service_role) con signed upload URL / URL firmada. El tope es el máximo absoluto de la app
-- (150 MB); el límite efectivo (por defecto 100 MB) lo aplica el servidor y se puede bajar con PRINT_FILES_MAX_MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-print-files', 'product-print-files', false, 157286400, null)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;
