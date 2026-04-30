-- Hotfix - qualify workflow status references during maintenance approval
-- Date: 2026-04-30
--
-- Functional rule:
-- - Fixes "column reference \"status\" is ambiguous" raised during the final CEO
--   approval of a maintenance workflow.
-- - Repairs only MAINTENANCE_START workflow requests that already failed with
--   this exact error after approvals were recorded.
--
-- Run after:
-- - sql/hotfix_2026_04_27_maintenance_daf_ceo_sequential_approval.sql
-- - sql/hotfix_2026_04_29_pending_maintenance_blocks_asset_status.sql

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
  v_next_maintenance_role text;
  v_has_ceo_approval boolean;
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

  if upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START' then
    v_next_maintenance_role := public.maintenance_workflow_next_role(p_request_id);

    if v_next_maintenance_role is null then
      raise exception 'Ce ticket maintenance ne possède plus d''étape d''approbation ouverte';
    end if;

    if v_actor_role <> v_next_maintenance_role then
      if v_next_maintenance_role = 'DAF' then
        raise exception 'Validation conformité DAF requise avant accord CEO';
      end if;
      raise exception 'Accord CEO requis pour démarrer la maintenance';
    end if;

    select exists (
      select 1
      from public.workflow_request_approvals a
      where a.request_id = p_request_id
        and upper(coalesce(a.decision, '')) = 'APPROVED'
        and upper(coalesce(a.approver_role, '')) = 'CEO'
    )
    into v_has_ceo_approval;

    if v_actor_role = 'DAF' and v_has_ceo_approval then
      raise exception 'Flux maintenance non conforme: accord CEO déjà enregistré avant conformité DAF';
    end if;
  elsif not public.has_any_app_role(v_request.approver_roles) then
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

  update public.workflow_requests wr
  set updated_at = now()
  where wr.id = p_request_id;

  perform public.insert_workflow_audit_log(
    p_request_id,
    'WORKFLOW_REQUEST_APPROVAL_RECORDED',
    jsonb_build_object(
      'decision', 'APPROVED',
      'approval_count', v_approval_count,
      'approver_user_id', auth.uid(),
      'approver_role', v_actor_role,
      'note', v_note,
      'maintenance_step',
      case
        when upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START'
          and v_actor_role = 'DAF' then 'DAF_CONFORMITY'
        when upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START'
          and v_actor_role = 'CEO' then 'CEO_START_AGREEMENT'
        else null
      end
    )
  );

  if v_approval_count < v_request.required_approvals then
    if upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START' then
      perform public.notify_workflow_request_pending(p_request_id);
    end if;

    return query
    select p_request_id, 'PENDING', v_approval_count, false;
    return;
  end if;

  begin
    if upper(v_request.request_type) = 'ASSET_DELETE' then
      delete from public.assets a
      where a.id = v_request.asset_id;

      if not found then
        raise exception 'Suppression impossible: actif introuvable';
      end if;
    elsif upper(v_request.request_type) = 'ASSET_PURCHASE_VALUE_CHANGE' then
      v_new_purchase_value := nullif(v_request.payload ->> 'new_purchase_value', '')::numeric;

      perform set_config('app.asset_change_source', 'WORKFLOW_PURCHASE_VALUE_APPROVAL', true);
      perform set_config('app.asset_change_reason', coalesce(v_request.reason, ''), true);

      update public.assets a
      set
        purchase_value = v_new_purchase_value,
        value = v_new_purchase_value
      where a.id = v_request.asset_id;

      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);

      if not found then
        raise exception 'Mise à jour impossible: actif introuvable';
      end if;
    elsif upper(v_request.request_type) = 'MAINTENANCE_START' then
      v_maintenance_id := nullif(v_request.payload ->> 'maintenance_id', '')::uuid;

      update public.maintenance m
      set
        status = 'EN_COURS',
        approval_status = 'APPROUVEE',
        started_at = coalesce(m.started_at, now())
      where m.id = v_maintenance_id;

      if not found then
        raise exception 'Validation maintenance impossible: ticket introuvable';
      end if;

      perform set_config('app.asset_change_source', 'MAINTENANCE_START_APPROVAL', true);
      perform set_config('app.asset_change_reason', 'Conformité DAF validée et accord CEO donné', true);

      update public.assets a
      set status = 'EN_MAINTENANCE'
      where a.id = v_request.asset_id
        and upper(coalesce(a.status, '')) <> 'REBUS';

      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);
    elsif upper(v_request.request_type) = 'ASSET_REBUS' then
      perform set_config('app.asset_change_source', 'REBUS_APPROVAL', true);
      perform set_config('app.asset_change_reason', coalesce(v_request.reason, ''), true);

      update public.assets a
      set status = 'REBUS'
      where a.id = v_request.asset_id;

      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);

      if not found then
        raise exception 'Passage en rebus impossible: actif introuvable';
      end if;
    else
      raise exception 'Unsupported workflow request type: %', v_request.request_type;
    end if;

    update public.workflow_requests wr
    set
      status = 'APPROVED',
      approved_at = now(),
      applied_at = now(),
      resolved_by = auth.uid(),
      resolution_note = coalesce(v_note, wr.resolution_note),
      updated_at = now()
    where wr.id = p_request_id;

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

      update public.workflow_requests wr
      set
        status = 'FAILED',
        resolved_by = auth.uid(),
        resolution_note = left(coalesce(v_note || ' | ', '') || sqlerrm, 2000),
        updated_at = now()
      where wr.id = p_request_id;

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

