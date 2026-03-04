-- Step 1 - Security and integrity hardening
-- Date: 2026-03-04
-- Run after existing baseline scripts.

-- =====================================================================
-- 1) Role helpers
-- =====================================================================
create or replace function public.is_daf()
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
      and upper(coalesce(p.role, '')) = 'DAF'
  );
$$;

revoke all on function public.is_daf() from public;
grant execute on function public.is_daf() to authenticated;

create or replace function public.is_responsable()
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
      and upper(coalesce(p.role, '')) = 'RESPONSABLE'
  );
$$;

revoke all on function public.is_responsable() from public;
grant execute on function public.is_responsable() to authenticated;

-- =====================================================================
-- 2) Assets: tighten update rights + sensitive field guard
-- =====================================================================
alter table if exists public.assets enable row level security;

drop policy if exists assets_update_authenticated on public.assets;
drop policy if exists assets_update_authorized_roles on public.assets;
create policy assets_update_authorized_roles
on public.assets
for update
using (
  public.is_ceo()
  or public.is_daf()
  or public.is_responsable()
  or public.is_maintenance_manager()
)
with check (
  public.is_ceo()
  or public.is_daf()
  or public.is_responsable()
  or public.is_maintenance_manager()
);

create or replace function public.guard_asset_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_role text;
  v_status_changed boolean;
  v_accounting_changed boolean;
begin
  v_status_changed := coalesce(old.status, '') is distinct from coalesce(new.status, '');

  v_accounting_changed :=
    old.company_id is distinct from new.company_id
    or old.purchase_value is distinct from new.purchase_value
    or old.value is distinct from new.value
    or coalesce(old.amortissement_type, '') is distinct from coalesce(new.amortissement_type, '')
    or old.amortissement_duration is distinct from new.amortissement_duration
    or coalesce(old.amortissement_method, '') is distinct from coalesce(new.amortissement_method, '')
    or old.amortissement_rate is distinct from new.amortissement_rate
    or old.amortissement_degressive_rate is distinct from new.amortissement_degressive_rate
    or old.amortissement_degressive_coefficient is distinct from new.amortissement_degressive_coefficient;

  if not v_status_changed and not v_accounting_changed then
    return new;
  end if;

  -- Allow migrations / SQL editor / service flows without an authenticated JWT.
  v_claim_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  if v_claim_role <> 'authenticated' then
    return new;
  end if;

  if v_accounting_changed then
    if public.is_ceo() or public.is_daf() then
      return new;
    end if;

    raise exception 'forbidden: only CEO or DAF can update company/value/amortization fields';
  end if;

  if v_status_changed then
    if public.is_ceo() or public.is_daf() or public.is_responsable() or public.is_maintenance_manager() then
      return new;
    end if;

    raise exception 'forbidden: only leadership roles can update asset status';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_asset_sensitive_fields on public.assets;
create trigger trg_guard_asset_sensitive_fields
before update on public.assets
for each row
execute function public.guard_asset_sensitive_fields();

-- =====================================================================
-- 3) Incidents: enforce lifecycle (creation always OUVERT)
-- =====================================================================
alter table if exists public.incidents enable row level security;

drop policy if exists incidents_insert_authenticated on public.incidents;
drop policy if exists incidents_insert_open_only on public.incidents;
create policy incidents_insert_open_only
on public.incidents
for insert
with check (
  auth.role() = 'authenticated'
  and upper(coalesce(status, 'OUVERT')) = 'OUVERT'
  and resolved_by is null
  and resolved_at is null
);

create or replace function public.set_incident_resolution_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_role text;
begin
  if tg_op = 'INSERT' then
    -- Force creation state to OPEN, regardless of payload sent by client.
    new.status := 'OUVERT';
    new.resolved_by := null;
    new.resolved_at := null;
    if new.reported_by is null then
      new.reported_by := public.audit_actor_id();
    end if;
    return new;
  end if;

  if upper(coalesce(new.status, '')) = 'RESOLU' then
    v_claim_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');

    if v_claim_role = 'authenticated' and not (public.is_ceo() or public.is_maintenance_manager()) then
      raise exception 'forbidden: only CEO or RESPONSABLE_MAINTENANCE can close incidents';
    end if;

    if new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.resolved_by is null then
      new.resolved_by := public.audit_actor_id();
    end if;
  else
    new.resolved_at := null;
    new.resolved_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_incident_resolution_actor on public.incidents;
create trigger trg_set_incident_resolution_actor
before insert or update on public.incidents
for each row
execute function public.set_incident_resolution_actor();

-- =====================================================================
-- 4) User directory refresh restricted to CEO / service role
-- =====================================================================
create or replace function public.refresh_user_directory()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_role text;
begin
  v_claim_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');

  if v_claim_role = 'authenticated' and not public.is_ceo() then
    raise exception 'forbidden: only CEO can execute refresh_user_directory()';
  end if;

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
grant execute on function public.refresh_user_directory() to service_role;

-- =====================================================================
-- 5) Quick checks
-- =====================================================================
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='assets' and policyname='assets_update_authorized_roles';
-- select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.assets'::regclass and tgname='trg_guard_asset_sensitive_fields';
-- select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.incidents'::regclass and tgname='trg_set_incident_resolution_actor';
