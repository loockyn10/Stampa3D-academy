-- SOLO LECTURA. Ejecutar en el SQL Editor de Supabase para confirmar el schema real de la Librería STL.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('stl_models', 'stl_variants', 'stl_categories')
order by table_name, ordinal_position;
