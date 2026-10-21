-- QA 2026-10-14 — Auditoría SOLO LECTURA de RLS, privilegios y consistencia de datos.
--
-- Por qué existe: ~50 tablas y 6 RPCs que usa la app NO están definidas en supabase/migrations
-- (profiles, user_access_grants, products, filaments, printers, stl_*, courses, lessons, subscriptions, payments,
-- invite_codes, budgets, clients, ...). Su RLS no puede revisarse desde el repo. Ver docs/QA_REPORT.md (RIESGO-01/02).
--
-- Cómo usarlo: pegar en el SQL editor de Supabase (proyecto real). La transacción es READ ONLY y termina en ROLLBACK:
-- no modifica nada. NO ejecutado por el agente de QA (regla: sin SQL remoto sin autorización).
--
-- Qué buscar en el resultado (sección → condición mala):
--   A_rls          → relrowsecurity = false en cualquier tabla con datos de usuario.
--   B_policy       → policies UPDATE sobre profiles/subscriptions/payments/user_access_grants sin restricción de columnas
--                    para `authenticated` (with_check = true, o solo id = auth.uid()).
--   C_trigger      → profiles SIN trigger que bloquee cambios de role / membership_* / member_level / active_months por
--                    usuarios no admin. Si no hay trigger ni column privileges, un usuario podría auto-promoverse a admin
--                    con un PATCH a /rest/v1/profiles usando su propio JWT.
--   D_column_priv  → `authenticated` con UPDATE sobre columnas sensibles de profiles.
--   G_fn_exec      → funciones SECURITY DEFINER ejecutables por anon/public que no sean get_public_*.
--   I_*            → filas inconsistentes (solo detección; no reparar sin plan).

begin read only;

-- A. RLS activado en tablas sensibles no versionadas
select 'A_rls' as section, c.relname as object, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('profiles','user_access_grants','subscriptions','payments','invite_codes','invite_code_redemptions',
    'products','product_components','product_component_filaments','product_stock_movements','filaments','filament_stock_movements',
    'printers','clients','budgets','budget_items','calculator_settings','calculator_product_types','stl_categories','stl_models',
    'stl_variants','stl_downloads','courses','course_modules','lessons','lesson_resources','lesson_progress','raffles',
    'raffle_prizes','raffle_winners','referrals','badges','user_badges','founder_members','membership_settings')
order by c.relname;

-- B. Policies de esas tablas
select 'B_policy' as section, tablename as object, policyname, cmd, roles::text, permissive,
       left(coalesce(qual, ''), 160) as using_expr, left(coalesce(with_check, ''), 160) as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles','user_access_grants','subscriptions','payments','invite_codes','invite_code_redemptions',
    'products','product_components','product_component_filaments','filaments','printers','clients','budgets','budget_items',
    'stl_categories','stl_models','stl_variants','stl_downloads','courses','lessons','lesson_progress','membership_settings')
order by tablename, cmd, policyname;

-- C. Triggers sobre profiles (¿hay guarda de columnas privilegiadas?)
select 'C_trigger' as section, event_object_table as object, trigger_name, action_timing, event_manipulation,
       left(action_statement, 160) as action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table in ('profiles','user_access_grants','subscriptions')
order by event_object_table, trigger_name;

-- D. Privilegios por columna para authenticated / anon sobre profiles
select 'D_column_priv' as section, table_name as object, grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles' and grantee in ('authenticated', 'anon')
  and privilege_type in ('UPDATE', 'INSERT')
order by grantee, privilege_type, column_name;

-- E. Privilegios a nivel tabla (UPDATE/DELETE/INSERT) para authenticated/anon en tablas sensibles
select 'E_table_priv' as section, table_name as object, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
  and table_name in ('profiles','user_access_grants','subscriptions','payments','invite_codes','business_catalog_items','products','filaments','printers','stl_downloads')
group by table_name, grantee
order by table_name, grantee;

-- F. Tablas de public sin RLS
select 'F_no_rls' as section, c.relname as object
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by c.relname;

-- G. Funciones SECURITY DEFINER ejecutables por anon o PUBLIC
select 'G_fn_exec' as section, p.proname as object, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;

-- H. Migrations aplicadas (comparar con supabase/migrations del repo)
select 'H_migration' as section, version as object, name
from supabase_migrations.schema_migrations
order by version desc
limit 60;

-- I. Consistencia de datos (solo detección)
select 'I_negative_stock_products' as section, count(*) as rows_found from public.products where coalesce(stock_quantity, 0) < 0;
select 'I_negative_stock_resale' as section, count(*) as rows_found from public.business_catalog_items where coalesce(resale_stock_quantity, 0) < 0;
select 'I_manufactured_without_product' as section, count(*) as rows_found
from public.business_catalog_items where source_type = 'manufactured' and source_product_id is null;
select 'I_duplicate_barcode_per_user' as section, user_id, barcode, count(*) as rows_found
from public.business_catalog_items where barcode is not null and btrim(barcode) <> ''
group by user_id, barcode having count(*) > 1;
select 'I_completed_sales_without_payment_rows' as section, count(*) as rows_found
from public.business_sales s
where s.status = 'completed' and s.order_id is null and s.total > 0
  and not exists (select 1 from public.business_sale_payment_allocations a where a.sale_id = s.id)
  and not exists (select 1 from public.customer_account_movements m where m.sale_id = s.id and m.movement_type = 'sale_debt');
select 'I_customer_negative_balance' as section, client_id, round(sum(delta), 2) as balance
from public.customer_account_movements group by client_id having sum(delta) < -0.005;
select 'I_voided_sale_with_open_debt' as section, count(*) as rows_found
from public.business_sales s
where s.status = 'voided'
  and exists (select 1 from public.customer_account_movements m where m.sale_id = s.id and m.movement_type = 'sale_debt')
  and not exists (select 1 from public.customer_account_movements m where m.sale_id = s.id and m.movement_type = 'sale_reversal');
select 'I_stl_models_without_variant' as section, count(*) as rows_found
from public.stl_models m where not exists (select 1 from public.stl_variants v where v.model_id = m.id);
select 'I_stl_models_without_group' as section, count(*) as rows_found from public.stl_models where category_id is null;
select 'I_stl_variants_without_file' as section, count(*) as rows_found from public.stl_variants where file_url is null or btrim(file_url) = '';
select 'I_duplicate_stl_group_slug' as section, slug, count(*) as rows_found
from public.stl_categories where slug is not null group by slug having count(*) > 1;

rollback;
