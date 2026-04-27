-- Hotfix - sequential maintenance approval: DAF conformity, then CEO start agreement
-- Date: 2026-04-27
--
-- Business rule:
-- - DAF validates the maintenance ticket conformity first.
-- - CEO gives the final agreement to start maintenance second.
-- - RESPONSABLE_MAINTENANCE can create maintenance tickets, but cannot approve them.
--
-- Run after:
-- - sql/feature_lot3_workflow_roles_and_asset_history.sql
-- - sql/feature_notification_governance.sql
-- - sql/hotfix_2026_03_12_cross_company_operational_leadership.sql if used in the target environment

create or replace function public.maintenance_workflow_next_role(
  p_request_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request_type text;
  v_status text;
  v_has_daf_approval boolean;
  v_has_ceo_approval boolean;
begin
  select
    upper(coalesce(wr.request_type, '')),
    upper(coalesce(wr.status, ''))
  into v_request_type, v_status
  from public.workflow_requests wr
  where wr.id = p_request_id;

  if not found or v_request_type <> 'MAINTENANCE_START' or v_status <> 'PENDING' then
    return null;
  end if;

  select exists (
    select 1
    from public.workflow_request_approvals a
    where a.request_id = p_request_id
      and upper(coalesce(a.decision, '')) = 'APPROVED'
      and upper(coalesce(a.approver_role, '')) = 'DAF'
  )
  into v_has_daf_approval;

  select exists (
    select 1
    from public.workflow_request_approvals a
    where a.request_id = p_request_id
      and upper(coalesce(a.decision, '')) = 'APPROVED'
      and upper(coalesce(a.approver_role, '')) = 'CEO'
  )
  into v_has_ceo_approval;

  if not v_has_daf_approval then
    return 'DAF';
  end if;

  if not v_has_ceo_approval then
    return 'CEO';
  end if;

  return null;
end;
$$;

revoke all on function public.maintenance_workflow_next_role(uuid) from public;
grant execute on function public.maintenance_workflow_next_role(uuid) to authenticated;

create or replace function public.workflow_request_pending_roles(
  p_request_id uuid
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request public.workflow_requests%rowtype;
  v_next_role text;
begin
  select *
  into v_request
  from public.workflow_requests
  where id = p_request_id;

  if not found or upper(coalesce(v_request.status, '')) <> 'PENDING' then
    return array[]::text[];
  end if;

  if upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START' then
    v_next_role := public.maintenance_workflow_next_role(p_request_id);
    if v_next_role is null then
      return array[]::text[];
    end if;
    return array[v_next_role]::text[];
  end if;

  return coalesce(v_request.approver_roles, array[]::text[]);
end;
$$;

revoke all on function public.workflow_request_pending_roles(uuid) from public;
grant execute on function public.workflow_request_pending_roles(uuid) to authenticated;

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
  v_asset record;
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
    raise exception 'Titre maintenance obligatoire';
  end if;

  v_priority := upper(nullif(trim(coalesce(p_priority, '')), ''));
  if v_priority is null then
    v_priority := 'MOYENNE';
  end if;

  if v_priority not in ('BASSE', 'MOYENNE', 'HAUTE', 'CRITIQUE') then
    raise exception 'Priorité maintenance invalide: %', p_priority;
  end if;

  v_cost := greatest(coalesce(p_cost, 0), 0);

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

  if upper(coalesce(v_asset.status, '')) = 'REBUS' then
    raise exception 'Impossible de créer une maintenance sur un actif en rebus';
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
      'asset_name', v_asset.name,
      'asset_code', v_asset.code,
      'company_id', v_asset.company_id,
      'company_name', v_asset.company_name,
      'title', v_title,
      'description', p_description,
      'cost', v_cost,
      'priority', v_priority,
      'due_date', p_due_date,
      'requested_status', 'EN_ATTENTE_VALIDATION',
      'approval_flow', 'DAF_CONFORMITY_THEN_CEO_START'
    ),
    2,
    array['DAF', 'CEO']
  );

  update public.maintenance
  set workflow_request_id = v_request_id
  where id = v_maintenance_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_maintenance_start(uuid, text, text, numeric, text, date) from public;
