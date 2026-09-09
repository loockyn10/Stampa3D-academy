-- Optional official images for printer catalog models.
-- User printers keep referencing printer_templates through source_template_id.

do $printer_catalog_image_dependencies$
begin
  if to_regclass('public.printer_templates') is null then
    raise exception 'Missing dependency: public.printer_templates';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;
end;
$printer_catalog_image_dependencies$;

alter table public.printer_templates
  add column if not exists image_path text;

comment on column public.printer_templates.image_path is
  'Optional object path in the public printer-catalog-images bucket. Shared by every linked user printer.';

do $printer_catalog_image_path_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.printer_templates'::regclass
      and conname = 'printer_templates_image_path_check'
  ) then
    alter table public.printer_templates
      add constraint printer_templates_image_path_check
      check (
        image_path is null
        or image_path ~ '^printer-templates/[0-9a-fA-F-]{36}/[^/]+$'
      );
  end if;
end;
$printer_catalog_image_path_constraint$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'printer-catalog-images',
  'printer-catalog-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists printer_catalog_images_public_read on storage.objects;
create policy printer_catalog_images_public_read
on storage.objects for select to public
using (bucket_id = 'printer-catalog-images');

drop policy if exists printer_catalog_images_admin_insert on storage.objects;
create policy printer_catalog_images_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'printer-catalog-images'
  and public.is_admin(auth.uid())
  and (storage.foldername(name))[1] = 'printer-templates'
);

drop policy if exists printer_catalog_images_admin_update on storage.objects;
create policy printer_catalog_images_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'printer-catalog-images'
  and public.is_admin(auth.uid())
)
with check (
  bucket_id = 'printer-catalog-images'
  and public.is_admin(auth.uid())
  and (storage.foldername(name))[1] = 'printer-templates'
);

drop policy if exists printer_catalog_images_admin_delete on storage.objects;
create policy printer_catalog_images_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'printer-catalog-images'
  and public.is_admin(auth.uid())
);

notify pgrst, 'reload schema';
