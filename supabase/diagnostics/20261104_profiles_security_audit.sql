-- SPRINT 0 (2026-11-04) — DIAGNÓSTICO SOLO LECTURA de la seguridad de profiles / membresías / admin.
--
-- Complementa supabase/diagnostics/20261014_qa_rls_audit.sql. Diferencias:
--   * Es UN ÚNICO SELECT -> el SQL Editor de Supabase muestra UNA grilla (section | item | detail) con todo.
--     (El archivo del 14/10 tiene ~20 sentencias y termina en ROLLBACK: el editor solo muestra el último resultado.)
--   * Lee catálogos del sistema y, para datos, SOLO CONTEOS agregados (sin emails, nombres ni ids de usuarios).
--   * Muestra definiciones COMPLETAS (sin truncar) de policies, triggers y de is_admin / has_platform_access.
--   * Cubre lo que el 14/10 no cubre: privilegios por columna vía has_column_privilege, trigger de alta en
--     auth.users (¿copia role desde metadata?), funciones SECURITY DEFINER ejecutables por `authenticated` que
--     escriben profiles, vistas sobre profiles, y señales de autopromoción ya ocurrida.
--
-- Garantías: un SELECT no puede escribir. Solo llama funciones de catálogo de lectura
-- (pg_get_functiondef, pg_get_triggerdef, pg_get_expr, has_*_privilege). No crea, altera ni borra nada.
-- No usa to_regclass sobre esquemas ajenos (búsqueda por nombre en pg_class) para no fallar por permisos.
--
-- Cómo usarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar ESTE archivo completo -> Run.
-- Copiar la grilla (botón de exportar/copiar) y compartirla. No contiene datos personales.
-- La sección OPCIONAL al final (comentada) SÍ devuelve emails: correrla aparte y no compartir su resultado.

with
watched(tbl) as (
  values ('profiles'), ('subscriptions'), ('payments'), ('user_access_grants'), ('founder_members'),
         ('invite_codes'), ('invite_code_redemptions'), ('membership_settings'), ('mercado_pago_webhook_events'),
         ('referrals'), ('checkout_attempts'), ('courses'), ('course_modules'), ('lessons'), ('lesson_resources'),
         ('stl_models'), ('stl_variants'), ('stl_downloads')
),
rel as (
  select w.tbl, c.oid, c.relrowsecurity, c.relforcerowsecurity
  from watched w
  left join pg_namespace n on n.nspname = 'public'
  left join pg_class c on c.relnamespace = n.oid and c.relname = w.tbl and c.relkind in ('r', 'p')
),
prof as (
  select c.oid, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'profiles' and c.relkind in ('r', 'p')
),
prof_cols as (
  select a.attnum, a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ,
         pg_get_expr(d.adbin, d.adrelid) as default_expr, a.attnotnull,
         has_column_privilege('authenticated', prof.oid, a.attname::text, 'UPDATE') as auth_upd,
         has_column_privilege('authenticated', prof.oid, a.attname::text, 'INSERT') as auth_ins,
         has_column_privilege('anon', prof.oid, a.attname::text, 'UPDATE') as anon_upd,
         has_column_privilege('anon', prof.oid, a.attname::text, 'INSERT') as anon_ins
  from prof
  join pg_attribute a on a.attrelid = prof.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),
