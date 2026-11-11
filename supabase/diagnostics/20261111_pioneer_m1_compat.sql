-- Edición Pioneros — M1: COMPATIBILIDAD de la base real con lo que la migration espera. SOLO LECTURA (únicamente SELECT
-- sobre el catálogo del sistema: no lee filas de negocio ni datos personales). Ejecutar ANTES de aplicar M1.
--
-- Devuelve una fila por comprobación con `status`:
--   ok        coincide con lo que M1 espera.
--   MISMATCH  NO coincide: no aplicar M1 hasta entender y resolver la diferencia (las primeras filas del resultado).
--   info      dato para revisar a mano (reglas de borrado, privilegios, nombres ya existentes); no bloquea por sí solo.
-- Complementa a 20261111_pioneer_m1_data_shape.sql (valores reales de estados/monedas/importes) y al preflight que
-- ya trae la propia migration (que solo verifica que existan tablas y columnas).

with need(sch, tbl, col, accepted, allow_enum, why) as (
  values
    ('auth',   'users',             'id',                          array['uuid'], false, 'FK de pioneer_members.user_id'),
    ('public', 'checkout_attempts', 'id',                          array['uuid'], false, 'FK de pioneer_members.checkout_attempt_id'),
    ('public', 'checkout_attempts', 'user_id',                     array['uuid'], false, 'attach_pioneer_seat compara con uuid'),
    ('public', 'checkout_attempts', 'amount',                      array['numeric', 'float4', 'float8', 'int4', 'int8'], false, 'se compara con locked_price'),
    ('public', 'checkout_attempts', 'currency',                    array['text', 'varchar', 'bpchar'], false, 'se compara con la moneda del lugar'),
    ('public', 'checkout_attempts', 'state',                       array['text', 'varchar'], true, 'creating / reconciliation_required / completed / closed'),
    ('public', 'checkout_attempts', 'mercado_pago_preapproval_id', array['text', 'varchar'], false, 'vínculo lugar <-> preapproval'),
    ('public', 'subscriptions',     'id',                          array['uuid'], false, 'se une con payments.subscription_id'),
    ('public', 'subscriptions',     'user_id',                     array['uuid'], false, 'se une con pioneer_members.user_id'),
    ('public', 'subscriptions',     'status',                      array['text', 'varchar'], true, 'authorized / pending / cancelled'),
    ('public', 'subscriptions',     'mercado_pago_preapproval_id', array['text', 'varchar'], false, 'vínculo lugar <-> suscripción'),
    ('public', 'payments',          'id',                          array['uuid', 'text', 'varchar', 'int4', 'int8'], false, 'se guarda como texto en first_payment_id'),
    ('public', 'payments',          'user_id',                     array['uuid'], false, 'se compara con pioneer_members.user_id'),
    ('public', 'payments',          'subscription_id',             array['uuid'], false, 'se une con subscriptions.id (mismo tipo)'),
    ('public', 'payments',          'status',                      array['text', 'varchar'], true, 'approved'),
    ('public', 'payments',          'amount',                      array['numeric', 'float4', 'float8', 'int4', 'int8'], false, 'se compara con locked_price'),
    ('public', 'payments',          'currency',                    array['text', 'varchar', 'bpchar'], false, 'se compara con la moneda del lugar'),
    ('public', 'payments',          'paid_at',                     array['timestamptz', 'timestamp'], false, 'orden del primer pago'),
    ('public', 'founder_members',   'user_id',                     array['uuid'], false, 'exclusión de Fundadores')
),
col_checks as (
  select 'tipos' as area,
         n.sch || '.' || n.tbl || '.' || n.col as name,
         'compatible (' || array_to_string(n.accepted, '|') || ')' as expected,
         case
           when c.column_name is null then 'FALTA la columna'
           when c.udt_name = any (n.accepted) then 'compatible (' || c.udt_name || ')'
           when n.allow_enum and c.data_type = 'USER-DEFINED' then 'compatible (enum ' || c.udt_name || ')'
           else 'INCOMPATIBLE (' || c.udt_name || ')'
         end as actual,
         'must' as kind,
         n.why as note
  from need n
  left join information_schema.columns c
    on c.table_schema = n.sch and c.table_name = n.tbl and c.column_name = n.col
),
settings as (
  select 'entorno' as area, 'server_version_num >= 130000' as name, 'true' as expected,
         (current_setting('server_version_num')::int >= 130000)::text as actual, 'must' as kind, 'gen_random_uuid() y make_interval' as note
  union all select 'entorno', 'auth.uid() existe', 'true', (to_regprocedure('auth.uid()') is not null)::text, 'must', 'policy de lectura propia'
  union all select 'entorno', 'gen_random_uuid() existe', 'true', (to_regprocedure('gen_random_uuid()') is not null)::text, 'must', 'ids de pioneer_members'
  union all select 'entorno', 'rol anon existe', 'true', exists (select 1 from pg_roles where rolname = 'anon')::text, 'must', 'revoke/grant explícitos'
  union all select 'entorno', 'rol authenticated existe', 'true', exists (select 1 from pg_roles where rolname = 'authenticated')::text, 'must', 'lectura de la propia fila'
  union all select 'entorno', 'rol service_role existe', 'true', exists (select 1 from pg_roles where rolname = 'service_role')::text, 'must', 'único con EXECUTE de las funciones'
  union all select 'entorno', 'rol de la migration', 'info', current_user::text, 'info', 'será el dueño de las funciones SECURITY DEFINER'
  union all select 'entorno', 'puede crear en el esquema public', 'true', has_schema_privilege(current_user, 'public', 'CREATE')::text, 'must', 'crear tablas y funciones'
),
owner_reads as (
  -- Las funciones SECURITY DEFINER leen estas tablas como su dueño: debe poder leerlas completas (sin que RLS lo filtre).
  select 'permisos' as area,
         'el dueño lee todas las filas de ' || t.name as name,
         'true' as expected,
         (
           has_table_privilege(current_user, 'public.' || t.name, 'SELECT')
           and (
             r.rolsuper
             or r.rolbypassrls
             or not c.relrowsecurity
             or (c.relowner = r.oid and not c.relforcerowsecurity)
           )
         )::text as actual,
         'must' as kind,
         'privilegio SELECT + RLS ' || case when c.relrowsecurity then 'activo' else 'inactivo' end
           || case when c.relforcerowsecurity then ' (FORZADO)' else '' end
           || '; dueño de la tabla: ' || pg_get_userbyid(c.relowner) as note
  from (values ('payments'), ('subscriptions'), ('checkout_attempts'), ('founder_members')) t(name)
  join pg_class c on c.oid = ('public.' || t.name)::regclass
  join pg_roles r on r.rolname = current_user
),
relations as (
  -- Reglas de borrado y vínculos existentes. M1 no depende de ellos, pero conviene conocerlos.
  select 'relaciones' as area,
         conrelid::regclass::text || ' -> ' || confrelid::regclass::text || ' (' || a.attname || ')' as name,
         'info' as expected,
         'on delete ' || case con.confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' end as actual,
         'info' as kind,
         'si se borra la cuenta, así se comporta esta tabla' as note
  from pg_constraint con
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  where con.contype = 'f'
    and con.conrelid in ('public.payments'::regclass, 'public.subscriptions'::regclass, 'public.checkout_attempts'::regclass, 'public.founder_members'::regclass)
    and con.confrelid in ('auth.users'::regclass, 'public.subscriptions'::regclass)
),
uniques as (
  select 'relaciones' as area,
         'único: subscriptions.mercado_pago_preapproval_id' as name,
         'true' as expected,
         exists (
           select 1 from pg_index i
           where i.indrelid = 'public.subscriptions'::regclass and i.indisunique and i.indnatts = 1 and not i.indisprimary
             and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'mercado_pago_preapproval_id'
         )::text as actual,
         'info' as kind,
         'M1 supone una suscripción por preapproval' as note
  union all
  select 'relaciones', 'único: founder_members.user_id', 'true',
         exists (
           select 1 from pg_index i
           where i.indrelid = 'public.founder_members'::regclass and i.indisunique and i.indnatts = 1
             and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'user_id'
         )::text, 'info', 'M0 mostró un UNIQUE (user_id) incondicional'
),
service_role_privs as (
  select 'permisos' as area,
         'service_role ' || p.priv || ' en ' || t.name as name,
         'info' as expected,
         has_table_privilege('service_role', 'public.' || t.name, p.priv)::text as actual,
         'info' as kind,
         'M1 no lo necesita (usa funciones del dueño); lo usa la app actual' as note
  from (values ('payments'), ('subscriptions'), ('checkout_attempts'), ('founder_members')) t(name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
),
collisions as (
  -- Nombres que M1 va a crear: antes de aplicar no debe existir ninguno. (Después de aplicar, aparecerán como info.)
  select 'nombres' as area,
         'objeto existente: ' || x.kind_name || ' ' || x.obj as name,
         'no existe' as expected,
         'YA EXISTE' as actual,
         'info' as kind,
         'si M1 ya se aplicó es lo esperado; si no, hay un conflicto de nombres' as note
  from (
    select 'tabla' as kind_name, c.relname::text as obj
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and c.relname like 'pioneer\_%'
    union all
    select 'función', p.proname::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '%pioneer%')
  ) x
),
foreign_triggers as (
  select 'relaciones' as area,
         'triggers de usuario en ' || t.name as name,
         'info' as expected,
         (select count(*)::text from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and not g.tgisinternal) as actual,
         'info' as kind,
         'podrían interferir con lecturas/escrituras de la app (M1 no escribe en estas tablas)' as note
  from (values ('payments'), ('subscriptions'), ('checkout_attempts'), ('founder_members')) t(name)
),
all_checks as (
  select * from col_checks
  union all select * from settings
  union all select * from owner_reads
  union all select * from relations
  union all select * from uniques
  union all select * from service_role_privs
  union all select * from collisions
  union all select * from foreign_triggers
)
select area, name, expected, actual,
       case
         when kind = 'info' then 'info'
         when actual is not distinct from expected then 'ok'
         when expected like 'compatible%' and actual like 'compatible%' then 'ok'
         else 'MISMATCH'
       end as status,
       note
from all_checks
order by (case
            when kind = 'info' then 2
            when actual is not distinct from expected or (expected like 'compatible%' and actual like 'compatible%') then 1
            else 0
          end), area, name;
