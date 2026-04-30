-- Hotfix - pending maintenance blocks automatic asset service status
-- Date: 2026-04-29
--
-- Functional rule:
-- - A non-rejected, non-completed maintenance blocks the asset status, including EN_ATTENTE_VALIDATION.
-- - An open incident also blocks the asset status.
-- - The asset returns to EN_SERVICE only when no open incident and no blocking maintenance remains.
-- - REBUS assets always keep REBUS.
--
-- Run after:
-- - sql/hotfix_2026_04_27_maintenance_daf_ceo_sequential_approval.sql
-- - sql/hotfix_2026_04_29_auto_asset_status_after_maintenance_close.sql
-- - sql/hotfix_2026_04_29_auto_asset_status_after_incident_close.sql

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
  v_has_blocking_maintenance boolean;
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
      and upper(coalesce(m.approval_status, '')) <> 'REJETEE'
  )
  into v_has_blocking_maintenance;

  v_next_status := case
    when v_has_open_incident or v_has_blocking_maintenance then 'EN_MAINTENANCE'
    else 'EN_SERVICE'
  end;

  if v_current_status is distinct from v_next_status then
    perform set_config('app.asset_change_source', 'OPERATIONS_AUTO_STATUS', true);
    perform set_config(
      'app.asset_change_reason',
      'Recalcul automatique du statut apres incident ou maintenance bloquante',
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

create or replace function public.recompute_asset_status_after_maintenance_change()
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

revoke all on function public.recompute_asset_status_after_maintenance_change() from public;

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

drop trigger if exists trg_recompute_asset_status_after_maintenance_change on public.maintenance;
create trigger trg_recompute_asset_status_after_maintenance_change
after insert or update of asset_id, status, approval_status, is_completed on public.maintenance
for each row
execute function public.recompute_asset_status_after_maintenance_change();

drop trigger if exists trg_recompute_asset_status_after_incident_change on public.incidents;
create trigger trg_recompute_asset_status_after_incident_change
after insert or update of asset_id, status on public.incidents
for each row
execute function public.recompute_asset_status_after_incident_change();

-- One-time reconciliation for assets where the stored status no longer matches
-- open incidents or blocking maintenance tickets.
with candidate_assets as (
  select a.id as asset_id
  from public.assets a
  where upper(coalesce(a.status, '')) <> 'REBUS'
    and (
      exists (
        select 1
        from public.incidents i
        where i.asset_id = a.id
          and upper(coalesce(i.status, '')) <> 'RESOLU'
      )
      or exists (
        select 1
        from public.maintenance m
        where m.asset_id = a.id
          and coalesce(m.is_completed, false) = false
          and upper(coalesce(m.status, '')) <> 'TERMINEE'
          and upper(coalesce(m.approval_status, '')) <> 'REJETEE'
      )
      or upper(coalesce(a.status, '')) = 'EN_MAINTENANCE'
    )
)
select public.recompute_asset_status_from_operations(asset_id)
from candidate_assets;

-- Verification examples:
--
-- 1) Verify triggers.
-- select
--   tgname,
--   tgrelid::regclass as table_name,
--   pg_get_triggerdef(oid) as definition
-- from pg_trigger
-- where tgname in (
--   'trg_recompute_asset_status_after_maintenance_change',
--   'trg_recompute_asset_status_after_incident_change'
-- )
-- order by tgname;
--
-- 2) Verify one asset blocking flags.
-- select
--   a.id,
--   a.name,
--   a.status,
--   exists (
--     select 1
--     from public.incidents i
--     where i.asset_id = a.id
--       and upper(coalesce(i.status, '')) <> 'RESOLU'
--   ) as has_open_incident,
--   exists (
--     select 1
--     from public.maintenance m
--     where m.asset_id = a.id
--       and coalesce(m.is_completed, false) = false
--       and upper(coalesce(m.status, '')) <> 'TERMINEE'
--       and upper(coalesce(m.approval_status, '')) <> 'REJETEE'
--   ) as has_blocking_maintenance
-- from public.assets a
-- where a.id = '<ASSET_UUID>';
--
-- 3) List inconsistent assets after the hotfix. Expected result: 0 rows.
-- with flags as (
--   select
--     a.id,
--     a.name,
--     a.status,
--     exists (
--       select 1 from public.incidents i
--       where i.asset_id = a.id
--         and upper(coalesce(i.status, '')) <> 'RESOLU'
--     ) as has_open_incident,
--     exists (
--       select 1 from public.maintenance m
--       where m.asset_id = a.id
--         and coalesce(m.is_completed, false) = false
--         and upper(coalesce(m.status, '')) <> 'TERMINEE'
--         and upper(coalesce(m.approval_status, '')) <> 'REJETEE'
--     ) as has_blocking_maintenance
--   from public.assets a
--   where upper(coalesce(a.status, '')) <> 'REBUS'
-- )
-- select *
-- from flags
-- where (
--   (has_open_incident or has_blocking_maintenance)
--   and upper(coalesce(status, '')) <> 'EN_MAINTENANCE'
-- )
-- or (
--   not has_open_incident
--   and not has_blocking_maintenance
--   and upper(coalesce(status, '')) <> 'EN_SERVICE'
-- );
