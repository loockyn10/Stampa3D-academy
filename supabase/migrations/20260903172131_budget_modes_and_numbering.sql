-- Presupuestos rápidos/profesionales, IVA y numeración humana.
-- Esta migración no altera ni elimina presupuestos o items existentes.

do $$
begin
  if to_regclass('public.budgets') is null then
    raise exception 'Required table public.budgets does not exist';
  end if;
  if to_regclass('public.clients') is null then
    raise exception 'Required table public.clients does not exist';
  end if;
end
$$;

alter table public.budgets
  add column if not exists budget_type text not null default 'quick',
  add column if not exists tax_rate numeric(4, 1) not null default 0,
  add column if not exists tax_amount numeric(14, 2) not null default 0,
  add column if not exists payment_terms text,
  add column if not exists delivery_time text,
  add column if not exists delivery_method text,
  add column if not exists commercial_conditions text,
  add column if not exists budget_number bigint;

alter table public.clients
  add column if not exists address text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_budget_type_check'
  ) then
    alter table public.budgets
      add constraint budgets_budget_type_check
      check (budget_type in ('quick', 'professional'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_tax_rate_check'
  ) then
    alter table public.budgets
      add constraint budgets_tax_rate_check
      check (tax_rate in (0, 10.5, 21));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_tax_amount_check'
  ) then
    alter table public.budgets
      add constraint budgets_tax_amount_check
      check (tax_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass
      and conname = 'budgets_budget_number_check'
  ) then
    alter table public.budgets
      add constraint budgets_budget_number_check
      check (budget_number is null or budget_number > 0);
  end if;
end
$$;

create sequence if not exists public.budgets_human_number_seq
  as bigint
  start with 1
  increment by 1
  no cycle;

-- Existing rows receive stable, unique numbers in creation order.
with current_max as (
  select greatest(coalesce(max(budget_number), 0), 0) as value
  from public.budgets
), pending as (
  select
    id,
    row_number() over (order by created_at nulls last, id) as position
  from public.budgets
  where budget_number is null
)
update public.budgets as budget
set budget_number = current_max.value + pending.position
from current_max, pending
where budget.id = pending.id;

do $$
declare
  highest_number bigint;
begin
  select max(budget_number) into highest_number from public.budgets;
  if highest_number is null then
    perform setval('public.budgets_human_number_seq'::regclass, 1, false);
  else
    perform setval('public.budgets_human_number_seq'::regclass, highest_number, true);
  end if;
end
$$;

create unique index if not exists budgets_budget_number_unique_idx
  on public.budgets (budget_number);

alter table public.budgets
  alter column budget_number set not null;

create or replace function public.assign_budget_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.budget_number := nextval('public.budgets_human_number_seq'::regclass);
  return new;
end;
$$;

revoke all on function public.assign_budget_number() from public, anon, authenticated;

drop trigger if exists assign_budget_number_before_insert on public.budgets;
create trigger assign_budget_number_before_insert
before insert on public.budgets
for each row
execute function public.assign_budget_number();

notify pgrst, 'reload schema';
