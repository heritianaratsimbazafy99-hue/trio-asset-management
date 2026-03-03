-- Feature upgrade: audit visibility + attribution history + actor tracking
-- Date: 2026-02-23
-- Run this script in Supabase SQL Editor after security_admin_audit_upgrade.sql

-- =====================================================================
-- 0) Ensure audit actor helper exists
-- =====================================================================
create or replace function public.audit_actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub text;
  v_uid uuid;
begin
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  if v_uid is not null then
    return v_uid;
  end if;

  v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  if v_sub is null then
    return null;
  end if;

  return v_sub::uuid;
exception when others then
  return null;
end;
$$;

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb,
  created_at timestamptz default now()
);

alter table if exists public.audit_logs enable row level security;
drop policy if exists audit_logs_select_authenticated on public.audit_logs;
create policy audit_logs_select_authenticated
on public.audit_logs
for select
using (auth.role() = 'authenticated');

-- =====================================================================
-- 1) Extend incidents and maintenance with actor columns
-- =====================================================================
alter table if exists public.incidents
  add column if not exists reported_by uuid default auth.uid(),
  add column if not exists resolved_by uuid;

alter table if exists public.maintenance
  add column if not exists reported_by uuid default auth.uid(),
  add column if not exists completed_by uuid;

create or replace function public.set_incident_resolution_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and upper(coalesce(new.status, '')) = 'RESOLU' then
    if new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.resolved_by is null then
      new.resolved_by := public.audit_actor_id();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_incident_resolution_actor on public.incidents;
create trigger trg_set_incident_resolution_actor
before update on public.incidents
for each row
execute function public.set_incident_resolution_actor();

create or replace function public.set_maintenance_completion_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    (coalesce(old.is_completed, false) = false and coalesce(new.is_completed, false) = true)
    or (upper(coalesce(old.status, '')) <> 'TERMINEE' and upper(coalesce(new.status, '')) = 'TERMINEE')
  ) then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.completed_by is null then
      new.completed_by := public.audit_actor_id();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_maintenance_completion_actor on public.maintenance;
create trigger trg_set_maintenance_completion_actor
before update on public.maintenance
for each row
execute function public.set_maintenance_completion_actor();

-- =====================================================================
-- 2) Asset current assignee + assignment history
-- =====================================================================
alter table if exists public.assets
  add column if not exists assigned_to_user_id uuid;

create index if not exists idx_assets_assigned_to on public.assets (assigned_to_user_id);

create table if not exists public.asset_assignment_history (
  id bigserial primary key,
  asset_id uuid not null references public.assets(id) on delete cascade,
  previous_assigned_to uuid,
  new_assigned_to uuid,
  changed_by uuid,
  changed_at timestamptz default now(),
  note text
);

create index if not exists idx_assignment_history_asset_date
on public.asset_assignment_history (asset_id, changed_at desc);

create index if not exists idx_assignment_history_changed_by
on public.asset_assignment_history (changed_by);

alter table if exists public.asset_assignment_history enable row level security;

drop policy if exists asset_assignment_history_select_authenticated on public.asset_assignment_history;
create policy asset_assignment_history_select_authenticated
on public.asset_assignment_history
for select
using (auth.role() = 'authenticated');

create or replace function public.track_asset_assignment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := public.audit_actor_id();

  if tg_op = 'INSERT' then
    if new.assigned_to_user_id is not null then
      insert into public.asset_assignment_history (
        asset_id,
        previous_assigned_to,
        new_assigned_to,
        changed_by,
        note
      )
      values (
        new.id,
        null,
        new.assigned_to_user_id,
        v_actor,
        'ASSIGNMENT_INITIAL'
      );

      insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
      values (
        v_actor,
        'ASSET_ASSIGNMENT_INITIAL',
        'assets',
        new.id::text,
        jsonb_build_object(
          'asset_id', new.id,
          'new_assigned_to', new.assigned_to_user_id
        )
      );
    end if;
    return new;
  end if;

  if old.assigned_to_user_id is distinct from new.assigned_to_user_id then
    insert into public.asset_assignment_history (
      asset_id,
      previous_assigned_to,
      new_assigned_to,
      changed_by,
      note
    )
    values (
      new.id,
      old.assigned_to_user_id,
      new.assigned_to_user_id,
      v_actor,
      'ASSIGNMENT_CHANGE'
    );

    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
    values (
      v_actor,
      'ASSET_ASSIGNMENT_CHANGE',
      'assets',
      new.id::text,
      jsonb_build_object(
        'asset_id', new.id,
        'previous_assigned_to', old.assigned_to_user_id,
        'new_assigned_to', new.assigned_to_user_id
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_track_asset_assignment_changes on public.assets;
create trigger trg_track_asset_assignment_changes
before insert or update on public.assets
for each row
execute function public.track_asset_assignment_changes();

-- =====================================================================
-- 3) Allow all authenticated users to resolve actor emails in UI
-- =====================================================================
create table if not exists public.user_directory (
  id uuid primary key,
  email text,
  full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.user_directory enable row level security;

drop policy if exists user_directory_select_authenticated on public.user_directory;
create policy user_directory_select_authenticated
on public.user_directory
for select
using (auth.role() = 'authenticated');

-- =====================================================================
-- 4) Quick checks
-- =====================================================================
-- select column_name from information_schema.columns where table_schema='public' and table_name='incidents' order by ordinal_position;
-- select column_name from information_schema.columns where table_schema='public' and table_name='maintenance' order by ordinal_position;
-- select column_name from information_schema.columns where table_schema='public' and table_name='assets' order by ordinal_position;
-- select policyname, cmd from pg_policies where schemaname='public' and tablename in ('user_directory','asset_assignment_history') order by tablename, policyname;
