-- Security + Admin + Audit + Scale Upgrade
-- Date: 2026-02-22

-- =====================================================================
-- 1) Role helper functions (no recursive RLS lookups in policies)
-- =====================================================================
create or replace function public.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) = 'CEO'
  );
$$;

revoke all on function public.is_ceo() from public;
grant execute on function public.is_ceo() to authenticated;

create or replace function public.is_maintenance_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) = 'RESPONSABLE_MAINTENANCE'
  );
$$;

revoke all on function public.is_maintenance_manager() from public;
grant execute on function public.is_maintenance_manager() to authenticated;

-- Align business policies with role helpers
drop policy if exists assets_delete_ceo_only on public.assets;
create policy assets_delete_ceo_only
on public.assets
for delete
using (public.is_ceo());

drop policy if exists incidents_update_authorized on public.incidents;
create policy incidents_update_authorized
on public.incidents
for update
using (public.is_ceo() or public.is_maintenance_manager())
with check (public.is_ceo() or public.is_maintenance_manager());

drop policy if exists maintenance_update_authorized on public.maintenance;
create policy maintenance_update_authorized
on public.maintenance
for update
using (public.is_ceo() or public.is_maintenance_manager())
with check (public.is_ceo() or public.is_maintenance_manager());

-- =====================================================================
-- 2) Profiles policies hardening + secure admin RPC
-- =====================================================================
alter table if exists public.profiles enable row level security;

drop policy if exists profiles_select_own_or_ceo on public.profiles;
drop policy if exists profiles_insert_ceo_only on public.profiles;
drop policy if exists profiles_update_own_or_ceo on public.profiles;
drop policy if exists profiles_update_own_only on public.profiles;

create policy profiles_select_own_or_ceo
on public.profiles
for select
using (auth.uid() = id or public.is_ceo());

-- Keep direct updates only for the owner profile.
create policy profiles_update_own_only
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.admin_upsert_profile(
  p_user_id uuid,
  p_role text,
  p_company_id uuid
)
returns table (id uuid, role text, company_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.is_ceo() then
    raise exception 'forbidden: only CEO can manage profiles';
  end if;

  v_role := upper(coalesce(p_role, ''));
  if v_role not in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'invalid role: %', p_role;
  end if;

  if p_company_id is null then
    raise exception 'company is required';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user not found in auth.users';
  end if;

  insert into public.profiles (id, role, company_id)
  values (p_user_id, v_role, p_company_id)
  on conflict (id) do update
    set role = excluded.role,
        company_id = excluded.company_id;

  return query
  select p.id, p.role, p.company_id
  from public.profiles p
  where p.id = p_user_id;
end;
$$;

revoke all on function public.admin_upsert_profile(uuid, text, uuid) from public;
grant execute on function public.admin_upsert_profile(uuid, text, uuid) to authenticated;

-- =====================================================================
-- 3) User Directory mirror (email lookup for admin UX)
-- =====================================================================
create table if not exists public.user_directory (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_user_directory_email
on public.user_directory (email);

alter table if exists public.user_directory enable row level security;

drop policy if exists user_directory_select_own_or_ceo on public.user_directory;
drop policy if exists user_directory_insert_ceo on public.user_directory;
drop policy if exists user_directory_update_ceo on public.user_directory;
drop policy if exists user_directory_delete_ceo on public.user_directory;

create policy user_directory_select_own_or_ceo
on public.user_directory
for select
using (auth.uid() = id or public.is_ceo());

create policy user_directory_insert_ceo
on public.user_directory
for insert
with check (public.is_ceo());

create policy user_directory_update_ceo
on public.user_directory
for update
using (public.is_ceo())
with check (public.is_ceo());

create policy user_directory_delete_ceo
on public.user_directory
for delete
using (public.is_ceo());

create or replace function public.refresh_user_directory()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_directory (id, email, full_name, last_sign_in_at, updated_at)
  select
    u.id,
    u.email,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    u.last_sign_in_at,
    now()
  from auth.users u
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      last_sign_in_at = excluded.last_sign_in_at,
      updated_at = now();
end;
$$;

revoke all on function public.refresh_user_directory() from public;
grant execute on function public.refresh_user_directory() to authenticated;

select public.refresh_user_directory();

create or replace function public.handle_auth_user_directory_sync()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_directory (id, email, full_name, last_sign_in_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.last_sign_in_at,
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      last_sign_in_at = excluded.last_sign_in_at,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_user_directory_sync on auth.users;
create trigger trg_auth_user_directory_sync
after insert or update of email, raw_user_meta_data, last_sign_in_at
on auth.users
for each row
execute function public.handle_auth_user_directory_sync();

-- =====================================================================
-- 4) Audit log for destructive/critical events
-- =====================================================================
create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_actor on public.audit_logs (actor_user_id);

alter table if exists public.audit_logs enable row level security;

drop policy if exists audit_logs_select_authenticated on public.audit_logs;
create policy audit_logs_select_authenticated
on public.audit_logs
for select
using (auth.role() = 'authenticated');

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

create or replace function public.audit_log_asset_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    public.audit_actor_id(),
    'ASSET_DELETE',
    'assets',
    old.id::text,
    jsonb_build_object(
      'name', old.name,
      'company_id', old.company_id,
      'status', old.status,
      'purchase_value', old.purchase_value
    )
  );

  return old;