sensitive(col) as (
  values ('id'), ('role'), ('membership_status'), ('membership_expires_at'), ('membership_started_at'),
         ('member_level'), ('active_months'), ('referral_code'), ('referred_by_user_id')
),
prof_trg as (
  select t.tgname::text as tgname, t.tgenabled::text as tgenabled, pg_get_triggerdef(t.oid) as trig_def,
         pg_get_functiondef(t.tgfoid) as fn_def
  from pg_trigger t join prof on t.tgrelid = prof.oid
  where not t.tgisinternal
),
auth_trg as (
  select t.tgname::text as tgname, t.tgenabled::text as tgenabled, pg_get_triggerdef(t.oid) as trig_def,
         pg_get_functiondef(t.tgfoid) as fn_def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
),
key_fn as (
  select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         p.prosecdef, pg_get_functiondef(p.oid) as fn_def,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('is_admin', 'has_platform_access') and p.prokind = 'f'
),
definer_fn as (
  select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
         p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
),
prof_views as (
  select c.relname::text as view_name, coalesce(array_to_string(c.reloptions, ','), '') as opts,
         has_table_privilege('anon', c.oid, 'SELECT') as anon_sel,
         has_table_privilege('authenticated', c.oid, 'SELECT') as auth_sel
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and pg_get_viewdef(c.oid) ilike '%profiles%'
),
rows_all as (

  -- 0) VEREDICTOS HEURÍSTICOS (necesarios, no suficientes: leer las secciones C y E).
  select '0_VERDICT' as section, 'profiles RLS' as item,
    coalesce((select 'enabled=' || relrowsecurity::text || ', forced=' || relforcerowsecurity::text from prof),
             'TABLA public.profiles NO ENCONTRADA') as detail
  union all
  select '0_VERDICT', 'authenticated puede UPDATE en columnas sensibles',
    coalesce((select string_agg(pc.col, ', ' order by pc.attnum) from prof_cols pc join sensitive s on s.col = pc.col
              where pc.auth_upd), '(ninguna)')
  union all
  select '0_VERDICT', 'authenticated puede INSERT en columnas sensibles',
    coalesce((select string_agg(pc.col, ', ' order by pc.attnum) from prof_cols pc join sensitive s on s.col = pc.col
              where pc.auth_ins), '(ninguna)')
  union all
  select '0_VERDICT', 'trigger de guarda sobre profiles',
    case
      when not exists (select 1 from prof_trg)
        then 'SIN TRIGGERS en profiles. Si authenticated tiene UPDATE en role/membership_* y hay policy UPDATE propia -> autopromoción PROBABLE.'
      when exists (select 1 from prof_trg where trig_def ilike '%BEFORE%' and trig_def ilike '%UPDATE%'
                   and fn_def ilike '%role%' and fn_def ilike '%membership%')
        then 'HAY trigger BEFORE UPDATE que menciona role y membership. Leer su cuerpo (sección C) para confirmar que bloquea a no-admin.'
      else 'Hay triggers pero ninguno BEFORE UPDATE menciona role + membership: revisar sección C (probablemente NO protege).'
    end
  union all
  select '0_VERDICT', 'policies UPDATE/ALL sobre profiles para authenticated/public',
    coalesce((select string_agg(policyname || ' [' || cmd || ']', ', ' order by policyname) from pg_policies
              where schemaname = 'public' and tablename = 'profiles' and cmd in ('UPDATE', 'ALL')
                and (roles @> array['authenticated']::name[] or roles @> array['public']::name[])), '(ninguna)')

  -- A) RLS por tabla vigilada
  union all
  select 'A_rls', r.tbl,
    case when r.oid is null then 'NO EXISTE'
         else 'enabled=' || r.relrowsecurity::text || ', forced=' || r.relforcerowsecurity::text end
  from rel r

  -- B) privilegios de tabla para anon / authenticated (RLS no cubre TRUNCATE)
  union all
  select 'B_table_priv', r.tbl || ' / ' || g.grantee,
    concat_ws(',',
      case when has_table_privilege(g.grantee, r.oid, 'SELECT') then 'SELECT' end,
      case when has_table_privilege(g.grantee, r.oid, 'INSERT') then 'INSERT' end,
      case when has_table_privilege(g.grantee, r.oid, 'UPDATE') then 'UPDATE' end,
      case when has_table_privilege(g.grantee, r.oid, 'DELETE') then 'DELETE' end,
      case when has_table_privilege(g.grantee, r.oid, 'TRUNCATE') then 'TRUNCATE' end,
      case when has_table_privilege(g.grantee, r.oid, 'REFERENCES') then 'REFERENCES' end,
      case when has_table_privilege(g.grantee, r.oid, 'TRIGGER') then 'TRIGGER' end)
  from rel r cross join (values ('anon'), ('authenticated')) as g(grantee)
  where r.oid is not null

  -- C) triggers sobre profiles y sobre auth.users (definición completa + función)
  union all
  select 'C_trigger_profiles', tgname || ' (enabled=' || tgenabled || ')', trig_def || E'\n\n' || fn_def from prof_trg
  union all
  select 'C_trigger_auth_users', tgname || ' (enabled=' || tgenabled || ')', trig_def || E'\n\n' || fn_def from auth_trg

  -- D) privilegios por columna de profiles (una fila por columna; * = columna sensible)
  union all
  select 'D_profiles_columns',
    lpad(pc.attnum::text, 3, '0') || ' ' || pc.col || case when s.col is not null then ' *' else '' end,
    'auth UPDATE=' || pc.auth_upd::text || ' INSERT=' || pc.auth_ins::text
      || ' | anon UPDATE=' || pc.anon_upd::text || ' INSERT=' || pc.anon_ins::text
      || ' | ' || pc.typ || case when pc.attnotnull then ' not null' else '' end
      || ' | default=' || coalesce(pc.default_expr, '-')
  from prof_cols pc left join sensitive s on s.col = pc.col

  -- E) policies completas (sin truncar) de las tablas vigiladas
  union all
  select 'E_policy', p.tablename || ' :: ' || p.policyname || ' [' || p.cmd || '] ' || p.permissive,
    'roles=' || p.roles::text || E'\nUSING: ' || coalesce(p.qual, '-') || E'\nWITH CHECK: ' || coalesce(p.with_check, '-')
  from pg_policies p join watched w on w.tbl = p.tablename
  where p.schemaname = 'public'

  -- F) definiciones de is_admin / has_platform_access
  union all
  select 'F_key_function', sig,
    'security_definer=' || prosecdef::text || ' anon_exec=' || anon_exec::text || ' auth_exec=' || auth_exec::text
      || E'\n\n' || fn_def
  from key_fn

  -- G) funciones SECURITY DEFINER ejecutables por anon o authenticated (las que tocan profiles/grants marcadas)
  union all
  select 'G_definer_exec', sig,
    'anon_exec=' || anon_exec::text || ' auth_exec=' || auth_exec::text
      || case when prosrc ~* '(update|insert\s+into)\s+(public\.)?profiles' then ' | ESCRIBE profiles' else '' end
      || case when prosrc ~* '(update|insert\s+into)\s+(public\.)?user_access_grants' then ' | ESCRIBE user_access_grants' else '' end
      || case when prosrc ~* '(update|insert\s+into)\s+(public\.)?subscriptions' then ' | ESCRIBE subscriptions' else '' end
  from definer_fn
  where anon_exec or auth_exec

  -- H) vistas que leen profiles (las vistas sin security_invoker saltean RLS)
  union all
  select 'H_view_over_profiles', view_name,
    'options=' || opts || ' | anon_select=' || anon_sel::text || ' auth_select=' || auth_sel::text
  from prof_views

  -- I) SEÑALES de autopromoción (solo conteos; no prueban abuso, orientan la revisión)
  union all
  select 'I_signal', 'profiles por role',
    coalesce((select string_agg(coalesce(role::text, 'NULL') || '=' || n::text, ', ' order by role::text)
              from (select role, count(*) as n from public.profiles group by role) x), '-')
  union all
  select 'I_signal', 'profiles por membership_status',
    coalesce((select string_agg(coalesce(membership_status::text, 'NULL') || '=' || n::text, ', ' order by membership_status::text)
              from (select membership_status, count(*) as n from public.profiles group by membership_status) x), '-')
  union all
  select 'I_signal', 'active SIN subscription authorized (no admin)',
    (select count(*)::text from public.profiles p
     where p.membership_status = 'active' and p.role::text is distinct from 'admin'
       and not exists (select 1 from public.subscriptions s where s.user_id = p.id and s.status = 'authorized'))
     || ' (incluye altas manuales legítimas desde /admin/usuarios; revisar con la sección OPCIONAL)'
  union all
  select 'I_signal', 'active con membership_expires_at NULL (acceso sin vencimiento)',
    (select count(*)::text from public.profiles p where p.membership_status = 'active' and p.membership_expires_at is null)
)
select section, item, detail
from rows_all
order by section, item;

/* ---------------------------------------------------------------------------------------------------------------
   OPCIONAL — CONTIENE DATOS PERSONALES (emails). Correr en una pestaña aparte SOLO si la sección I muestra algo
   inesperado. Es un SELECT de solo lectura. NO compartir el resultado; revisarlo el dueño.

select p.id, u.email, p.role, p.membership_status, p.membership_expires_at, u.created_at, u.last_sign_in_at,
       exists (select 1 from public.subscriptions s where s.user_id = p.id and s.status = 'authorized') as has_authorized_sub
from public.profiles p
left join auth.users u on u.id = p.id
where p.role::text = 'admin'
   or (p.membership_status = 'active'
       and not exists (select 1 from public.subscriptions s where s.user_id = p.id and s.status = 'authorized'))
order by p.role::text, u.created_at;
--------------------------------------------------------------------------------------------------------------- */
