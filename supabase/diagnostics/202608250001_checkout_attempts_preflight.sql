-- Read-only preflight for the checkout_attempts migration.
-- Run this first in the Supabase SQL editor. It does not modify data.

-- 1. The migration/RPC expects these existing subscription columns.
select
  required.column_name,
  columns.data_type,
  (columns.column_name is not null) as column_present
from (
  values
    ('id'),
    ('user_id'),
    ('mercado_pago_preapproval_id'),
    ('status'),
    ('payer_email'),
    ('amount'),
    ('currency'),
    ('raw_data'),
    ('next_payment_at'),
    ('created_at'),
    ('updated_at')
) as required(column_name)
left join information_schema.columns as columns
  on columns.table_schema = 'public'
 and columns.table_name = 'subscriptions'
 and columns.column_name = required.column_name
order by required.column_name;

-- 2. Existing duplicate Mercado Pago IDs. This sprint does not add or change
-- constraints on subscriptions, but duplicates should be reviewed before deploy.
select
  mercado_pago_preapproval_id,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as subscription_ids,
  array_agg(user_id order by created_at) as user_ids
from public.subscriptions
where mercado_pago_preapproval_id is not null
group by mercado_pago_preapproval_id
having count(*) > 1
order by duplicate_count desc, mercado_pago_preapproval_id;

-- 3. Users that already have more than one locally open subscription.
-- These rows are not changed by this migration; the new checkout RPC will block
-- a new preapproval while any of these records remains open.
select
  user_id,
  count(*) as open_subscription_count,
  array_agg(id order by created_at) as subscription_ids,
  array_agg(status order by created_at) as statuses,
  array_agg(mercado_pago_preapproval_id order by created_at) as preapproval_ids
from public.subscriptions
where lower(coalesce(status, '')) in ('pending', 'authorized', 'active', 'paused')
group by user_id
having count(*) > 1
order by open_subscription_count desc, user_id;

-- 4. Inventory of current local statuses, useful to detect spellings the RPC
-- does not know about before deployment.
select
  coalesce(status, '<null>') as status,
  count(*) as row_count
from public.subscriptions
group by status
order by row_count desc, status;
