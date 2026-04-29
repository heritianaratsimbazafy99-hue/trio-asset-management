-- Hotfix - automatically recalculate asset status after incident changes
-- Date: 2026-04-29
--
-- Business rule:
-- - When an incident is opened, resolved, or moved to another asset, the linked asset status is recalculated automatically.
-- - If no open incident and no active maintenance remains, the asset returns to EN_SERVICE.
-- - If an open incident or active maintenance remains, the asset stays EN_MAINTENANCE.
-- - REBUS assets keep their REBUS status.
--
-- Run after:
-- - sql/feature_lot3_workflow_roles_and_asset_history.sql
-- - sql/hotfix_2026_04_29_auto_asset_status_after_maintenance_close.sql if used

create or replace function public.recompute_asset_status_from_operations(
  p_asset_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_next_status text;
  v_has_open_incident boolean;
  v_has_active_maintenance boolean;
begin
  if p_asset_id is null then
    return null;
  end if;

  select upper(coalesce(a.status, ''))
  into v_current_status
  from public.assets a
  where a.id = p_asset_id
  for update;

  if not found then
    return null;
  end if;

  if v_current_status = 'REBUS' then
    return 'REBUS';
  end if;

  select exists (
    select 1
    from public.incidents i
    where i.asset_id = p_asset_id
      and upper(coalesce(i.status, '')) <> 'RESOLU'
  )
  into v_has_open_incident;

  select exists (
    select 1
    from public.maintenance m
    where m.asset_id = p_asset_id
      and coalesce(m.is_completed, false) = false
      and upper(coalesce(m.status, '')) <> 'TERMINEE'
      and upper(coalesce(m.approval_status, '')) not in ('REJETEE', 'EN_ATTENTE_VALIDATION')
  )
  into v_has_active_maintenance;

  v_next_status := case
    when v_has_open_incident or v_has_active_maintenance then 'EN_MAINTENANCE'
    else 'EN_SERVICE'
  end;

  if v_current_status is distinct from v_next_status then
    perform set_config('app.asset_change_source', 'OPERATIONS_AUTO_STATUS', true);
    perform set_config(
      'app.asset_change_reason',
      'Recalcul automatique du statut apres changement incident ou maintenance',
      true
    );

    update public.assets
    set status = v_next_status
    where id = p_asset_id
      and upper(coalesce(status, '')) <> v_next_status
      and upper(coalesce(status, '')) <> 'REBUS';

    perform set_config('app.asset_change_source', '', true);
    perform set_config('app.asset_change_reason', '', true);
  end if;

  return v_next_status;
exception
  when others then
    perform set_config('app.asset_change_source', '', true);
    perform set_config('app.asset_change_reason', '', true);
    raise;
end;
$$;

revoke all on function public.recompute_asset_status_from_operations(uuid) from public;

create or replace function public.recompute_asset_status_after_incident_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.asset_id is not null
       and old.asset_id is distinct from new.asset_id then
      perform public.recompute_asset_status_from_operations(old.asset_id);
    end if;
  end if;

  if new.asset_id is not null then
    perform public.recompute_asset_status_from_operations(new.asset_id);
  end if;

  return new;
end;
$$;

revoke all on function public.recompute_asset_status_after_incident_change() from public;

drop trigger if exists trg_recompute_asset_status_after_incident_change on public.incidents;
create trigger trg_recompute_asset_status_after_incident_change
after insert or update of asset_id, status on public.incidents
for each row
execute function public.recompute_asset_status_after_incident_change();

-- Optional one-time reconciliation for assets still marked EN_MAINTENANCE after already resolved incidents.
-- Safe to run because active incidents/maintenance keep EN_MAINTENANCE and REBUS assets are ignored by the helper.
with candidate_assets as (
  select a.id as asset_id
  from public.assets a
  where upper(coalesce(a.status, '')) = 'EN_MAINTENANCE'
)
select public.recompute_asset_status_from_operations(asset_id)
from candidate_assets;

-- Verification examples:
--
-- 1) Verify the incident trigger exists.
-- select
--   tgname,
--   tgrelid::regclass as table_name
-- from pg_trigger
-- where tgname = 'trg_recompute_asset_status_after_incident_change';
--
-- 2) Verify one asset blocking flags.
-- select
--   a.id,
--   a.name,
--   a.status,
--   exists (
--     select 1 from public.incidents i
--     where i.asset_id = a.id and upper(coalesce(i.status, '')) <> 'RESOLU'
--   ) as has_open_incident,
--   exists (
--     select 1 from public.maintenance m
--     where m.asset_id = a.id
--       and coalesce(m.is_completed, false) = false
--       and upper(coalesce(m.status, '')) <> 'TERMINEE'
--       and upper(coalesce(m.approval_status, '')) not in ('REJETEE', 'EN_ATTENTE_VALIDATION')
--   ) as has_active_maintenance
-- from public.assets a
-- where a.id = '<ASSET_UUID>';
--
-- 3) Verify recent automatic status history.
-- select
--   asset_id,
--   changed_fields,
--   change_source,
--   change_reason,
--   created_at
-- from public.asset_change_history
-- where change_source in ('OPERATIONS_AUTO_STATUS', 'MAINTENANCE_CLOSE_AUTO_STATUS')
-- order by created_at desc
-- limit 20;
