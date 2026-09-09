-- Read-only diagnostic for a completely or partially applied Sprint 4 migration.

-- 1. Expected tables.
with expected(name) as (values
  ('business_payment_accounts'), ('business_payment_oauth_states'),
  ('business_orders'), ('business_order_items'),
  ('business_stock_reservations'), ('business_payments'),
  ('business_payment_webhook_events')
)
select name, to_regclass('public.' || name) as relation
from expected order by name;

-- 2. Actual columns, defaults and nullability on Sprint 4 tables plus the
--    compatibility column added to business_sales.
select table_name, ordinal_position, column_name, data_type, udt_name,
  is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'business_payment_accounts', 'business_payment_oauth_states',
    'business_orders', 'business_order_items',
    'business_stock_reservations', 'business_payments',
    'business_payment_webhook_events', 'business_sales'
  )
  and (table_name <> 'business_sales' or column_name = 'order_id')
order by table_name, ordinal_position;

-- 3. Constraints and whether foreign keys were validated.
select relation.relname as table_name, constraint_row.conname,
  constraint_row.contype, constraint_row.convalidated,
  pg_get_constraintdef(constraint_row.oid, true) as definition
from pg_constraint constraint_row
join pg_class relation on relation.oid = constraint_row.conrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in (
    'business_payment_accounts', 'business_payment_oauth_states',
    'business_orders', 'business_order_items',
    'business_stock_reservations', 'business_payments',
    'business_payment_webhook_events', 'business_sales'
  )
order by relation.relname, constraint_row.conname;

-- 4. Indexes.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and (tablename like 'business_payment%' or tablename in (
    'business_orders', 'business_order_items',
    'business_stock_reservations', 'business_sales'
  ))
order by tablename, indexname;

-- 5. Non-internal triggers.
select event_object_table as table_name, trigger_name,
  event_manipulation, action_timing, action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in (
    'business_payment_accounts', 'business_orders',
    'business_stock_reservations', 'business_payments',
    'business_payment_webhook_events'
  )
order by event_object_table, trigger_name, event_manipulation;

-- 6. Policies and RLS flags.
select relation.relname as table_name, relation.relrowsecurity as rls_enabled,
  policy.policyname, policy.cmd, policy.roles, policy.qual, policy.with_check
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
left join pg_policies policy on policy.schemaname = namespace.nspname
  and policy.tablename = relation.relname
where namespace.nspname = 'public'
  and relation.relname in (
    'business_payment_accounts', 'business_payment_oauth_states',
    'business_orders', 'business_order_items',
    'business_stock_reservations', 'business_payments',
    'business_payment_webhook_events'
  )
order by relation.relname, policy.policyname;

-- 7. Exact function signatures expected by the application.
with expected(signature) as (values
  ('public.get_business_payment_connection()'),
  ('public.create_public_business_order(text,uuid,jsonb,text,text,text,text,numeric,boolean)'),
  ('public.claim_business_order_checkout(uuid)'),
  ('public.complete_business_order_checkout(uuid,text,text)'),
  ('public.fail_business_order_checkout(uuid,boolean,text)'),
  ('public.process_business_payment(text,text,text,text,numeric,text,text,text,timestamp with time zone,jsonb)'),
  ('public.expire_business_orders()'),
  ('public.get_public_business_order(text,uuid)'),
  ('public.get_public_business_storefront_checkout_status(text)'),
  ('public.get_public_business_storefront_products(text)'),
  ('public.get_public_business_storefront_product(text,text)')
)
select signature, to_regprocedure(signature) as installed_function
from expected order by signature;

