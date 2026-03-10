-- Feature - Maintenance validation workflow + asset rebus requests
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/feature_workflow_approvals.sql
-- 2) sql/security_admin_audit_upgrade.sql
-- 3) sql/step_1_security_integrity_hardening.sql

alter table if exists public.maintenance
  add column if not exists approval_status text default 'APPROUVEE',
  add column if not exists workflow_request_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'maintenance_approval_status_check'
      and conrelid = 'public.maintenance'::regclass
  ) then
    alter table public.maintenance
      add constraint maintenance_approval_status_check
      check (upper(coalesce(approval_status, 'APPROUVEE')) in ('EN_ATTENTE_VALIDATION', 'APPROUVEE', 'REJETEE'));
  end if;
end $$;

update public.maintenance
set approval_status = 'APPROUVEE'
where approval_status is null or trim(approval_status) = '';

drop index if exists public.idx_workflow_requests_pending_unique;
create unique index if not exists idx_workflow_requests_pending_unique
on public.workflow_requests (asset_id, request_type)
where
  upper(status) = 'PENDING'
  and asset_id is not null
  and upper(request_type) in ('ASSET_DELETE', 'ASSET_PURCHASE_VALUE_CHANGE', 'ASSET_REBUS');

alter table if exists public.workflow_requests
  drop constraint if exists workflow_requests_type_check;

