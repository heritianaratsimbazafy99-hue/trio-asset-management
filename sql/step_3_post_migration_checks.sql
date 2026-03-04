-- Step 3 - Post-migration checks
-- Date: 2026-03-04

-- This script raises an exception if a critical object is missing.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'assets'
      and policyname = 'assets_update_authorized_roles'
  ) then
    raise exception 'Missing policy public.assets_update_authorized_roles';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.assets'::regclass
      and tgname = 'trg_guard_asset_sensitive_fields'
      and not tgisinternal
  ) then
    raise exception 'Missing trigger public.trg_guard_asset_sensitive_fields';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'incidents'
      and policyname = 'incidents_insert_open_only'
  ) then
    raise exception 'Missing policy public.incidents_insert_open_only';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.incidents'::regclass
      and tgname = 'trg_set_incident_resolution_actor'
      and not tgisinternal
  ) then
    raise exception 'Missing trigger public.trg_set_incident_resolution_actor';
  end if;

  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'search_assets_secure'
  ) then
    raise exception 'Missing function public.search_assets_secure';
  end if;

  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'search_audit_logs_secure'
  ) then
    raise exception 'Missing function public.search_audit_logs_secure';
  end if;

  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'dashboard_summary'
  ) then
    raise exception 'Missing function public.dashboard_summary';
  end if;

  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'list_asset_categories'
  ) then
    raise exception 'Missing function public.list_asset_categories';
  end if;
end;
$$;

-- Inspection helpers
select
  tgname,
  pg_get_triggerdef(oid) as trigger_def
from pg_trigger
where tgrelid in ('public.assets'::regclass, 'public.incidents'::regclass)
  and tgname in ('trg_guard_asset_sensitive_fields', 'trg_set_incident_resolution_actor')
  and not tgisinternal
order by tgname;

select
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'assets' and policyname = 'assets_update_authorized_roles')
    or (tablename = 'incidents' and policyname = 'incidents_insert_open_only')
  )
order by tablename, policyname;

select public.dashboard_summary(null, 'ALL', '12M', 1, 5) as dashboard_sample;