-- 8. Data-integrity preflight before validating newly added foreign keys. These
-- checks use dynamic SQL so the diagnostic also works when Sprint 4 created no
-- tables at all. Results appear as NOTICE messages.
do $$
declare orphan_rows bigint;
begin
  if to_regclass('public.business_orders') is null then
    raise notice 'Sprint 4 order tables are absent; orphan checks skipped.';
    return;
  end if;

  execute 'select count(*) from public.business_orders child left join auth.users parent on parent.id=child.user_id where parent.id is null' into orphan_rows;
  raise notice 'orders.user_id -> auth.users orphan rows: %', orphan_rows;
  if exists (select 1 from pg_attribute where attrelid='public.business_orders'::regclass and attname='sale_id' and not attisdropped) then
    execute 'select count(*) from public.business_orders child left join public.business_sales parent on parent.id=child.sale_id where child.sale_id is not null and parent.id is null' into orphan_rows;
    raise notice 'orders.sale_id -> sales orphan rows: %', orphan_rows;
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.business_sales'::regclass and attname='order_id' and not attisdropped) then
    execute 'select count(*) from public.business_sales child left join public.business_orders parent on parent.id=child.order_id where child.order_id is not null and parent.id is null' into orphan_rows;
    raise notice 'sales.order_id -> orders orphan rows: %', orphan_rows;
  end if;
  if to_regclass('public.business_order_items') is not null then
    execute 'select count(*) from public.business_order_items child left join public.business_orders parent on parent.id=child.order_id where parent.id is null' into orphan_rows;
    raise notice 'order_items.order_id -> orders orphan rows: %', orphan_rows;
  end if;
  if to_regclass('public.business_stock_reservations') is not null then
    execute 'select count(*) from public.business_stock_reservations child left join public.business_orders parent on parent.id=child.order_id where parent.id is null' into orphan_rows;
    raise notice 'reservations.order_id -> orders orphan rows: %', orphan_rows;
  end if;
  if to_regclass('public.business_payments') is not null then
    execute 'select count(*) from public.business_payments child left join public.business_orders parent on parent.id=child.order_id where parent.id is null' into orphan_rows;
    raise notice 'payments.order_id -> orders orphan rows: %', orphan_rows;
  end if;

  if exists (select 1 from pg_attribute where attrelid='public.business_sales'::regclass and attname='order_id' and not attisdropped)
    and exists (select 1 from pg_attribute where attrelid='public.business_orders'::regclass and attname='sale_id' and not attisdropped) then
    execute 'select count(*) from public.business_orders orders join public.business_sales sales on sales.id=orders.sale_id where sales.order_id is distinct from orders.id' into orphan_rows;
    raise notice 'mismatched order/sale reciprocal pointers: %', orphan_rows;
  end if;
end
$$;

-- 9. Duplicate preflight for every business-identity UNIQUE index. Results are
-- NOTICE messages; every count must be zero before applying the migration.
do $$
declare duplicate_check record; duplicate_groups bigint;
begin
  for duplicate_check in
    select * from (values
      ('public.business_payment_accounts', 'payment account provider user', 'select count(*) from (select provider,provider_user_id from public.business_payment_accounts where provider_user_id is not null group by provider,provider_user_id having count(*)>1) duplicate_rows'),
      ('public.business_orders', 'order idempotency key', 'select count(*) from (select user_id,idempotency_key from public.business_orders group by user_id,idempotency_key having count(*)>1) duplicate_rows'),
      ('public.business_orders', 'order external reference', 'select count(*) from (select provider,provider_external_reference from public.business_orders group by provider,provider_external_reference having count(*)>1) duplicate_rows'),
      ('public.business_order_items', 'order/catalog item', 'select count(*) from (select order_id,catalog_item_id from public.business_order_items group by order_id,catalog_item_id having count(*)>1) duplicate_rows'),
      ('public.business_stock_reservations', 'reservation order/catalog item', 'select count(*) from (select order_id,catalog_item_id from public.business_stock_reservations group by order_id,catalog_item_id having count(*)>1) duplicate_rows'),
      ('public.business_payments', 'provider payment', 'select count(*) from (select provider,provider_payment_id from public.business_payments group by provider,provider_payment_id having count(*)>1) duplicate_rows'),
      ('public.business_payment_webhook_events', 'provider webhook event', 'select count(*) from (select provider,provider_event_id from public.business_payment_webhook_events group by provider,provider_event_id having count(*)>1) duplicate_rows'),
      ('public.business_sales', 'sale order pointer', 'select count(*) from (select order_id from public.business_sales where order_id is not null group by order_id having count(*)>1) duplicate_rows')
    ) checks(table_name, check_name, check_sql)
  loop
    if to_regclass(duplicate_check.table_name) is not null
      and (duplicate_check.table_name <> 'public.business_sales' or exists (
        select 1 from pg_attribute
        where attrelid='public.business_sales'::regclass and attname='order_id' and not attisdropped
      )) then
      execute duplicate_check.check_sql into duplicate_groups;
      raise notice '% duplicate groups: %', duplicate_check.check_name, duplicate_groups;
    end if;
  end loop;
end
$$;