grant execute on function public.request_maintenance_start(uuid, text, text, numeric, text, date) to authenticated;

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
      perform set_config('app.asset_change_reason', 'Conformité DAF validée et accord CEO donné', true);

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
  v_next_maintenance_role text;
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

  if upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START' then
    v_next_maintenance_role := public.maintenance_workflow_next_role(p_request_id);

    if v_next_maintenance_role is null then
      raise exception 'Ce ticket maintenance ne possède plus d''étape d''approbation ouverte';
    end if;

    if v_actor_role <> v_next_maintenance_role then
      if v_next_maintenance_role = 'DAF' then
        raise exception 'Rejet conformité DAF requis avant décision CEO';
      end if;
      raise exception 'Décision CEO requise après conformité DAF';
    end if;
  elsif not public.has_any_app_role(v_request.approver_roles) then
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
      'note', v_note,
      'maintenance_step',
      case
        when upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START'
          and v_actor_role = 'DAF' then 'DAF_CONFORMITY_REJECTED'
        when upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START'
          and v_actor_role = 'CEO' then 'CEO_START_REJECTED'
        else null
      end
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
      and not coalesce(ap.already_decided, false)
      and (
        (
          upper(coalesce(wr.request_type, '')) = 'MAINTENANCE_START'
          and public.current_app_role() = public.maintenance_workflow_next_role(wr.id)
        )
        or (
          upper(coalesce(wr.request_type, '')) <> 'MAINTENANCE_START'
          and public.has_any_app_role(wr.approver_roles)
        )
      )
    ) as can_approve,
    coalesce(ap.already_decided, false) as already_decided
  from public.workflow_requests wr
  left join approvals ap on ap.request_id = wr.id
  left join public.assets asset_live on asset_live.id = wr.asset_id
  left join public.organisations org_live on org_live.id = wr.company_id
  where
    (
      wr.requested_by = auth.uid()
      or (
        upper(coalesce(wr.request_type, '')) = 'MAINTENANCE_START'
        and (
          public.current_app_role() = any(public.workflow_request_pending_roles(wr.id))
          or public.has_any_app_role(wr.approver_roles)
        )
      )
      or (
        upper(coalesce(wr.request_type, '')) <> 'MAINTENANCE_START'
        and public.has_any_app_role(wr.approver_roles)
      )
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

create or replace function public.notify_workflow_request_pending(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.workflow_requests%rowtype;
  v_type_label text;
  v_title text;
  v_body text;
  v_payload jsonb;
  v_rendered record;
  v_pending_roles text[];
  v_maintenance_next_role text;
begin
  select *
  into v_request
  from public.workflow_requests
  where id = p_request_id;

  if not found then
    return;
  end if;

  if upper(coalesce(v_request.status, '')) <> 'PENDING' then
    return;
  end if;

  v_pending_roles := public.workflow_request_pending_roles(p_request_id);
  if coalesce(array_length(v_pending_roles, 1), 0) = 0 then
    return;
  end if;

  v_maintenance_next_role := case
    when upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START'
      then public.maintenance_workflow_next_role(p_request_id)
    else null
  end;

  v_type_label := public.notification_workflow_type_label(v_request.request_type);
  v_title := case
    when v_maintenance_next_role = 'DAF'
      then 'Conformité maintenance à valider'
    when v_maintenance_next_role = 'CEO'
      then 'Accord CEO requis pour démarrer la maintenance'
    else format('Validation requise: %s', initcap(v_type_label))
  end;
  v_body := coalesce(
    nullif(trim(coalesce(v_request.title, '')), ''),
    nullif(trim(coalesce(v_request.reason, '')), ''),
    coalesce(v_request.asset_name_snapshot, 'Nouvelle demande')
  );

  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'workflow_request_id', v_request.id,
      'request_type', v_request.request_type,
      'request_status', v_request.status,
      'asset_id', v_request.asset_id,
      'asset_name', v_request.asset_name_snapshot,
      'company_id', v_request.company_id,
      'company_name', v_request.company_name_snapshot,
      'reason', v_request.reason,
      'title', v_request.title,
      'maintenance_next_role', v_maintenance_next_role
    )
  );

  select *
  into v_rendered
  from public.resolve_notification_template_values(
    'WORKFLOW_PENDING',
    v_payload,
    v_title,
    v_title,
    v_body,
    'Traiter la demande'
  );

  v_payload := v_payload || jsonb_strip_nulls(
    jsonb_build_object(
      'email_subject', v_rendered.email_subject,
      'cta_label', v_rendered.cta_label,
      'template_name', v_rendered.template_name
    )
  );

  insert into public.notifications (
    recipient_user_id,
    actor_user_id,
    notification_type,
    title,
    body,
    link_path,
    entity_type,
    entity_id,
    payload,
    status,
    created_at,
    updated_at
  )
  select
    p.id,
    v_request.requested_by,
    'WORKFLOW_PENDING',
    v_rendered.title,
    v_rendered.body,
    '/approvals',
    'workflow_requests',
    v_request.id::text,
    v_payload,
    'UNREAD',
    now(),
    now()
  from public.profiles p
  where upper(coalesce(p.role, '')) = any(v_pending_roles)
    and (
      p.id is distinct from v_request.requested_by
      or upper(coalesce(v_request.request_type, '')) = 'MAINTENANCE_START'
    )
    and (
      public.notification_delivery_enabled(p.id, 'APP', 'WORKFLOW_PENDING', v_payload)
      or public.notification_delivery_enabled(p.id, 'EMAIL', 'WORKFLOW_PENDING', v_payload)
    )
    and not exists (
      select 1
      from public.notifications n
      where n.recipient_user_id = p.id
        and n.notification_type = 'WORKFLOW_PENDING'
        and n.payload ->> 'workflow_request_id' = v_request.id::text
        and coalesce(n.payload ->> 'maintenance_next_role', '') = coalesce(v_maintenance_next_role, '')
    );