-- Repair already failed maintenance approvals caused by the ambiguous status bug.
with failed_requests as (
  select
    wr.id as request_id,
    wr.asset_id,
    nullif(wr.payload ->> 'maintenance_id', '')::uuid as maintenance_id,
    coalesce(ap.approval_count, 0) as approval_count
  from public.workflow_requests wr
  left join (
    select
      request_id,
      count(*) filter (where upper(coalesce(decision, '')) = 'APPROVED') as approval_count
    from public.workflow_request_approvals
    group by request_id
  ) ap on ap.request_id = wr.id
  where upper(coalesce(wr.request_type, '')) = 'MAINTENANCE_START'
    and upper(coalesce(wr.status, '')) = 'FAILED'
    and coalesce(wr.resolution_note, '') ilike '%column reference "status" is ambiguous%'
    and coalesce(ap.approval_count, 0) >= coalesce(wr.required_approvals, 2)
),
repaired_maintenance as (
  update public.maintenance m
  set
    status = 'EN_COURS',
    approval_status = 'APPROUVEE',
    started_at = coalesce(m.started_at, now())
  from failed_requests fr
  where m.id = fr.maintenance_id
    and coalesce(m.is_completed, false) = false
    and upper(coalesce(m.approval_status, '')) <> 'REJETEE'
  returning fr.request_id
),
repaired_assets as (
  update public.assets a
  set status = 'EN_MAINTENANCE'
  from repaired_maintenance rm
  join failed_requests fr on fr.request_id = rm.request_id
  where a.id = fr.asset_id
    and upper(coalesce(a.status, '')) <> 'REBUS'
  returning fr.request_id
),
repaired_requests as (
  update public.workflow_requests wr
  set
    status = 'APPROVED',
    approved_at = coalesce(wr.approved_at, now()),
    applied_at = coalesce(wr.applied_at, now()),
    resolution_note = 'Reprise automatique apres hotfix: column reference status is ambiguous',
    updated_at = now()
  from repaired_maintenance rm
  where wr.id = rm.request_id
  returning wr.id
)
select
  (select count(*) from failed_requests) as failed_requests_found,
  (select count(*) from repaired_maintenance) as maintenance_repaired,
  (select count(*) from repaired_assets) as assets_repaired,
  (select count(*) from repaired_requests) as requests_repaired;

-- Verification examples:
--
-- 1) No workflow should remain failed with this exact technical error.
-- select id, request_type, status, title, resolution_note, updated_at
-- from public.workflow_requests
-- where upper(coalesce(request_type, '')) = 'MAINTENANCE_START'
--   and upper(coalesce(status, '')) = 'FAILED'
--   and coalesce(resolution_note, '') ilike '%column reference "status" is ambiguous%'
-- order by updated_at desc;
--
-- 2) Verify recent maintenance approvals.
-- select
--   wr.id,
--   wr.status as workflow_status,
--   wr.resolution_note,
--   m.status as maintenance_status,
--   m.approval_status,
--   a.status as asset_status
-- from public.workflow_requests wr
-- left join public.maintenance m on m.id = nullif(wr.payload ->> 'maintenance_id', '')::uuid
-- left join public.assets a on a.id = wr.asset_id
-- where upper(coalesce(wr.request_type, '')) = 'MAINTENANCE_START'
-- order by wr.updated_at desc
-- limit 20;
