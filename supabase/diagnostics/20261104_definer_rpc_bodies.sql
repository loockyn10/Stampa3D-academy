-- SPRINT 0 (2026-11-04) — SOLO LECTURA. Cuerpo de las funciones SECURITY DEFINER que `anon` puede ejecutar y que
-- NO están versionadas en supabase/migrations (adjust_*_stock, assemble_product_from_components,
-- consume_filaments_for_products, ensure_default_calculator_product_types, rls_auto_enable, community_*).
--
-- Objetivo: confirmar que cada una valida auth.uid() y ownership antes de escribir (si no, cualquiera podría
-- modificar stock ajeno vía /rest/v1/rpc/...). Excluye get_public_* y academy_*_is_open (diseñadas para anon).
--
-- Un único SELECT sobre pg_proc: no lee tablas de negocio, no devuelve datos personales, no modifica nada.
-- Supabase Dashboard -> SQL Editor -> New query -> pegar completo -> Run -> copiar la grilla.

select
  p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function,
  pg_get_function_result(p.oid) as returns,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
  p.prosrc ilike '%auth.uid()%' as mentions_auth_uid,
  case when p.prokind = 'f' then pg_get_functiondef(p.oid) else p.prosrc end as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.proname not like 'get\_public\_%'
  and p.proname not like 'academy\_%\_is\_open'
  and p.proname not in ('is_admin', 'has_platform_access', 'handle_new_user')
order by p.proname;
