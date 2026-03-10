-- Feature - Configurable rules engine by company
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/security_admin_audit_upgrade.sql
-- 2) sql/feature_replacement_plan_simulation.sql

create table if not exists public.company_rule_configs (
  id bigserial primary key,
  company_id uuid not null references public.organisations(id) on delete cascade,
  rule_code text not null,
  rule_name text not null,
  scope text not null default 'ASSET',
  comparator text not null default '>',
  threshold_value numeric default 0,
  severity text not null default 'WARNING',
  is_enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rule_code)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_rule_configs_scope_check'
      and conrelid = 'public.company_rule_configs'::regclass
  ) then
    alter table public.company_rule_configs
      add constraint company_rule_configs_scope_check
      check (upper(coalesce(scope, '')) in ('ASSET', 'DATA'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_rule_configs_comparator_check'
      and conrelid = 'public.company_rule_configs'::regclass
  ) then
    alter table public.company_rule_configs
      add constraint company_rule_configs_comparator_check
      check (comparator in ('>', '>=', '<', '<=', '=', '!='));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_rule_configs_severity_check'
      and conrelid = 'public.company_rule_configs'::regclass
  ) then
    alter table public.company_rule_configs
      add constraint company_rule_configs_severity_check
      check (upper(coalesce(severity, '')) in ('INFO', 'WARNING', 'CRITICAL'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_rule_configs_params_object_check'
      and conrelid = 'public.company_rule_configs'::regclass
  ) then
    alter table public.company_rule_configs
      add constraint company_rule_configs_params_object_check
      check (jsonb_typeof(params) = 'object');
  end if;
end $$;

create index if not exists idx_company_rule_configs_company_scope
on public.company_rule_configs (company_id, scope, is_enabled);

alter table if exists public.company_rule_configs enable row level security;

drop policy if exists company_rule_configs_select_authenticated on public.company_rule_configs;
drop policy if exists company_rule_configs_insert_ceo on public.company_rule_configs;
drop policy if exists company_rule_configs_update_ceo on public.company_rule_configs;
drop policy if exists company_rule_configs_delete_ceo on public.company_rule_configs;

create policy company_rule_configs_select_authenticated
on public.company_rule_configs
for select
using (auth.role() = 'authenticated');

create policy company_rule_configs_insert_ceo
on public.company_rule_configs
for insert
with check (public.is_ceo());

create policy company_rule_configs_update_ceo
on public.company_rule_configs
for update
using (public.is_ceo())
with check (public.is_ceo());

create policy company_rule_configs_delete_ceo
on public.company_rule_configs
for delete
using (public.is_ceo());

grant select, insert, update, delete on public.company_rule_configs to authenticated;
grant usage, select on sequence public.company_rule_configs_id_seq to authenticated;

insert into public.company_rule_configs (
  company_id,
  rule_code,
  rule_name,
  scope,
  comparator,
  threshold_value,
  severity,
  is_enabled,
  params
)
select
  o.id,
  seed.rule_code,
  seed.rule_name,
  seed.scope,
  seed.comparator,
  seed.threshold_value,
  seed.severity,
  seed.is_enabled,
  seed.params
from public.organisations o
cross join (
  values
    (
      'ASSET_INCIDENTS_12M',
      'Incidents 12 mois',
      'ASSET',
      '>',
      3::numeric,
      'WARNING',
      true,
      '{"unit":"count"}'::jsonb
    ),
    (
      'ASSET_MAINTENANCE_RATIO',
      'Ratio maintenance / valeur',
      'ASSET',
      '>',
      40::numeric,
      'CRITICAL',
      true,
      '{"unit":"percent"}'::jsonb
    ),
    (
      'ASSET_VNC_RATE',
      'Taux VNC résiduelle',
      'ASSET',
      '<=',
      25::numeric,
      'WARNING',
      true,
      '{"unit":"percent"}'::jsonb
    ),
    (
      'ASSET_OVERDUE_MAINTENANCE_COUNT',
      'Maintenances en retard',
      'ASSET',
      '>=',
      1::numeric,
      'WARNING',
      true,
      '{"unit":"count"}'::jsonb
    ),
    (
      'DATA_MISSING_PURCHASE_VALUE',
      'Actifs sans valeur d''achat',
      'DATA',
      '>',
      0::numeric,
      'CRITICAL',
      true,
      '{"unit":"count"}'::jsonb
    ),
    (
      'DATA_MISSING_COMPANY',
      'Actifs sans société',
      'DATA',
      '>',
      0::numeric,
      'CRITICAL',
      true,
      '{"unit":"count"}'::jsonb
    ),
    (
      'DATA_MISSING_AMORTIZATION',
      'Amortissement incomplet',
      'DATA',
      '>',
      0::numeric,
      'WARNING',
      true,
      '{"unit":"count"}'::jsonb
    ),
    (
      'DATA_MAINTENANCE_MISSING_DEADLINE',
      'Maintenance sans deadline',
      'DATA',
      '>',
      0::numeric,
      'WARNING',
      true,
      '{"unit":"count"}'::jsonb
    )
) as seed(rule_code, rule_name, scope, comparator, threshold_value, severity, is_enabled, params)
where not exists (
  select 1
  from public.company_rule_configs existing
  where existing.company_id = o.id
    and existing.rule_code = seed.rule_code
);
