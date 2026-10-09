-- SOLO LECTURA. Ejecutar en el SQL Editor de Supabase para confirmar el schema real de la Librería STL.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('stl_models', 'stl_variants', 'stl_categories')
order by table_name, ordinal_position;

-- Indices y constraints (unicidad de slug, checks de difficulty, etc.)
select c.conrelid::regclass as tabla, c.conname, c.contype, pg_get_constraintdef(c.oid) as definicion
from pg_constraint c
where c.conrelid in ('public.stl_models'::regclass, 'public.stl_variants'::regclass, 'public.stl_categories'::regclass)
order by 1, 2;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('stl_models', 'stl_variants', 'stl_categories')
order by 1, 2;
