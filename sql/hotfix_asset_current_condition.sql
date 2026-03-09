-- Hotfix - Asset current condition field
-- Date: 2026-03-09
--
-- Adds current_condition with fixed allowed values used by the UI filters.

alter table if exists public.assets
  add column if not exists current_condition text default 'BON';

update public.assets
set current_condition = upper(coalesce(current_condition, 'BON'))
where current_condition is null or current_condition <> upper(current_condition);

update public.assets
set current_condition = 'BON'
where current_condition not in ('MAUVAIS', 'MOYEN', 'ASSEZ_BON', 'BON', 'NEUF');

alter table if exists public.assets
  drop constraint if exists assets_current_condition_check;

alter table if exists public.assets
  add constraint assets_current_condition_check
  check (current_condition in ('MAUVAIS', 'MOYEN', 'ASSEZ_BON', 'BON', 'NEUF'));

-- Optional quick check:
-- select current_condition, count(*) from public.assets group by current_condition order by current_condition;