alter table if exists public.workflow_requests
  add constraint workflow_requests_type_check
  check (
    upper(coalesce(request_type, '')) in (
      'ASSET_DELETE',
      'ASSET_PURCHASE_VALUE_CHANGE',
      'MAINTENANCE_START',
      'ASSET_REBUS'
    )
  );

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
  v_requester_role := coalesce(nullif(public.current_app_role(), ''), 'STANDARD');
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_required_approvals := greatest(1, least(coalesce(p_required_approvals, 2), 5));

  if v_request_type not in (
    'ASSET_DELETE',
    'ASSET_PURCHASE_VALUE_CHANGE',
    'MAINTENANCE_START',
    'ASSET_REBUS'
  ) then
    raise exception 'unsupported workflow request type: %', p_request_type;
  end if;

  if v_request_type in ('ASSET_DELETE', 'ASSET_PURCHASE_VALUE_CHANGE')
     and v_requester_role not in ('CEO', 'DAF', 'RESPONSABLE') then
    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can create this request';
  end if;

  if v_request_type = 'ASSET_REBUS'
     and v_requester_role not in ('CEO', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'forbidden: only CEO or RESPONSABLE_MAINTENANCE can signal an asset as irreparable';
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

  if v_request_type = 'ASSET_REBUS' then
    if v_reason is null then
      raise exception 'Motif obligatoire pour un passage en rebus';
    end if;

    if upper(coalesce(v_asset.status, '')) = 'REBUS' then
      raise exception 'Cet actif est déjà en rebus';
    end if;

    v_payload := jsonb_strip_nulls(
      jsonb_build_object(
        'asset_id', v_asset.id,
        'asset_name', v_asset.name,
        'asset_code', v_asset.code,
        'current_status', v_asset.status,
        'target_status', 'REBUS'
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
    case
      when v_request_type = 'MAINTENANCE_START' then 'maintenance'
      else 'assets'
    end,
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
      when v_request_type = 'MAINTENANCE_START' then format('Validation maintenance: %s', coalesce(v_payload ->> 'title', v_asset.name, '-'))
      when v_request_type = 'ASSET_REBUS' then format('Passage en rebus: %s', coalesce(v_asset.name, '-'))
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

create or replace function public.request_maintenance_start(
  p_asset_id uuid,
  p_title text,
  p_description text default null,
  p_cost numeric default 0,
  p_priority text default 'MOYENNE',
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_status text;
  v_maintenance_id uuid;
  v_request_id uuid;
  v_title text;
  v_priority text;
  v_cost numeric;
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    raise exception 'Titre obligatoire';
  end if;

  v_priority := upper(coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'MOYENNE'));
  if v_priority not in ('BASSE', 'MOYENNE', 'HAUTE', 'CRITIQUE') then
    raise exception 'Priorité maintenance invalide';
  end if;

  v_cost := greatest(coalesce(p_cost, 0), 0);

  select upper(coalesce(status, ''))
  into v_asset_status
  from public.assets
  where id = p_asset_id;

  if not found then
    raise exception 'Asset introuvable';
  end if;

  if v_asset_status = 'REBUS' then
    raise exception 'Impossible de créer une maintenance pour un actif déjà en rebus';
  end if;

  insert into public.maintenance (
    asset_id,
    title,
    description,
    cost,
    priority,
    due_date,
    status,
    approval_status,
    is_completed,
    reported_by
  )
  values (
    p_asset_id,
    v_title,
    p_description,
    v_cost,
    v_priority,
    p_due_date,
    'EN_ATTENTE_VALIDATION',
    'EN_ATTENTE_VALIDATION',
    false,
    auth.uid()
  )
  returning id into v_maintenance_id;

  v_request_id := public.create_workflow_request(
    'MAINTENANCE_START',
    p_asset_id,
    null,
    jsonb_build_object(
      'maintenance_id', v_maintenance_id,
      'asset_id', p_asset_id,
      'title', v_title,
      'description', p_description,
      'cost', v_cost,
      'priority', v_priority,
      'due_date', p_due_date,
      'requested_status', 'EN_ATTENTE_VALIDATION'
    ),
    1,
    array['CEO', 'DAF', 'RESPONSABLE']
  );

  update public.maintenance
  set workflow_request_id = v_request_id
  where id = v_maintenance_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_maintenance_start(uuid, text, text, numeric, text, date) from public;
grant execute on function public.request_maintenance_start(uuid, text, text, numeric, text, date) to authenticated;

create or replace function public.request_asset_rebus(
  p_asset_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_workflow_request(
    'ASSET_REBUS',
    p_asset_id,
    p_reason,
    '{}'::jsonb,
    1,
    array['CEO', 'DAF', 'RESPONSABLE']
  );
end;
$$;

revoke all on function public.request_asset_rebus(uuid, text) from public;
grant execute on function public.request_asset_rebus(uuid, text) to authenticated;

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
  v_maintenance_id uuid;
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
    elsif upper(v_request.request_type) = 'MAINTENANCE_START' then
      v_maintenance_id := nullif(v_request.payload ->> 'maintenance_id', '')::uuid;

      update public.maintenance
      set
        status = 'EN_COURS',
        approval_status = 'APPROUVEE',
        started_at = coalesce(started_at, now())
      where id = v_maintenance_id;

      if not found then
        raise exception 'Validation maintenance impossible: ticket introuvable';
      end if;

      update public.assets
      set status = 'EN_MAINTENANCE'
      where id = v_request.asset_id
        and upper(coalesce(status, '')) <> 'REBUS';
    elsif upper(v_request.request_type) = 'ASSET_REBUS' then
      update public.assets
      set status = 'REBUS'
      where id = v_request.asset_id;

      if not found then
        raise exception 'Passage en rebus impossible: actif introuvable';
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
        resolution_note = left(coalesce(v_note || ' | ', '') || sqlerrm, 2000),
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
  v_maintenance_id uuid;
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

  if upper(v_request.request_type) = 'MAINTENANCE_START' then
    v_maintenance_id := nullif(v_request.payload ->> 'maintenance_id', '')::uuid;

    update public.maintenance
    set
      approval_status = 'REJETEE',
      status = 'TERMINEE',
      is_completed = true,
      completed_at = coalesce(completed_at, now()),
      completed_by = coalesce(completed_by, auth.uid())
    where id = v_maintenance_id;
  end if;

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

-- Quick checks:
-- select public.request_maintenance_start('<asset-uuid>', 'Vidange moteur', 'Controle complet', 250000, 'HAUTE', current_date + 7);
-- select public.request_asset_rebus('<asset-uuid>', 'Actif signalé irréparable');
