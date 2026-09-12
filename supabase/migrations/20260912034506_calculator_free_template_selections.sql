-- Calculator Free selections reference shared templates without creating physical workshop inventory.

do $calculator_selection_dependencies$
begin
  if to_regclass('public.profiles') is null then raise exception 'Missing dependency: public.profiles'; end if;
  if to_regclass('public.printer_templates') is null then raise exception 'Missing dependency: public.printer_templates'; end if;
  if to_regclass('public.filament_templates') is null then raise exception 'Missing dependency: public.filament_templates'; end if;
  if to_regclass('public.calculator_user_preferences') is null then raise exception 'Missing dependency: public.calculator_user_preferences'; end if;
  if to_regprocedure('public.is_admin(uuid)') is null then raise exception 'Missing dependency: public.is_admin(uuid)'; end if;
end;
$calculator_selection_dependencies$;

create table if not exists public.calculator_user_printer_templates (
  user_id uuid not null references public.profiles(id) on delete cascade,
  printer_template_id uuid not null references public.printer_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, printer_template_id)
);

create table if not exists public.calculator_user_filament_templates (
  user_id uuid not null references public.profiles(id) on delete cascade,
  filament_template_id uuid not null references public.filament_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, filament_template_id)
);

create index if not exists calculator_user_printer_templates_template_idx
  on public.calculator_user_printer_templates(printer_template_id);
create index if not exists calculator_user_filament_templates_template_idx
  on public.calculator_user_filament_templates(filament_template_id);

-- Preserve defaults already chosen before multiple selections were introduced.
insert into public.calculator_user_printer_templates (user_id, printer_template_id)
select user_id, default_printer_template_id
from public.calculator_user_preferences
where default_printer_template_id is not null
on conflict (user_id, printer_template_id) do nothing;

insert into public.calculator_user_filament_templates (user_id, filament_template_id)
select user_id, default_filament_template_id
from public.calculator_user_preferences
where default_filament_template_id is not null
on conflict (user_id, filament_template_id) do nothing;

do $calculator_selection_default_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calculator_user_preferences'::regclass
      and conname = 'calculator_preferences_default_printer_selection_fk'
  ) then
    alter table public.calculator_user_preferences
      add constraint calculator_preferences_default_printer_selection_fk
      foreign key (user_id, default_printer_template_id)
      references public.calculator_user_printer_templates(user_id, printer_template_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calculator_user_preferences'::regclass
      and conname = 'calculator_preferences_default_filament_selection_fk'
  ) then
    alter table public.calculator_user_preferences
      add constraint calculator_preferences_default_filament_selection_fk
      foreign key (user_id, default_filament_template_id)
      references public.calculator_user_filament_templates(user_id, filament_template_id);
  end if;
end;
$calculator_selection_default_constraints$;

alter table public.calculator_user_printer_templates enable row level security;
alter table public.calculator_user_filament_templates enable row level security;

drop policy if exists calculator_printer_templates_select_own on public.calculator_user_printer_templates;
create policy calculator_printer_templates_select_own
on public.calculator_user_printer_templates for select to authenticated
using (user_id = auth.uid());

drop policy if exists calculator_printer_templates_insert_own on public.calculator_user_printer_templates;
create policy calculator_printer_templates_insert_own
on public.calculator_user_printer_templates for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists calculator_printer_templates_delete_own on public.calculator_user_printer_templates;
create policy calculator_printer_templates_delete_own
on public.calculator_user_printer_templates for delete to authenticated
using (user_id = auth.uid());

drop policy if exists calculator_printer_templates_admin_all on public.calculator_user_printer_templates;
create policy calculator_printer_templates_admin_all
on public.calculator_user_printer_templates for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists calculator_filament_templates_select_own on public.calculator_user_filament_templates;
create policy calculator_filament_templates_select_own
on public.calculator_user_filament_templates for select to authenticated
using (user_id = auth.uid());

drop policy if exists calculator_filament_templates_insert_own on public.calculator_user_filament_templates;
create policy calculator_filament_templates_insert_own
on public.calculator_user_filament_templates for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists calculator_filament_templates_delete_own on public.calculator_user_filament_templates;
create policy calculator_filament_templates_delete_own
on public.calculator_user_filament_templates for delete to authenticated
using (user_id = auth.uid());

drop policy if exists calculator_filament_templates_admin_all on public.calculator_user_filament_templates;
create policy calculator_filament_templates_admin_all
on public.calculator_user_filament_templates for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke all on table public.calculator_user_printer_templates from public, anon;
revoke all on table public.calculator_user_filament_templates from public, anon;
grant select, insert, delete on table public.calculator_user_printer_templates to authenticated;
grant select, insert, delete on table public.calculator_user_filament_templates to authenticated;
grant select on table public.calculator_user_printer_templates to service_role;
grant select on table public.calculator_user_filament_templates to service_role;

notify pgrst, 'reload schema';
