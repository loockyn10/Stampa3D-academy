begin;

do $$
begin
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'Missing dependency: public.is_admin(uuid)';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing dependency: public.set_updated_at()';
  end if;
end;
$$;

create table if not exists public.stampy_user_action_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_execute_low_risk boolean not null default false,
  auto_execute_filament_movements boolean not null default false,
  auto_execute_create_filament boolean not null default false,
  auto_execute_create_printer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stampy_user_action_settings
  add column if not exists user_id uuid,
  add column if not exists auto_execute_low_risk boolean not null default false,
  add column if not exists auto_execute_filament_movements boolean not null default false,
  add column if not exists auto_execute_create_filament boolean not null default false,
  add column if not exists auto_execute_create_printer boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stampy_user_action_settings'::regclass
      and contype = 'p'
  ) then
    alter table public.stampy_user_action_settings
      add constraint stampy_user_action_settings_pkey primary key (user_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stampy_user_action_settings'::regclass
      and conname = 'stampy_user_action_settings_user_id_fkey'
  ) then
    alter table public.stampy_user_action_settings
      add constraint stampy_user_action_settings_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

drop trigger if exists stampy_user_action_settings_set_updated_at
on public.stampy_user_action_settings;
create trigger stampy_user_action_settings_set_updated_at
before update on public.stampy_user_action_settings
for each row execute function public.set_updated_at();

alter table public.stampy_user_action_settings enable row level security;

drop policy if exists stampy_user_action_settings_select_own
on public.stampy_user_action_settings;
create policy stampy_user_action_settings_select_own
on public.stampy_user_action_settings for select to authenticated
using (user_id = auth.uid());

drop policy if exists stampy_user_action_settings_insert_own
on public.stampy_user_action_settings;
create policy stampy_user_action_settings_insert_own
on public.stampy_user_action_settings for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists stampy_user_action_settings_update_own
on public.stampy_user_action_settings;
create policy stampy_user_action_settings_update_own
on public.stampy_user_action_settings for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists stampy_user_action_settings_admin_all
on public.stampy_user_action_settings;
create policy stampy_user_action_settings_admin_all
on public.stampy_user_action_settings for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.stampy_user_action_settings from public, anon;
grant select, insert, update, delete on table public.stampy_user_action_settings
to authenticated;

notify pgrst, 'reload schema';

commit;