end;
$$;

revoke all on function public.notify_workflow_request_pending(uuid) from public;
grant execute on function public.notify_workflow_request_pending(uuid) to authenticated;

update public.workflow_requests
set
  approver_roles = array['DAF', 'CEO'],
  required_approvals = 2,
  payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
    'approval_flow', 'DAF_CONFORMITY_THEN_CEO_START'
  ),
  updated_at = now()
where upper(coalesce(request_type, '')) = 'MAINTENANCE_START'
  and upper(coalesce(status, '')) = 'PENDING';

-- Verification examples:
--
-- 1) Pending maintenance tickets should now require two approvals and expose DAF as first step.
-- select
--   id,
--   request_type,
--   status,
--   required_approvals,
--   approver_roles,
--   public.maintenance_workflow_next_role(id) as next_role
-- from public.workflow_requests
-- where upper(request_type) = 'MAINTENANCE_START'
-- order by created_at desc
-- limit 20;
--
-- 2) Simulate a DAF user in SQL Editor and verify can_approve before any DAF approval.
-- select set_config('request.jwt.claim.role', 'authenticated', false);
-- select set_config('request.jwt.claim.sub', '<DAF_USER_UUID>', false);
-- select id, request_type, approval_count, required_approvals, can_approve
-- from public.list_workflow_requests_secure('PENDING', 50, 0)
-- where upper(request_type) = 'MAINTENANCE_START';
--
-- 3) Simulate a CEO user after DAF approval and verify CEO can give final agreement.
-- select set_config('request.jwt.claim.role', 'authenticated', false);
-- select set_config('request.jwt.claim.sub', '<CEO_USER_UUID>', false);
-- select id, request_type, approval_count, required_approvals, can_approve
-- from public.list_workflow_requests_secure('PENDING', 50, 0)
-- where upper(request_type) = 'MAINTENANCE_START';
