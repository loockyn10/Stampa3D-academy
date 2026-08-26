begin;

-- This migration depends on the versioned Stampy schema and the shared
-- platform authorization/timestamp helpers. It intentionally fails before
-- making changes when any dependency is missing.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Missing dependency: public.profiles';
  end if;

  if to_regclass('public.stampy_messages') is null then
    raise exception 'Missing dependency: public.stampy_messages';
  end if;

  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;

  if to_regprocedure('public.has_platform_access(uuid)') is null then
    raise exception 'Missing dependency: public.has_platform_access(uuid)';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;
end;
$$;

create table if not exists public.stampy_user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  memory_key text not null,
  memory_value text not null,
  confidence double precision not null default 0.8,
  source_message_id uuid references public.stampy_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stampy_user_memory_fact_key
    unique (user_id, category, memory_key, memory_value),
  constraint stampy_user_memory_category_check
    check (category in ('software', 'hardware', 'printing', 'business', 'workflow')),
  constraint stampy_user_memory_key_check
    check (char_length(btrim(memory_key)) between 1 and 100),
  constraint stampy_user_memory_value_check
    check (char_length(btrim(memory_value)) between 1 and 250),
  constraint stampy_user_memory_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

alter table public.stampy_user_memory
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists category text,
  add column if not exists memory_key text,
  add column if not exists memory_value text,
  add column if not exists confidence double precision default 0.8,
  add column if not exists source_message_id uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. These blocks also align a
-- possible pre-existing unversioned table without changing or deleting rows.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stampy_user_memory'::regclass
      and contype = 'p'
  ) then
    alter table public.stampy_user_memory
      add constraint stampy_user_memory_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stampy_user_memory'::regclass
      and conname = 'stampy_user_memory_user_id_fkey'
  ) then
    alter table public.stampy_user_memory
      add constraint stampy_user_memory_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stampy_user_memory'::regclass
      and conname = 'stampy_user_memory_source_message_id_fkey'
  ) then
    alter table public.stampy_user_memory
      add constraint stampy_user_memory_source_message_id_fkey
      foreign key (source_message_id) references public.stampy_messages(id) on delete set null;
  end if;
end;
$$;

do $constraints$
declare
  constraint_to_add record;
begin
  for constraint_to_add in
    select *
    from (values
      (
        'stampy_user_memory_fact_key',
        'alter table public.stampy_user_memory add constraint stampy_user_memory_fact_key unique (user_id, category, memory_key, memory_value)'
      ),
      (
        'stampy_user_memory_category_check',
        $$alter table public.stampy_user_memory add constraint stampy_user_memory_category_check check (category in ('software', 'hardware', 'printing', 'business', 'workflow'))$$
      ),
      (
        'stampy_user_memory_key_check',
        'alter table public.stampy_user_memory add constraint stampy_user_memory_key_check check (char_length(btrim(memory_key)) between 1 and 100)'
      ),
      (
        'stampy_user_memory_value_check',
        'alter table public.stampy_user_memory add constraint stampy_user_memory_value_check check (char_length(btrim(memory_value)) between 1 and 250)'
      ),
      (
        'stampy_user_memory_confidence_check',
        'alter table public.stampy_user_memory add constraint stampy_user_memory_confidence_check check (confidence >= 0 and confidence <= 1)'
      )
    ) as expected_constraint(constraint_name, definition)
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.stampy_user_memory'::regclass
        and conname = constraint_to_add.constraint_name
    ) then
      execute constraint_to_add.definition;
    end if;
  end loop;
end;
$constraints$;

create index if not exists stampy_user_memory_user_category_updated_at_idx
  on public.stampy_user_memory (user_id, category, updated_at desc);

create index if not exists stampy_user_memory_source_message_id_idx
  on public.stampy_user_memory (source_message_id)
  where source_message_id is not null;

drop trigger if exists stampy_user_memory_set_updated_at on public.stampy_user_memory;
create trigger stampy_user_memory_set_updated_at
before update on public.stampy_user_memory
for each row execute function public.set_updated_at();

alter table public.stampy_user_memory enable row level security;

drop policy if exists stampy_user_memory_select_own on public.stampy_user_memory;
create policy stampy_user_memory_select_own
on public.stampy_user_memory for select to authenticated
using (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
);

drop policy if exists stampy_user_memory_insert_own on public.stampy_user_memory;
create policy stampy_user_memory_insert_own
on public.stampy_user_memory for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and (
    source_message_id is null
    or exists (
      select 1
      from public.stampy_messages as message
      where message.id = stampy_user_memory.source_message_id
        and message.user_id = auth.uid()
    )
  )
);

drop policy if exists stampy_user_memory_update_own on public.stampy_user_memory;
create policy stampy_user_memory_update_own
on public.stampy_user_memory for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.has_platform_access(auth.uid())
  and (
    source_message_id is null
    or exists (
      select 1
      from public.stampy_messages as message
      where message.id = stampy_user_memory.source_message_id
        and message.user_id = auth.uid()
    )
  )
);

drop policy if exists stampy_user_memory_admin_all on public.stampy_user_memory;
create policy stampy_user_memory_admin_all
on public.stampy_user_memory for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Atomic persistence is required for deduplication. Repeated identical facts
-- preserve their original value, confidence and source, refreshing updated_at only.
create or replace function public.save_stampy_user_memory(
  p_user_id uuid,
  p_category text,
  p_memory_key text,
  p_memory_value text,
  p_confidence double precision default 0.8,
  p_source_message_id uuid default null
)
returns public.stampy_user_memory
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_memory public.stampy_user_memory;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using
      errcode = '42501',
      message = 'Cannot save memory for another user';
  end if;

  if not public.has_platform_access(auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'Platform access is required to save Stampy memory';
  end if;

  if p_category is null
     or p_category not in ('software', 'hardware', 'printing', 'business', 'workflow') then
    raise exception using
      errcode = '22023',
      message = 'Invalid Stampy memory category';
  end if;

  if p_memory_key is null
     or char_length(btrim(p_memory_key)) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Invalid Stampy memory key';
  end if;

  if p_memory_value is null
     or char_length(btrim(p_memory_value)) not between 1 and 250 then
    raise exception using
      errcode = '22023',
      message = 'Invalid Stampy memory value';
  end if;

  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception using
      errcode = '22023',
      message = 'Invalid Stampy memory confidence';
  end if;

  if p_source_message_id is not null and not exists (
    select 1
    from public.stampy_messages as message
    where message.id = p_source_message_id
      and message.user_id = auth.uid()
  ) then
    raise exception using
      errcode = '42501',
      message = 'Source message does not belong to the current user';
  end if;

  insert into public.stampy_user_memory (
    user_id,
    category,
    memory_key,
    memory_value,
    confidence,
    source_message_id
  )
  values (
    p_user_id,
    p_category,
    btrim(p_memory_key),
    btrim(p_memory_value),
    p_confidence,
    p_source_message_id
  )
  on conflict (user_id, category, memory_key, memory_value)
  do update set updated_at = now()
  returning * into saved_memory;

  return saved_memory;
end;
$$;

revoke all on table public.stampy_user_memory from public, anon;
grant select, insert, update, delete on table public.stampy_user_memory to authenticated;
grant all on table public.stampy_user_memory to service_role;

revoke all on function public.save_stampy_user_memory(
  uuid, text, text, text, double precision, uuid
) from public, anon, authenticated;
grant execute on function public.save_stampy_user_memory(
  uuid, text, text, text, double precision, uuid
) to authenticated;

notify pgrst, 'reload schema';

commit;
