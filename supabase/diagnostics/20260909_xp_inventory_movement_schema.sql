-- Read-only diagnostic for the XP V1 migration.
-- Run manually in Supabase before re-running the migration. Every statement is SELECT-only.

-- 1. Exact columns and types of both movement ledgers.
select
  columns.table_schema,
  columns.table_name,
  columns.ordinal_position,
  columns.column_name,
  columns.data_type,
  columns.udt_schema,
  columns.udt_name,
  columns.is_nullable,
  columns.column_default
from information_schema.columns as columns
where columns.table_schema = 'public'
  and columns.table_name in ('business_inventory_movements', 'product_stock_movements')
order by columns.table_name, columns.ordinal_position;

-- 2. CHECK/UNIQUE/FK definitions that constrain the commercial movement table.
select
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  pg_get_constraintdef(constraint_row.oid, true) as definition
from pg_constraint as constraint_row
where constraint_row.conrelid = 'public.business_inventory_movements'::regclass
order by constraint_row.conname;

-- 3. Real commercial movement kinds and their direction. This confirms the
--    candidates for stock XP without exposing row-level user details.
select
  movement.movement_type,
  case
    when movement.quantity_delta > 0 then 'increase'
    when movement.quantity_delta < 0 then 'decrease'
    else 'zero'
  end as direction,
  count(*) as movements
from public.business_inventory_movements as movement
group by movement.movement_type, direction
order by movement.movement_type, direction;

-- 4. References identify scanner/provider receipts separately from sales and
--    other generated movements.
select
  movement.movement_type,
  coalesce(movement.reference, '<null>') as reference,
  count(*) as movements
from public.business_inventory_movements as movement
group by movement.movement_type, coalesce(movement.reference, '<null>')
order by movement.movement_type, movements desc, reference;

-- 5. Schema-drift-safe inventory of keys present in historical product stock rows.
select observed.key, count(*) as rows_with_key
from public.product_stock_movements as movement
cross join lateral jsonb_object_keys(to_jsonb(movement)) as observed(key)
group by observed.key
order by observed.key;

-- 6. Values used as movement kind by the historical product ledger. This works
--    whether the remote table uses `movement_type`, `type`, or neither.
select
  coalesce(
    nullif(to_jsonb(movement) ->> 'movement_type', ''),
    nullif(to_jsonb(movement) ->> 'type', ''),
    '<missing>'
  ) as movement_kind,
  count(*) as movements
from public.product_stock_movements as movement
group by movement_kind
order by movements desc, movement_kind;

-- 7. Rows the corrected launch backfill would consider verified production.
select
  movement.id,
  movement.user_id,
  movement.created_at,
  coalesce(
    nullif(to_jsonb(movement) ->> 'movement_type', ''),
    nullif(to_jsonb(movement) ->> 'type', ''),
    '<missing>'
  ) as movement_kind,
  coalesce(
    nullif(to_jsonb(movement) ->> 'quantity', '')::numeric,
    nullif(to_jsonb(movement) ->> 'quantity_delta', '')::numeric,
    0
  ) as quantity,
  to_jsonb(movement) ->> 'reason' as reason,
  to_jsonb(movement) ->> 'source_type' as source_type
from public.product_stock_movements as movement
where coalesce(
    nullif(to_jsonb(movement) ->> 'quantity', '')::numeric,
    nullif(to_jsonb(movement) ->> 'quantity_delta', '')::numeric,
    0
  ) > 0
  and (
    coalesce(to_jsonb(movement) ->> 'reason', '') ilike '%producci%'
    or lower(coalesce(to_jsonb(movement) ->> 'source_type', '')) in ('production', 'product_production')
  )
  and coalesce(
    lower(nullif(to_jsonb(movement) ->> 'movement_type', '')),
    lower(nullif(to_jsonb(movement) ->> 'type', '')),
    'add'
  ) in ('add', 'manual_add', 'production')
order by movement.created_at, movement.id;

-- 8. Detect a partial migration and, especially, whether the internal award
--    engine was left executable before the final REVOKE statements.
select
  to_regclass('public.user_xp_events') as xp_events_table,
  to_regclass('public.user_xp_summary') as xp_summary_table,
  to_regprocedure('public.award_user_xp(uuid,text,text,uuid,text,timestamptz,jsonb)') as award_function,
  case
    when to_regprocedure('public.award_user_xp(uuid,text,text,uuid,text,timestamptz,jsonb)') is null then null
    else has_function_privilege(
      'authenticated',
      'public.award_user_xp(uuid,text,text,uuid,text,timestamptz,jsonb)',
      'EXECUTE'
    )
  end as authenticated_can_execute_award;
