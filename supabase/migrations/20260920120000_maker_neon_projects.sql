-- Stampa Maker · Neon LED 0.2: proyectos de Neon en la misma tabla que los de Carteles, sin mezclarlos.
--
-- Los proyectos Neon se identifican por `source_type` con prefijo "neon-" (neon-text | neon-svg | neon-png | neon-jpg).
-- Carteles filtra por sus propios tipos (text|svg|png), así que nunca los lista ni los abre. No se modifican filas
-- existentes ni policies RLS; el bucket sigue siendo PRIVADO (solo se agrega image/jpeg a los tipos permitidos).
--
-- NO se aplicó contra el Supabase remoto: hay que aplicarla (supabase db push o SQL editor) antes de guardar proyectos Neon.

do $maker_neon_dependencies$
begin
  if to_regclass('public.maker_projects') is null then raise exception 'Missing dependency: public.maker_projects'; end if;
end;
$maker_neon_dependencies$;

-- 1) source_type: ampliar el CHECK (el nombre autogenerado puede variar: se busca por definición).
do $maker_neon_source_type$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.maker_projects'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source_type%'
  loop
    execute format('alter table public.maker_projects drop constraint %I', c);
  end loop;
end;
$maker_neon_source_type$;

alter table public.maker_projects
  add constraint maker_projects_source_type_check
  check (source_type in ('text', 'svg', 'png', 'neon-text', 'neon-svg', 'neon-png', 'neon-jpg'));

comment on column public.maker_projects.source_type is
  'Carteles: text|svg|png. Neon LED: neon-text|neon-svg|neon-png|neon-jpg. Neon guarda solo el origen y la receta de conversión (nunca el skeleton).';

-- 2) Storage: el bucket privado acepta también JPEG (fuente de imágenes Neon).
update storage.buckets
set allowed_mime_types = array['image/svg+xml', 'image/png', 'image/jpeg']::text[]
where id = 'maker-projects';

notify pgrst, 'reload schema';
