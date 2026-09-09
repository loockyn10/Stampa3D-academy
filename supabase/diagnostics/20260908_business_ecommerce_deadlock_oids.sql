-- Read-only diagnostic. Run in the same Supabase database where 40P01 occurred.
select
  relation.oid,
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  relation.relkind,
  case relation.relkind
    when 'r' then 'table'
    when 'i' then 'index'
    when 'S' then 'sequence'
    when 'v' then 'view'
    when 'm' then 'materialized view'
    when 'p' then 'partitioned table'
    else relation.relkind::text
  end as relation_kind
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
where relation.oid in (17181, 20672)
order by relation.oid;

-- If either relation is still involved in active waits, this second query shows
-- the current holders/waiters. A completed deadlock may legitimately return no rows.
select
  lock.pid,
  lock.relation,
  lock.relation::regclass as relation_name,
  lock.mode,
  lock.granted,
  activity.usename,
  activity.application_name,
  activity.state,
  activity.wait_event_type,
  activity.wait_event,
  left(activity.query, 500) as current_query
from pg_locks lock
left join pg_stat_activity activity on activity.pid = lock.pid
where lock.relation in (17181, 20672)
order by lock.relation, lock.granted, lock.pid;