end;
$$;

create or replace function public.audit_log_incident_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and upper(coalesce(new.status, '')) = 'RESOLU' then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
    values (
      public.audit_actor_id(),
      'INCIDENT_CLOSE',
      'incidents',
      new.id::text,
      jsonb_build_object(
        'asset_id', new.asset_id,
        'title', new.title,
        'old_status', old.status,
        'new_status', new.status,
        'resolved_at', new.resolved_at
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.audit_log_maintenance_close()
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
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
    values (
      public.audit_actor_id(),
      'MAINTENANCE_CLOSE',
      'maintenance',
      new.id::text,
      jsonb_build_object(
        'asset_id', new.asset_id,
        'title', new.title,
        'old_status', old.status,
        'new_status', new.status,
        'completed_at', new.completed_at,
        'is_completed', new.is_completed
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_asset_delete on public.assets;
create trigger trg_audit_asset_delete
after delete on public.assets
for each row
execute function public.audit_log_asset_delete();

drop trigger if exists trg_audit_incident_close on public.incidents;
create trigger trg_audit_incident_close
after update on public.incidents
for each row
execute function public.audit_log_incident_close();

drop trigger if exists trg_audit_maintenance_close on public.maintenance;
create trigger trg_audit_maintenance_close
after update on public.maintenance
for each row
execute function public.audit_log_maintenance_close();

-- =====================================================================
-- 5) Maintenance SLA fields
-- =====================================================================
alter table if exists public.maintenance
  add column if not exists priority text default 'MOYENNE',
  add column if not exists due_date date,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table if exists public.maintenance
  drop constraint if exists maintenance_priority_check;

alter table if exists public.maintenance
  add constraint maintenance_priority_check
  check (upper(coalesce(priority, 'MOYENNE')) in ('BASSE', 'MOYENNE', 'HAUTE', 'CRITIQUE'));

update public.maintenance
set priority = upper(coalesce(priority, 'MOYENNE'))
where priority is null or priority <> upper(priority);

update public.maintenance
set started_at = coalesce(started_at, created_at, now())
where started_at is null;

-- =====================================================================
-- 6) Scoring config by company (predictive tuning)
-- =====================================================================
create table if not exists public.company_scoring_config (
  company_id uuid primary key references public.organisations(id) on delete cascade,
  weight_incidents numeric default 7,
  weight_maintenance_ratio numeric default 1,
  weight_vnc_zero numeric default 10,
  incident_threshold integer default 3,
  replacement_ratio_threshold numeric default 40,
  replacement_vnc_threshold numeric default 25,
  top_risk_days integer default 30,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.company_scoring_config enable row level security;

drop policy if exists company_scoring_select_authenticated on public.company_scoring_config;
drop policy if exists company_scoring_insert_ceo on public.company_scoring_config;
drop policy if exists company_scoring_update_ceo on public.company_scoring_config;
drop policy if exists company_scoring_delete_ceo on public.company_scoring_config;

create policy company_scoring_select_authenticated
on public.company_scoring_config
for select
using (auth.role() = 'authenticated');

create policy company_scoring_insert_ceo
on public.company_scoring_config
for insert
with check (public.is_ceo());

create policy company_scoring_update_ceo
on public.company_scoring_config
for update
using (public.is_ceo())
with check (public.is_ceo());

create policy company_scoring_delete_ceo
on public.company_scoring_config
for delete
using (public.is_ceo());

insert into public.company_scoring_config (company_id)
select o.id
from public.organisations o
where not exists (
  select 1
  from public.company_scoring_config c
  where c.company_id = o.id
);

-- =====================================================================
-- 7) Indexes for assets at scale
-- =====================================================================
create index if not exists idx_assets_name on public.assets (name);
create index if not exists idx_assets_company_id on public.assets (company_id);
create index if not exists idx_assets_created_at on public.assets (created_at desc);

-- Optional: faster ilike name search
create extension if not exists pg_trgm;
create index if not exists idx_assets_name_trgm
on public.assets using gin (name gin_trgm_ops);

-- =====================================================================
-- 8) Quick checks
-- =====================================================================
-- select policyname, cmd from pg_policies where schemaname='public' and tablename in ('profiles','user_directory','audit_logs','company_scoring_config') order by tablename, policyname;
-- select id, email from public.user_directory order by email;
-- select * from public.audit_logs order by created_at desc limit 20;
