-- Assignment governance upgrade
-- Date: 2026-03-03
-- Goal:
-- 1) keep assignment history for both user-id and free-text name
-- 2) allow assignment updates only for CEO / DAF / RESPONSABLE
-- 3) enrich audit payload with assignment names

-- =====================================================================
-- 1) Ensure helper exists (DAF role check)
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

-- =====================================================================
-- 2) Schema: assignment name + history name columns
-- =====================================================================
alter table if exists public.assets
  add column if not exists assigned_to_name text;

alter table if exists public.asset_assignment_history
  add column if not exists previous_assigned_name text,
  add column if not exists new_assigned_name text;

-- Optional backfill for existing history rows from user_directory labels.
update public.asset_assignment_history h
set previous_assigned_name = coalesce(previous_assigned_name, nullif(ud.full_name, ''), nullif(ud.email, ''))
from public.user_directory ud
where h.previous_assigned_to = ud.id
  and coalesce(h.previous_assigned_name, '') = '';

update public.asset_assignment_history h
set new_assigned_name = coalesce(new_assigned_name, nullif(ud.full_name, ''), nullif(ud.email, ''))
from public.user_directory ud
where h.new_assigned_to = ud.id
  and coalesce(h.new_assigned_name, '') = '';

-- =====================================================================
-- 3) Trigger: track assignment changes (id + name)
-- =====================================================================
create or replace function public.track_asset_assignment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_old_name text;
  v_new_name text;
begin
  v_actor := public.audit_actor_id();
  if tg_op = 'INSERT' then
    v_old_name := null;
  else
    v_old_name := nullif(btrim(old.assigned_to_name), '');
  end if;
  v_new_name := nullif(btrim(new.assigned_to_name), '');

  if tg_op = 'INSERT' then
    if new.assigned_to_user_id is not null or v_new_name is not null then
      insert into public.asset_assignment_history (
        asset_id,
        previous_assigned_to,
        new_assigned_to,
        previous_assigned_name,
        new_assigned_name,
        changed_by,
        note
      )
      values (
        new.id,
        null,
        new.assigned_to_user_id,
        null,
        v_new_name,
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
          'new_assigned_to', new.assigned_to_user_id,
          'new_assigned_to_name', v_new_name
        )
      );
    end if;
    return new;
  end if;

  if old.assigned_to_user_id is distinct from new.assigned_to_user_id
     or coalesce(v_old_name, '') is distinct from coalesce(v_new_name, '')
  then
    insert into public.asset_assignment_history (
      asset_id,
      previous_assigned_to,
      new_assigned_to,
      previous_assigned_name,
      new_assigned_name,
      changed_by,
      note
    )
    values (
      new.id,
      old.assigned_to_user_id,
      new.assigned_to_user_id,
      v_old_name,
      v_new_name,
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
        'new_assigned_to', new.assigned_to_user_id,
        'previous_assigned_to_name', v_old_name,
        'new_assigned_to_name', v_new_name
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_track_asset_assignment_changes on public.assets;
create trigger trg_track_asset_assignment_changes
after insert or update on public.assets
for each row
execute function public.track_asset_assignment_changes();

-- =====================================================================
-- 4) Trigger guard: only CEO / DAF / RESPONSABLE can update assignment
-- =====================================================================
create or replace function public.guard_asset_assignment_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_role text;
begin
  if old.assigned_to_user_id is not distinct from new.assigned_to_user_id
     and coalesce(nullif(btrim(old.assigned_to_name), ''), '') is not distinct from coalesce(nullif(btrim(new.assigned_to_name), ''), '')
  then
    return new;
  end if;

  -- Allow service-level operations (SQL editor, migrations) without JWT claims.
  v_claim_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  if v_claim_role <> 'authenticated' then
    return new;
  end if;

  if public.is_ceo() or public.is_daf() or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) = 'RESPONSABLE'
  ) then
    return new;
  end if;

  raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can update "attribue a"';
end;
$$;

drop trigger if exists trg_guard_asset_assignment_update on public.assets;
create trigger trg_guard_asset_assignment_update
before update of assigned_to_user_id, assigned_to_name on public.assets
for each row
execute function public.guard_asset_assignment_update();

-- =====================================================================
-- 5) Quick checks
-- =====================================================================
-- select public.is_ceo() as is_ceo, public.is_daf() as is_daf;
-- select column_name from information_schema.columns where table_schema='public' and table_name='asset_assignment_history' and column_name in ('previous_assigned_name','new_assigned_name');
-- select action, payload, created_at from public.audit_logs where action in ('ASSET_ASSIGNMENT_INITIAL','ASSET_ASSIGNMENT_CHANGE') order by created_at desc limit 20;
