-- EDICIÓN PIONEROS — DIAGNÓSTICO DE SOLO LECTURA (2026-11-10)
--
-- Objetivo: saber, con datos reales, qué del sistema fundador heredado se puede reutilizar y qué no. Las tablas
-- `founder_members` / `founder_pricing_tiers` y la función `reserve_founder_slot` NO están versionadas en
-- supabase/migrations, así que su forma real solo se ve en la base. También responde si `has_platform_access` mira el
-- TIPO de grant (decide si un grant de acceso anticipado sería seguro).
--
-- Es UN SOLO SELECT: no modifica nada, no crea nada, no devuelve datos personales (ni emails ni ids de usuario: solo
-- estructura y conteos agregados). Si una tabla no existe, la fila lo dice en vez de fallar.
-- Supabase Dashboard -> SQL Editor -> New query -> pegar el archivo COMPLETO -> Run -> copiar la grilla (section | item | detail).
--
-- No lo ejecuta ningún agente: lo corrés vos y me pasás el resultado.

with
tbls as (
  select to_regclass('public.founder_members') as fm, to_regclass('public.founder_pricing_tiers') as fpt
),
rows_all as (

  -- A) existencia
  select 'A_EXISTS' as section, 'founder_members' as item,
         case when (select fm from tbls) is null then 'NO EXISTE' else 'existe' end as detail
  union all
  select 'A_EXISTS', 'founder_pricing_tiers', case when (select fpt from tbls) is null then 'NO EXISTE' else 'existe' end
  union all
  select 'A_EXISTS', 'reserve_founder_slot', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reserve_founder_slot') then 'existe' else 'NO EXISTE' end

  -- B) columnas
  union all
  select 'B_COLUMNS', c.table_name || '.' || c.column_name,
         c.data_type || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end || coalesce(' default ' || c.column_default, '')
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name in ('founder_members', 'founder_pricing_tiers')

  -- C) constraints (únicos, checks, claves foráneas) e índices
  union all
  select 'C_CONSTRAINTS', k.conrelid::regclass::text || ' · ' || k.conname, pg_get_constraintdef(k.oid)
  from pg_constraint k
  where k.conrelid in (select fm from tbls union select fpt from tbls where fpt is not null)
  union all
  select 'C_INDEXES', i.tablename || ' · ' || i.indexname, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public' and i.tablename in ('founder_members', 'founder_pricing_tiers')

  -- D) RLS, policies, privilegios y triggers
  union all
  select 'D_RLS', c.relname, 'rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text
  from pg_class c
  where c.oid in (select fm from tbls union select fpt from tbls where fpt is not null)
  union all
  select 'D_POLICIES', p.tablename || ' · ' || p.policyname,
         'cmd=' || p.cmd || ' roles=' || p.roles::text || ' using=' || coalesce(p.qual, '-') || ' check=' || coalesce(p.with_check, '-')
  from pg_policies p
  where p.schemaname = 'public' and p.tablename in ('founder_members', 'founder_pricing_tiers')
  union all
  select 'D_GRANTS', g.table_name || ' · ' || g.grantee, string_agg(g.privilege_type, ', ' order by g.privilege_type)
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.table_name in ('founder_members', 'founder_pricing_tiers')
    and g.grantee in ('anon', 'authenticated', 'service_role')
  group by g.table_name, g.grantee
  union all
  select 'D_TRIGGERS', t.tgrelid::regclass::text || ' · ' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t
  where not t.tgisinternal and t.tgrelid in (select fm from tbls union select fpt from tbls where fpt is not null)

  -- E) funciones: la heredada y la que decide el acceso a la plataforma
  union all
  select 'E_FUNCTION', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'anon_exec=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
         || ' auth_exec=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
         || E'\n' || pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('reserve_founder_slot', 'has_platform_access')
  union all
  select '0_VERDICT', 'has_platform_access filtra por TIPO de grant',
         case
           when to_regprocedure('public.has_platform_access(uuid)') is null then 'la función no existe'
           when pg_get_functiondef(to_regprocedure('public.has_platform_access(uuid)')) ilike '%grant_type%'
             then 'SÍ: la definición menciona grant_type (leer la sección E para ver cuáles acepta)'
           else 'NO: cualquier grant activo y no vencido da acceso a la plataforma. Un grant nuevo de "acceso anticipado" daría acceso completo en RLS: NO usarlo.'
         end

  -- F) datos: SOLO conteos agregados, sin datos personales
  union all
  select 'F_DATA', 'founder_members: filas por estado',
         case when (select fm from tbls) is null then 'tabla ausente'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                'select coalesce(string_agg(s.status::text || ''=''|| s.n::text, '', ''), ''(vacía)'') as c from (select status, count(*) as n from public.founder_members group by status) s',
                false, true, '')))[1]::text, '?') end
  union all
  select 'F_DATA', 'founder_members: founder_number mínimo / máximo / con preapproval',
         case when (select fm from tbls) is null then 'tabla ausente'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                'select min(founder_number)::text || '' / '' || max(founder_number)::text || '' / '' || count(mercado_pago_preapproval_id)::text as c from public.founder_members',
                false, true, '')))[1]::text, '?') end
  union all
  select 'F_DATA', 'founder_pricing_tiers: todas las filas (son precios, no datos personales)',
         case when (select fpt from tbls) is null then 'tabla ausente'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                'select coalesce(string_agg(to_jsonb(t)::text, '' | ''), ''(vacía)'') as c from public.founder_pricing_tiers t',
                false, true, '')))[1]::text, '?') end

  -- G) protección frente a cambios generales de precio (update-price con apply_to_existing)
  union all
  select 'G_PRICE', 'suscripciones authorized por monto (subscriptions.amount): cuántas y a qué monto',
         case when to_regclass('public.subscriptions') is null then 'tabla ausente'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                'select coalesce(string_agg(s.amount::text || '' x '' || s.n::text, '', '' order by s.amount), ''(ninguna)'') as c from (select amount, count(*) as n from public.subscriptions where lower(status) = ''authorized'' group by amount) s',
                false, true, '')))[1]::text, '?') end
  union all
  select 'G_PRICE', 'membership_settings (precio de lista actual)',
         case when to_regclass('public.membership_settings') is null then 'tabla ausente'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                'select coalesce(string_agg(monthly_price::text || '' '' || currency, '', ''), ''(vacía)'') as c from public.membership_settings',
                false, true, '')))[1]::text, '?') end
)
select section, item, detail
from rows_all
order by section, item;
