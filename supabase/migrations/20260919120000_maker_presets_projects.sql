-- Stampa Maker: presets (recetas reutilizables) y proyectos (trabajos concretos) por usuario.
-- Solo agrega objetos nuevos: no modifica ni elimina tablas existentes.
-- Maker es una herramienta de plataforma (paga): además del ownership, se exige acceso de plataforma.

do $maker_dependencies$
begin
  if to_regclass('public.profiles') is null then raise exception 'Missing dependency: public.profiles'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.set_updated_at()') is null then raise exception 'Missing dependency: public.set_updated_at()'; end if;
end;
$maker_dependencies$;

-- ---------------------------------------------------------------------------
-- maker_presets
-- ---------------------------------------------------------------------------
create table if not exists public.maker_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  schema_version integer not null default 1 check (schema_version >= 1),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maker_presets_user_idx on public.maker_presets(user_id);

-- Máximo un preset predeterminado por usuario.
create unique index if not exists maker_presets_one_default_per_user
  on public.maker_presets(user_id) where is_default;

drop trigger if exists maker_presets_set_updated_at on public.maker_presets;
create trigger maker_presets_set_updated_at
before update on public.maker_presets
for each row execute function public.set_updated_at();

alter table public.maker_presets enable row level security;

drop policy if exists maker_presets_select_own on public.maker_presets;
create policy maker_presets_select_own on public.maker_presets
for select to authenticated using (user_id = auth.uid());

drop policy if exists maker_presets_insert_own on public.maker_presets;
create policy maker_presets_insert_own on public.maker_presets
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists maker_presets_update_own on public.maker_presets;
create policy maker_presets_update_own on public.maker_presets
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists maker_presets_delete_own on public.maker_presets;
create policy maker_presets_delete_own on public.maker_presets
for delete to authenticated using (user_id = auth.uid());

drop policy if exists maker_presets_requires_platform_access on public.maker_presets;
create policy maker_presets_requires_platform_access on public.maker_presets
as restrictive for all to authenticated
using (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))
with check (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()));

revoke all on table public.maker_presets from public, anon;
grant select, insert, update, delete on table public.maker_presets to authenticated;

-- Cambia el predeterminado de forma atómica (una sola transacción): primero
-- desmarca el actual y luego marca el nuevo, así el índice único parcial nunca
-- ve dos defaults. `p_preset_id = null` quita el predeterminado. SECURITY
-- INVOKER: corre con las policies RLS del usuario que llama.
create or replace function public.maker_set_default_preset(p_preset_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $maker_set_default$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_preset_id is not null and not exists (
    select 1 from public.maker_presets where id = p_preset_id and user_id = auth.uid()
  ) then
    raise exception 'preset not found' using errcode = 'P0002';
  end if;

  update public.maker_presets
     set is_default = false
   where user_id = auth.uid() and is_default and id is distinct from p_preset_id;

  if p_preset_id is not null then
    update public.maker_presets
       set is_default = true
     where id = p_preset_id and user_id = auth.uid();
  end if;
end;
$maker_set_default$;

revoke all on function public.maker_set_default_preset(uuid) from public, anon;
grant execute on function public.maker_set_default_preset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- maker_projects
-- ---------------------------------------------------------------------------
create table if not exists public.maker_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  source_type text not null check (source_type in ('text', 'svg', 'png')),
  -- text: {text, fontId, heightMm}. svg/png: {storagePath, originalFilename, mimeType, heightMm, sizeBytes, pngOptions?}.
  -- Nunca el contenido del archivo: vive en Storage (bucket privado maker-projects).
  source_data jsonb not null check (jsonb_typeof(source_data) = 'object' and pg_column_size(source_data) < 16384),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  preset_id uuid references public.maker_presets(id) on delete set null,
  schema_version integer not null default 1 check (schema_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maker_projects_user_idx on public.maker_projects(user_id, updated_at desc);
create index if not exists maker_projects_preset_idx on public.maker_projects(preset_id);

drop trigger if exists maker_projects_set_updated_at on public.maker_projects;
create trigger maker_projects_set_updated_at
before update on public.maker_projects
for each row execute function public.set_updated_at();

alter table public.maker_projects enable row level security;

drop policy if exists maker_projects_select_own on public.maker_projects;
create policy maker_projects_select_own on public.maker_projects
for select to authenticated using (user_id = auth.uid());

-- Un proyecto solo puede referenciar un preset propio (la FK sola no lo garantiza).
drop policy if exists maker_projects_insert_own on public.maker_projects;
create policy maker_projects_insert_own on public.maker_projects
for insert to authenticated
with check (
  user_id = auth.uid()
  and (preset_id is null or exists (select 1 from public.maker_presets p where p.id = preset_id and p.user_id = auth.uid()))
);

drop policy if exists maker_projects_update_own on public.maker_projects;
create policy maker_projects_update_own on public.maker_projects
for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (preset_id is null or exists (select 1 from public.maker_presets p where p.id = preset_id and p.user_id = auth.uid()))
);

drop policy if exists maker_projects_delete_own on public.maker_projects;
create policy maker_projects_delete_own on public.maker_projects
for delete to authenticated using (user_id = auth.uid());

drop policy if exists maker_projects_requires_platform_access on public.maker_projects;
create policy maker_projects_requires_platform_access on public.maker_projects
as restrictive for all to authenticated
using (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))
with check (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()));

revoke all on table public.maker_projects from public, anon;
grant select, insert, update, delete on table public.maker_projects to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: bucket PRIVADO para las fuentes SVG/PNG de los proyectos.
-- Path: {user_id}/{project_id}/source.svg|png (la primera carpeta es el dueño).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'maker-projects',
  'maker-projects',
  false,
  10485760,
  array['image/svg+xml', 'image/png']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists maker_projects_storage_select_own on storage.objects;
create policy maker_projects_storage_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'maker-projects'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))
);

drop policy if exists maker_projects_storage_insert_own on storage.objects;
create policy maker_projects_storage_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'maker-projects'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))
);

drop policy if exists maker_projects_storage_update_own on storage.objects;
create policy maker_projects_storage_update_own on storage.objects
for update to authenticated
using (
  bucket_id = 'maker-projects'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))
)
with check (
  bucket_id = 'maker-projects'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists maker_projects_storage_delete_own on storage.objects;
create policy maker_projects_storage_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'maker-projects'
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';
