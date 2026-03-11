-- Feature - Generic workflow approvals for sensitive asset operations
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/security_admin_audit_upgrade.sql
-- 2) sql/step_1_security_integrity_hardening.sql
--
-- Scope of this first lot:
-- - asset deletion requests
-- - asset purchase/accounting value change requests
-- - 2-stage approval by leadership roles (CEO / DAF / RESPONSABLE)

create extension if not exists "uuid-ossp";

create table if not exists public.workflow_requests (
  id uuid primary key default uuid_generate_v4(),
  request_type text not null,
  entity_type text not null default 'assets',
  asset_id uuid references public.assets(id) on delete set null,
  asset_name_snapshot text,
  asset_code_snapshot text,
  company_id uuid references public.organisations(id) on delete set null,
  company_name_snapshot text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_by_role text,
  status text not null default 'PENDING',
  reason text,
  title text,
  payload jsonb not null default '{}'::jsonb,
  approver_roles text[] not null default array['CEO', 'DAF', 'RESPONSABLE'],
  required_approvals integer not null default 2,
  approved_at timestamptz,
  rejected_at timestamptz,
  applied_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.workflow_request_approvals (
  id bigserial primary key,
  request_id uuid not null references public.workflow_requests(id) on delete cascade,
  approver_user_id uuid not null references public.profiles(id) on delete cascade,
  approver_role text not null,
  decision text not null,
  note text,
  created_at timestamptz default now(),
  unique (request_id, approver_user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_requests_type_check'
      and conrelid = 'public.workflow_requests'::regclass
  ) then
    alter table public.workflow_requests
      add constraint workflow_requests_type_check
      check (upper(coalesce(request_type, '')) in ('ASSET_DELETE', 'ASSET_PURCHASE_VALUE_CHANGE'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_requests_status_check'
      and conrelid = 'public.workflow_requests'::regclass
  ) then
    alter table public.workflow_requests
      add constraint workflow_requests_status_check
      check (upper(coalesce(status, '')) in ('PENDING', 'APPROVED', 'REJECTED', 'FAILED'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_requests_required_approvals_check'
      and conrelid = 'public.workflow_requests'::regclass
  ) then
    alter table public.workflow_requests
      add constraint workflow_requests_required_approvals_check
      check (required_approvals between 1 and 5);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_request_approvals_decision_check'
      and conrelid = 'public.workflow_request_approvals'::regclass
  ) then
    alter table public.workflow_request_approvals
      add constraint workflow_request_approvals_decision_check
      check (upper(coalesce(decision, '')) in ('APPROVED', 'REJECTED'));
  end if;
end $$;

create index if not exists idx_workflow_requests_status_created_at
on public.workflow_requests (status, created_at desc);

create index if not exists idx_workflow_requests_asset_type
on public.workflow_requests (asset_id, request_type);

create index if not exists idx_workflow_request_approvals_request
on public.workflow_request_approvals (request_id, created_at desc);

create unique index if not exists idx_workflow_requests_pending_unique
on public.workflow_requests (asset_id, request_type)
where upper(status) = 'PENDING' and asset_id is not null;

alter table if exists public.workflow_requests enable row level security;
alter table if exists public.workflow_request_approvals enable row level security;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(coalesce(p.role, ''))
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create or replace function public.has_any_app_role(p_roles text[])
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role = '' then
    return false;
  end if;

  return exists (
    select 1
    from unnest(coalesce(p_roles, array[]::text[])) as r(role_name)
    where upper(coalesce(r.role_name, '')) = v_role
  );
end;
$$;

revoke all on function public.has_any_app_role(text[]) from public;
grant execute on function public.has_any_app_role(text[]) to authenticated;

drop policy if exists workflow_requests_select_related on public.workflow_requests;
create policy workflow_requests_select_related
on public.workflow_requests
for select
using (
  requested_by = auth.uid()
  or public.has_any_app_role(approver_roles)
);

drop policy if exists workflow_request_approvals_select_related on public.workflow_request_approvals;
create policy workflow_request_approvals_select_related
on public.workflow_request_approvals
for select
using (
  exists (
    select 1
    from public.workflow_requests wr
    where wr.id = workflow_request_approvals.request_id
      and (
        wr.requested_by = auth.uid()
        or public.has_any_app_role(wr.approver_roles)
      )
  )
);

create or replace function public.insert_workflow_audit_log(
  p_request_id uuid,
  p_action text,
  p_extra_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  select *
  into v_request
  from public.workflow_requests
  where id = p_request_id;

  if not found then
    return;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    public.audit_actor_id(),
    p_action,
    'workflow_requests',
    p_request_id::text,
    jsonb_strip_nulls(
      jsonb_build_object(
        'workflow_request_id', v_request.id,
        'request_type', v_request.request_type,
        'request_status', v_request.status,
        'asset_id', coalesce(v_request.asset_id, (v_request.payload ->> 'asset_id')::uuid),
        'asset_name', v_request.asset_name_snapshot,
        'asset_code', v_request.asset_code_snapshot,
        'company_id', v_request.company_id,
        'company_name', v_request.company_name_snapshot,
        'reason', v_request.reason,
        'payload', v_request.payload
      ) || coalesce(p_extra_payload, '{}'::jsonb)
    )
  );
end;
$$;

revoke all on function public.insert_workflow_audit_log(uuid, text, jsonb) from public;
grant execute on function public.insert_workflow_audit_log(uuid, text, jsonb) to authenticated;

create or replace function public.create_workflow_request(
  p_request_type text,
  p_asset_id uuid,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb,
  p_required_approvals integer default 2,
  p_approver_roles text[] default array['CEO', 'DAF', 'RESPONSABLE']
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_request_id uuid;
  v_request_type text;
  v_reason text;
  v_requester_role text;
  v_payload jsonb;
  v_required_approvals integer;
  v_approver_roles text[];
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_request_type := upper(coalesce(trim(p_request_type), ''));
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  v_requester_role := public.current_app_role();
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_required_approvals := greatest(1, least(coalesce(p_required_approvals, 2), 5));

  if v_request_type not in ('ASSET_DELETE', 'ASSET_PURCHASE_VALUE_CHANGE') then
    raise exception 'unsupported workflow request type: %', p_request_type;
  end if;

  if v_requester_role not in ('CEO', 'DAF', 'RESPONSABLE') then
    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can create this request';
  end if;

  select
    a.id,
    a.name,
    a.code,
    a.company_id,
    a.status,
    o.name as company_name
  into v_asset
  from public.assets a
  left join public.organisations o on o.id = a.company_id
  where a.id = p_asset_id;

  if not found then
    raise exception 'Asset introuvable';
  end if;

  select coalesce(
    array_agg(distinct upper(trim(role_name))) filter (where trim(role_name) <> ''),
    array['CEO', 'DAF', 'RESPONSABLE']
  )
  into v_approver_roles
  from unnest(coalesce(p_approver_roles, array['CEO', 'DAF', 'RESPONSABLE'])) as roles(role_name);

  if v_request_type = 'ASSET_DELETE' then
    if v_reason is null then
      raise exception 'Motif obligatoire pour une suppression d''actif';
    end if;

    if exists (select 1 from public.incidents i where i.asset_id = p_asset_id limit 1) then
      raise exception 'Impossible de supprimer un actif avec historique incident';
    end if;

    if exists (select 1 from public.maintenance m where m.asset_id = p_asset_id limit 1) then
      raise exception 'Impossible de supprimer un actif avec historique maintenance';
    end if;

    v_payload := jsonb_strip_nulls(
      jsonb_build_object(
        'asset_id', v_asset.id,
        'asset_name', v_asset.name,
        'asset_code', v_asset.code,
        'company_id', v_asset.company_id,
        'company_name', v_asset.company_name,
        'current_status', v_asset.status
      ) || v_payload
    );
  end if;

  insert into public.workflow_requests (
    request_type,
    entity_type,
    asset_id,
    asset_name_snapshot,
    asset_code_snapshot,
    company_id,
    company_name_snapshot,
    requested_by,
    requested_by_role,
    status,
    reason,
    title,
    payload,
    approver_roles,
    required_approvals,
    created_at,
    updated_at
  )
  values (
    v_request_type,
    'assets',
    v_asset.id,
    v_asset.name,
    v_asset.code,
    v_asset.company_id,
    v_asset.company_name,
    auth.uid(),
    v_requester_role,
    'PENDING',
    v_reason,
    case
      when v_request_type = 'ASSET_DELETE' then format('Suppression actif: %s', coalesce(v_asset.name, '-'))
      when v_request_type = 'ASSET_PURCHASE_VALUE_CHANGE' then format('Changement valeur comptable: %s', coalesce(v_asset.name, '-'))
      else format('Workflow: %s', v_request_type)
    end,
    v_payload,
    v_approver_roles,
    v_required_approvals,
    now(),
    now()
  )
  returning id into v_request_id;

  perform public.insert_workflow_audit_log(
    v_request_id,
    'WORKFLOW_REQUEST_CREATED',
    jsonb_build_object(
      'requested_by', auth.uid(),
      'requested_by_role', v_requester_role
    )
  );

  return v_request_id;
exception
  when unique_violation then
    raise exception 'Une demande en attente existe déjà pour cet actif et cette action';
end;
$$;

revoke all on function public.create_workflow_request(text, uuid, text, jsonb, integer, text[]) from public;
grant execute on function public.create_workflow_request(text, uuid, text, jsonb, integer, text[]) to authenticated;

create or replace function public.request_asset_delete(
  p_asset_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_workflow_request(
    'ASSET_DELETE',
    p_asset_id,
    p_reason,
    '{}'::jsonb,
    2,
    array['CEO', 'DAF', 'RESPONSABLE']
  );
end;
$$;

revoke all on function public.request_asset_delete(uuid, text) from public;
grant execute on function public.request_asset_delete(uuid, text) to authenticated;

create or replace function public.request_asset_purchase_value_change(
  p_asset_id uuid,
  p_new_purchase_value numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_old_effective numeric;
  v_new_effective numeric;
begin
  if p_new_purchase_value is null or p_new_purchase_value < 0 then
    raise exception 'Nouvelle valeur comptable invalide';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Motif obligatoire pour un changement de valeur comptable';
  end if;

  select
    a.id,
    a.purchase_value,
    a.value,
    coalesce(a.purchase_value, a.value, 0) as old_effective_value
  into v_asset
  from public.assets a
  where a.id = p_asset_id;

  if not found then
    raise exception 'Asset introuvable';
  end if;

  v_old_effective := coalesce(v_asset.old_effective_value, 0);
  v_new_effective := p_new_purchase_value;

  if v_old_effective = v_new_effective then
    raise exception 'La nouvelle valeur doit être différente de la valeur actuelle';
  end if;

  return public.create_workflow_request(
    'ASSET_PURCHASE_VALUE_CHANGE',
    p_asset_id,
    p_reason,
    jsonb_build_object(
      'asset_id', p_asset_id,
      'old_purchase_value', v_asset.purchase_value,
      'new_purchase_value', p_new_purchase_value,
      'old_value', v_asset.value,
      'new_value', p_new_purchase_value,
      'old_effective_purchase_value', v_old_effective,
      'new_effective_purchase_value', v_new_effective
    ),
    2,
    array['CEO', 'DAF', 'RESPONSABLE']
  );
end;
$$;

revoke all on function public.request_asset_purchase_value_change(uuid, numeric, text) from public;
grant execute on function public.request_asset_purchase_value_change(uuid, numeric, text) to authenticated;

create or replace function public.approve_workflow_request(
  p_request_id uuid,
  p_note text default null
)
returns table (
  request_id uuid,
  status text,
  approval_count bigint,
  applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.workflow_requests%rowtype;
  v_approval_count bigint;
  v_actor_role text;
  v_note text;
  v_new_purchase_value numeric;
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_actor_role := public.current_app_role();

  select *
  into v_request
  from public.workflow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Demande introuvable';
  end if;

  if upper(coalesce(v_request.status, '')) <> 'PENDING' then
    raise exception 'Cette demande n''est plus en attente';
  end if;

  if v_request.requested_by = auth.uid() then
    raise exception 'forbidden: requester cannot approve own request';
  end if;

  if not public.has_any_app_role(v_request.approver_roles) then
    raise exception 'forbidden: role not allowed to approve this request';
  end if;

  if exists (
    select 1
    from public.workflow_request_approvals a
    where a.request_id = p_request_id
      and a.approver_user_id = auth.uid()
  ) then
    raise exception 'Vous avez déjà pris une décision sur cette demande';
  end if;

  insert into public.workflow_request_approvals (
    request_id,
    approver_user_id,
    approver_role,
    decision,
    note
  )
  values (
    p_request_id,
    auth.uid(),
    v_actor_role,
    'APPROVED',
    v_note
  );

  select count(*)
  into v_approval_count
  from public.workflow_request_approvals a
  where a.request_id = p_request_id
    and upper(a.decision) = 'APPROVED';

  update public.workflow_requests
  set updated_at = now()
  where id = p_request_id;

  perform public.insert_workflow_audit_log(
    p_request_id,
    'WORKFLOW_REQUEST_APPROVAL_RECORDED',
    jsonb_build_object(
      'decision', 'APPROVED',
      'approval_count', v_approval_count,
      'approver_user_id', auth.uid(),
      'approver_role', v_actor_role,
      'note', v_note
    )
  );

  if v_approval_count < v_request.required_approvals then
    return query
    select p_request_id, 'PENDING', v_approval_count, false;
    return;
  end if;

  begin
    if upper(v_request.request_type) = 'ASSET_DELETE' then
      delete from public.assets
      where id = v_request.asset_id;

      if not found then
        raise exception 'Suppression impossible: actif introuvable';
      end if;
    elsif upper(v_request.request_type) = 'ASSET_PURCHASE_VALUE_CHANGE' then
      v_new_purchase_value := nullif(v_request.payload ->> 'new_purchase_value', '')::numeric;

      update public.assets
      set
        purchase_value = v_new_purchase_value,
        value = v_new_purchase_value
      where id = v_request.asset_id;

      if not found then
        raise exception 'Mise à jour impossible: actif introuvable';
      end if;
    else
      raise exception 'Unsupported workflow request type: %', v_request.request_type;
    end if;

    update public.workflow_requests
    set
      status = 'APPROVED',
      approved_at = now(),
      applied_at = now(),
      resolved_by = auth.uid(),
      resolution_note = coalesce(v_note, resolution_note),
      updated_at = now()
    where id = p_request_id;

    perform public.insert_workflow_audit_log(
      p_request_id,
      'WORKFLOW_REQUEST_APPLIED',
      jsonb_build_object(
        'approval_count', v_approval_count,
        'approver_user_id', auth.uid(),
        'approver_role', v_actor_role
      )
    );

    return query
    select p_request_id, 'APPROVED', v_approval_count, true;
    return;
  exception
    when others then
      update public.workflow_requests
      set
        status = 'FAILED',
        resolved_by = auth.uid(),
        resolution_note = left(
          coalesce(v_note || ' | ', '') || sqlerrm,
          2000
        ),
        updated_at = now()
      where id = p_request_id;

      perform public.insert_workflow_audit_log(
        p_request_id,
        'WORKFLOW_REQUEST_FAILED',
        jsonb_build_object(
          'approval_count', v_approval_count,
          'error', sqlerrm,
          'approver_user_id', auth.uid(),
          'approver_role', v_actor_role
        )
      );

      return query
      select p_request_id, 'FAILED', v_approval_count, false;
      return;
  end;
end;
$$;

revoke all on function public.approve_workflow_request(uuid, text) from public;
grant execute on function public.approve_workflow_request(uuid, text) to authenticated;

create or replace function public.reject_workflow_request(
  p_request_id uuid,
  p_note text default null
)
returns table (
  request_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.workflow_requests%rowtype;
  v_actor_role text;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');
  v_actor_role := public.current_app_role();

  if v_note is null then
    raise exception 'Motif obligatoire pour rejeter une demande';
  end if;

  select *
  into v_request
  from public.workflow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Demande introuvable';
  end if;

  if upper(coalesce(v_request.status, '')) <> 'PENDING' then
    raise exception 'Cette demande n''est plus en attente';
  end if;

  if v_request.requested_by = auth.uid() then
    raise exception 'forbidden: requester cannot reject own request';
  end if;

  if not public.has_any_app_role(v_request.approver_roles) then
    raise exception 'forbidden: role not allowed to reject this request';
  end if;

  if exists (
    select 1
    from public.workflow_request_approvals a
    where a.request_id = p_request_id
      and a.approver_user_id = auth.uid()
  ) then
    raise exception 'Vous avez déjà pris une décision sur cette demande';
  end if;

  insert into public.workflow_request_approvals (
    request_id,
    approver_user_id,
    approver_role,
    decision,
    note
  )
  values (
    p_request_id,
    auth.uid(),
    v_actor_role,
    'REJECTED',
    v_note
  );

  update public.workflow_requests
  set
    status = 'REJECTED',
    rejected_at = now(),
    resolved_by = auth.uid(),
    resolution_note = v_note,
    updated_at = now()
  where id = p_request_id;

  perform public.insert_workflow_audit_log(
    p_request_id,
    'WORKFLOW_REQUEST_REJECTED',
    jsonb_build_object(
      'decision', 'REJECTED',
      'approver_user_id', auth.uid(),
      'approver_role', v_actor_role,
      'note', v_note
    )
  );

  return query
  select p_request_id, 'REJECTED';
end;
$$;

revoke all on function public.reject_workflow_request(uuid, text) from public;
grant execute on function public.reject_workflow_request(uuid, text) to authenticated;

create or replace function public.list_workflow_requests_secure(
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  request_type text,
  status text,
  asset_id uuid,
  asset_name text,
  asset_code text,
  company_name text,
  requested_by uuid,
  requested_by_role text,
  required_approvals integer,
  approval_count bigint,
  reason text,
  title text,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  can_approve boolean,
  already_decided boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with approvals as (
    select
      a.request_id,
      count(*) filter (where upper(a.decision) = 'APPROVED')::bigint as approval_count,
      bool_or(a.approver_user_id = auth.uid()) as already_decided
    from public.workflow_request_approvals a
    group by a.request_id
  )
  select
    wr.id,
    wr.request_type,
    wr.status,
    wr.asset_id,
    coalesce(asset_live.name, wr.asset_name_snapshot, wr.payload ->> 'asset_name') as asset_name,
    coalesce(asset_live.code, wr.asset_code_snapshot, wr.payload ->> 'asset_code') as asset_code,
    coalesce(org_live.name, wr.company_name_snapshot, wr.payload ->> 'company_name') as company_name,
    wr.requested_by,
    wr.requested_by_role,
    wr.required_approvals,
    coalesce(ap.approval_count, 0) as approval_count,
    wr.reason,
    wr.title,
    wr.payload,
    wr.created_at,
    wr.updated_at,
    (
      upper(coalesce(wr.status, '')) = 'PENDING'
      and (
        wr.requested_by is distinct from auth.uid()
        or upper(coalesce(wr.request_type, '')) = 'MAINTENANCE_START'
      )
      and public.has_any_app_role(wr.approver_roles)
      and not coalesce(ap.already_decided, false)
    ) as can_approve,
    coalesce(ap.already_decided, false) as already_decided
  from public.workflow_requests wr
  left join approvals ap on ap.request_id = wr.id
  left join public.assets asset_live on asset_live.id = wr.asset_id
  left join public.organisations org_live on org_live.id = wr.company_id
  where
    (
      wr.requested_by = auth.uid()
      or public.has_any_app_role(wr.approver_roles)
    )
    and (
      p_status is null
      or upper(coalesce(p_status, '')) = 'ALL'
      or upper(coalesce(wr.status, '')) = upper(coalesce(p_status, ''))
    )
  order by
    case when upper(coalesce(wr.status, '')) = 'PENDING' then 0 else 1 end,
    wr.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200))
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.list_workflow_requests_secure(text, integer, integer) from public;
grant execute on function public.list_workflow_requests_secure(text, integer, integer) to authenticated;

-- Quick checks:
-- select public.request_asset_delete('<asset-uuid>', 'Actif doublon') as request_id;
-- select public.request_asset_purchase_value_change('<asset-uuid>', 1250000, 'Ajustement facture') as request_id;
-- select * from public.list_workflow_requests_secure('PENDING', 50, 0);
