-- Librería STL: preview 360° (WebM prerenderizado) por modelo.
--
-- * stl_models.preview_url: URL pública del WebM generado desde el Admin (null = la card usa thumbnail).
-- * Bucket público `stl-previews`: solo video/webm, path determinístico {model_id}/preview.webm
--   (regenerar reemplaza el asset). `stl-files` NO se toca y sigue privado.
-- * Lectura pública (es un asset visual de una card); escritura solo Admin (public.is_admin).
--
-- Nota: el schema stl_* no está versionado en supabase/migrations (viene de antes). Esta migration
-- solo agrega la columna nueva y el bucket/policies nuevos; es idempotente.

alter table public.stl_models
  add column if not exists preview_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stl-previews',
  'stl-previews',
  true,
  8388608,
  array['video/webm']::text[]
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists stl_previews_public_read on storage.objects;
create policy stl_previews_public_read
on storage.objects for select to public
using (bucket_id = 'stl-previews');

drop policy if exists stl_previews_admin_insert on storage.objects;
create policy stl_previews_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stl-previews'
  and public.is_admin(auth.uid())
  and name ~ '^[0-9a-fA-F-]{36}/preview\.webm$'
);

drop policy if exists stl_previews_admin_update on storage.objects;
create policy stl_previews_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'stl-previews'
  and public.is_admin(auth.uid())
)
with check (
  bucket_id = 'stl-previews'
  and public.is_admin(auth.uid())
  and name ~ '^[0-9a-fA-F-]{36}/preview\.webm$'
);

drop policy if exists stl_previews_admin_delete on storage.objects;
create policy stl_previews_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'stl-previews'
  and public.is_admin(auth.uid())
);

notify pgrst, 'reload schema';
