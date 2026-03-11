-- Hotfix - maintenance workflow approval UX + notification governance audit cleanup
-- Date: 2026-03-11
--
-- Run only on an existing environment already aligned with lot 14 when:
-- 1) maintenance requests created by the same CEO/DAF cannot be processed in Validations
-- 2) governance seed/no-op audit logs pollute Journal d'audit

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
  v_actor_role text;
  v_note text;
  v_approval_count bigint;
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

  if v_request.requested_by = auth.uid()
     and upper(coalesce(v_request.request_type, '')) <> 'MAINTENANCE_START' then
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

      perform set_config('app.asset_change_source', 'WORKFLOW_PURCHASE_VALUE_APPROVAL', true);
      perform set_config('app.asset_change_reason', coalesce(v_request.reason, ''), true);

      update public.assets
      set
        purchase_value = v_new_purchase_value,
        value = v_new_purchase_value
      where id = v_request.asset_id;

      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);

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

      perform set_config('app.asset_change_source', 'MAINTENANCE_START_APPROVAL', true);
      perform set_config('app.asset_change_reason', 'Ticket maintenance validé', true);

      update public.assets
      set status = 'EN_MAINTENANCE'
      where id = v_request.asset_id
        and upper(coalesce(status, '')) <> 'REBUS';

      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);
    elsif upper(v_request.request_type) = 'ASSET_REBUS' then
      perform set_config('app.asset_change_source', 'REBUS_APPROVAL', true);
      perform set_config('app.asset_change_reason', coalesce(v_request.reason, ''), true);

      update public.assets
      set status = 'REBUS'
      where id = v_request.asset_id;

      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);

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
      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);

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

  if v_request.requested_by = auth.uid()
     and upper(coalesce(v_request.request_type, '')) <> 'MAINTENANCE_START' then
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

create or replace function public.audit_notification_governance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_entity_type text;
  v_entity_id text;
  v_payload jsonb;
  v_current_row jsonb;
  v_previous_row jsonb;
begin
  v_entity_type := tg_table_name;
  v_current_row := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_previous_row := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_entity_id := coalesce(v_current_row ->> 'id', v_previous_row ->> 'id');

  if public.audit_actor_id() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and (v_current_row - 'updated_at' - 'updated_by') = (v_previous_row - 'updated_at' - 'updated_by') then
    return new;
  end if;

  v_action := case
    when tg_table_name = 'notification_template_configs' and tg_op = 'INSERT' then 'NOTIFICATION_TEMPLATE_CONFIG_CREATED'
    when tg_table_name = 'notification_template_configs' and tg_op = 'UPDATE' then 'NOTIFICATION_TEMPLATE_CONFIG_UPDATED'
    when tg_table_name = 'notification_template_configs' and tg_op = 'DELETE' then 'NOTIFICATION_TEMPLATE_CONFIG_DELETED'
    when tg_table_name = 'notification_routing_rules' and tg_op = 'INSERT' then 'NOTIFICATION_ROUTING_RULE_CREATED'
    when tg_table_name = 'notification_routing_rules' and tg_op = 'UPDATE' then 'NOTIFICATION_ROUTING_RULE_UPDATED'
    when tg_table_name = 'notification_routing_rules' and tg_op = 'DELETE' then 'NOTIFICATION_ROUTING_RULE_DELETED'
    else 'NOTIFICATION_GOVERNANCE_CHANGED'
  end;

  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'table_name', tg_table_name,
      'operation', tg_op,
      'current_row', v_current_row,
      'previous_row', v_previous_row
    )
  );

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    payload
  )
  values (
    public.audit_actor_id(),
    v_action,
    v_entity_type,
    v_entity_id,
    v_payload
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_notification_governance_change() from public;
grant execute on function public.audit_notification_governance_change() to authenticated;

delete from public.audit_logs
where actor_user_id is null
  and action in (
    'NOTIFICATION_TEMPLATE_CONFIG_CREATED',
    'NOTIFICATION_TEMPLATE_CONFIG_UPDATED',
    'NOTIFICATION_TEMPLATE_CONFIG_DELETED',
    'NOTIFICATION_ROUTING_RULE_CREATED',
    'NOTIFICATION_ROUTING_RULE_UPDATED',
    'NOTIFICATION_ROUTING_RULE_DELETED'
  );
