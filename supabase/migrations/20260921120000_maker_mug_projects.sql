-- Stampa Maker · Jarros 3D 0.1: proyectos de Jarros en la misma tabla que Carteles y Neon, sin mezclarlos.
--
-- Los proyectos Jarro se identifican por source_type = 'mug' y guardan la MugDefinition en source_data (sin archivos:
-- no usan Storage). Carteles filtra text|svg|png y Neon neon-*, así que nunca los listan ni los abren. No se modifican
-- filas existentes, policies RLS ni el bucket.
--
-- NO se aplicó contra el Supabase remoto: hay que aplicarla (supabase db push o SQL editor) antes de guardar proyectos Jarro.

do $maker_mug_dependencies$
begin
  if to_regclass('public.maker_projects') is null then raise exception 'Missing dependency: public.maker_projects'; end if;
end;
$maker_mug_dependencies$;

do $maker_mug_source_type$
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
$maker_mug_source_type$;

alter table public.maker_projects
  add constraint maker_projects_source_type_check
  check (source_type in ('text', 'svg', 'png', 'neon-text', 'neon-svg', 'neon-png', 'neon-jpg', 'mug'));

comment on column public.maker_projects.source_type is
  'Carteles: text|svg|png. Neon LED: neon-text|neon-svg|neon-png|neon-jpg. Jarros 3D: mug (la MugDefinition va en source_data.definition).';

notify pgrst, 'reload schema';
