-- Calculator Free: persistent catalog preferences without creating physical workshop inventory.

do $calculator_free_dependencies$
begin
  if to_regclass('public.profiles') is null then raise exception 'Missing dependency: public.profiles'; end if;
  if to_regclass('public.printer_templates') is null then raise exception 'Missing dependency: public.printer_templates'; end if;
  if to_regclass('public.filament_templates') is null then raise exception 'Missing dependency: public.filament_templates'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
  if to_regprocedure('public.has_platform_access(uuid)') is null then raise exception 'Missing dependency: public.has_platform_access(uuid)'; end if;
  if to_regprocedure('public.set_updated_at()') is null then raise exception 'Missing dependency: public.set_updated_at()'; end if;
end;
$calculator_free_dependencies$;

create table if not exists public.calculator_user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  default_printer_template_id uuid references public.printer_templates(id) on delete set null,
  default_filament_template_id uuid references public.filament_templates(id) on delete set null,
  onboarding_status text not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $calculator_free_status_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calculator_user_preferences'::regclass
      and conname = 'calculator_user_preferences_onboarding_status_check'
  ) then
    alter table public.calculator_user_preferences
      add constraint calculator_user_preferences_onboarding_status_check
      check (onboarding_status in ('pending', 'completed', 'skipped'));
  end if;
end;
$calculator_free_status_constraint$;

create index if not exists calculator_user_preferences_printer_idx
  on public.calculator_user_preferences(default_printer_template_id);
create index if not exists calculator_user_preferences_filament_idx
  on public.calculator_user_preferences(default_filament_template_id);

drop trigger if exists calculator_user_preferences_set_updated_at on public.calculator_user_preferences;
create trigger calculator_user_preferences_set_updated_at
before update on public.calculator_user_preferences
for each row execute function public.set_updated_at();

alter table public.calculator_user_preferences enable row level security;

drop policy if exists calculator_user_preferences_select_own on public.calculator_user_preferences;
create policy calculator_user_preferences_select_own
on public.calculator_user_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists calculator_user_preferences_insert_own on public.calculator_user_preferences;
create policy calculator_user_preferences_insert_own
on public.calculator_user_preferences for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists calculator_user_preferences_update_own on public.calculator_user_preferences;
create policy calculator_user_preferences_update_own
on public.calculator_user_preferences for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists calculator_user_preferences_admin_all on public.calculator_user_preferences;
create policy calculator_user_preferences_admin_all
on public.calculator_user_preferences for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.calculator_user_preferences from public, anon;
grant select, insert, update on table public.calculator_user_preferences to authenticated;

-- Existing calculator tables used to assume that every authenticated account was paid.
-- Restrictive policies keep all existing ownership policies while adding the paid-access requirement.
do $calculator_premium_rls$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'filaments',
    'printers',
    'filament_templates',
    'printer_templates',
    'products',
    'product_components',
    'product_component_filaments',
    'calculator_settings',
    'calculator_product_types',
    'product_price_history',
    'stampy_user_action_settings'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      policy_name := 'calculator_free_requires_platform_access';
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid())) with check (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))',
        policy_name,
        table_name
      );
    end if;
  end loop;
end;
$calculator_premium_rls$;

do $calculator_catalog_paid_read$
declare
  table_name text;
begin
  foreach table_name in array array['printer_templates', 'filament_templates']
  loop
    execute format('drop policy if exists calculator_catalog_select_paid on public.%I', table_name);
    execute format(
      'create policy calculator_catalog_select_paid on public.%I for select to authenticated using (public.has_platform_access(auth.uid()) or public.is_admin(auth.uid()))',
      table_name
    );
  end loop;
end;
$calculator_catalog_paid_read$;

notify pgrst, 'reload schema';
