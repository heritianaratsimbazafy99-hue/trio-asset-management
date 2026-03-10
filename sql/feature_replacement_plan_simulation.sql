-- Feature - Replacement plan simulation defaults by company
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/security_admin_audit_upgrade.sql
-- 2) sql/feature_lot3_workflow_roles_and_asset_history.sql

alter table if exists public.company_scoring_config
  add column if not exists replacement_horizon_years integer default 5,
  add column if not exists replacement_capex_ratio numeric default 100,
  add column if not exists replacement_new_asset_opex_ratio numeric default 8,
  add column if not exists replacement_old_asset_opex_growth numeric default 15,
  add column if not exists replacement_salvage_value_ratio numeric default 0;

update public.company_scoring_config
set
  replacement_horizon_years = coalesce(replacement_horizon_years, 5),
  replacement_capex_ratio = coalesce(replacement_capex_ratio, 100),
  replacement_new_asset_opex_ratio = coalesce(replacement_new_asset_opex_ratio, 8),
  replacement_old_asset_opex_growth = coalesce(replacement_old_asset_opex_growth, 15),
  replacement_salvage_value_ratio = coalesce(replacement_salvage_value_ratio, 0),
  updated_at = now()
where
  replacement_horizon_years is null
  or replacement_capex_ratio is null
  or replacement_new_asset_opex_ratio is null
  or replacement_old_asset_opex_growth is null
  or replacement_salvage_value_ratio is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_scoring_config_replacement_horizon_check'
      and conrelid = 'public.company_scoring_config'::regclass
  ) then
    alter table public.company_scoring_config
      add constraint company_scoring_config_replacement_horizon_check
      check (replacement_horizon_years between 1 and 15);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_scoring_config_replacement_ratios_check'
      and conrelid = 'public.company_scoring_config'::regclass
  ) then
    alter table public.company_scoring_config
      add constraint company_scoring_config_replacement_ratios_check
      check (
        replacement_capex_ratio >= 0
        and replacement_new_asset_opex_ratio >= 0
        and replacement_old_asset_opex_growth >= 0
        and replacement_salvage_value_ratio >= 0
      );
  end if;
end $$;

comment on column public.company_scoring_config.replacement_horizon_years is
  'Default simulation horizon for replacement plan in years.';

comment on column public.company_scoring_config.replacement_capex_ratio is
  'Default CAPEX estimate as % of current reference value.';

comment on column public.company_scoring_config.replacement_new_asset_opex_ratio is
  'Default annual OPEX estimate for the replacement asset as % of CAPEX.';

comment on column public.company_scoring_config.replacement_old_asset_opex_growth is
  'Default yearly growth rate for current asset OPEX during keep scenario.';

comment on column public.company_scoring_config.replacement_salvage_value_ratio is
  'Default recovery % applied to current VNC in replacement scenario.';

insert into public.company_scoring_config (company_id)
select o.id
from public.organisations o
where not exists (
  select 1
  from public.company_scoring_config c
  where c.company_id = o.id
);
