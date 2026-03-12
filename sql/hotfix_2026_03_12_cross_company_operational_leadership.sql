-- Hotfix - cross-company operational leadership access
-- Date: 2026-03-12
--
-- Run on an existing lot 14 environment when cross-company access must be
-- aligned as follows:
-- - CEO / DAF / RESPONSABLE_MAINTENANCE can operate across all companies
-- - only CEO / DAF approve workflow tickets
-- - RESPONSABLE_MAINTENANCE can create maintenance / rebus requests
--   but is not an approver
--
-- Target scope:
-- 1) incident closure
-- 2) maintenance closure
-- 3) maintenance workflow approvals
-- 4) asset rebus workflows

drop policy if exists incidents_update_authorized on public.incidents;
create policy incidents_update_authorized
on public.incidents
for update
using (public.is_ceo() or public.is_daf() or public.is_maintenance_manager())
with check (public.is_ceo() or public.is_daf() or public.is_maintenance_manager());

drop policy if exists maintenance_update_authorized on public.maintenance;
create policy maintenance_update_authorized
on public.maintenance
for update
using (public.is_ceo() or public.is_daf() or public.is_maintenance_manager())
with check (public.is_ceo() or public.is_daf() or public.is_maintenance_manager());

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

    if v_claim_role = 'authenticated'
       and not (public.is_ceo() or public.is_daf() or public.is_maintenance_manager()) then
      raise exception 'forbidden: only CEO, DAF, or RESPONSABLE_MAINTENANCE can close incidents';
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

create or replace function public.create_workflow_request(
  p_request_type text,
  p_asset_id uuid,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb,
  p_required_approvals integer default 1,
  p_approver_roles text[] default array['CEO']
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
  v_required_approvals := greatest(1, least(coalesce(p_required_approvals, 1), 5));

  if v_request_type not in (
    'ASSET_DELETE',
    'ASSET_PURCHASE_VALUE_CHANGE',
    'MAINTENANCE_START',
    'ASSET_REBUS'
  ) then
    raise exception 'unsupported workflow request type: %', p_request_type;
  end if;

  if v_request_type = 'ASSET_REBUS'
     and v_requester_role not in ('CEO', 'DAF', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE_MAINTENANCE can signal an asset as irreparable';
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
    array['CEO']
  )
  into v_approver_roles
  from unnest(coalesce(p_approver_roles, array['CEO'])) as roles(role_name);

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
      when v_request_type = 'ASSET_PURCHASE_VALUE_CHANGE' then format('Changement valeur d''achat: %s', coalesce(v_asset.name, '-'))
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
    array['CEO', 'DAF']
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

update public.workflow_requests wr
set
  approver_roles = normalized.approver_roles,
  updated_at = now()
from (
  select
    source.id,
    array_agg(distinct source.role_name order by source.role_name) as approver_roles
  from (
    select
      wr.id,
      upper(trim(role_name)) as role_name
    from public.workflow_requests wr
    cross join lateral unnest(
      case
        when upper(coalesce(wr.request_type, '')) = 'MAINTENANCE_START'
          then array['CEO', 'DAF']::text[]
        when upper(coalesce(wr.request_type, '')) = 'ASSET_REBUS'
          then array['CEO', 'DAF', 'RESPONSABLE']::text[]
        else coalesce(wr.approver_roles, array[]::text[])
      end
    ) as expanded(role_name)
    where upper(coalesce(wr.status, '')) = 'PENDING'
      and upper(coalesce(wr.request_type, '')) in ('MAINTENANCE_START', 'ASSET_REBUS')
      and trim(coalesce(role_name, '')) <> ''
  ) as source
  group by source.id
) as normalized
where wr.id = normalized.id
  and coalesce(wr.approver_roles, array[]::text[]) is distinct from normalized.approver_roles;

create or replace function public.notification_preference_default(
  p_role text,
  p_channel text,
  p_notification_type text
)
returns boolean
language sql
immutable
as $$
  select case
    when upper(coalesce(p_channel, '')) not in ('APP', 'EMAIL') then false
    when upper(coalesce(p_notification_type, '')) = 'WORKFLOW_PENDING'
      then upper(coalesce(p_role, '')) in ('CEO', 'DAF', 'RESPONSABLE')
    when upper(coalesce(p_notification_type, '')) in ('WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'WORKFLOW_FAILED')
      then true
    when upper(coalesce(p_notification_type, '')) = 'INCIDENT_ALERT'
      then upper(coalesce(p_role, '')) in ('CEO', 'DAF', 'RESPONSABLE_MAINTENANCE')
    else false
  end
$$;

revoke all on function public.notification_preference_default(text, text, text) from public;
grant execute on function public.notification_preference_default(text, text, text) to authenticated;

create or replace function public.notification_advanced_preference_default(
  p_role text,
  p_channel text,
  p_preference_key text
)
returns boolean
language sql
immutable
as $$
  select case lower(coalesce(p_preference_key, ''))
    when 'pending_asset_delete' then upper(coalesce(p_role, '')) = 'CEO'
    when 'pending_purchase_value_change' then upper(coalesce(p_role, '')) = 'CEO'
    when 'pending_maintenance_ticket' then upper(coalesce(p_role, '')) in ('CEO', 'DAF')
    when 'pending_asset_rebus' then upper(coalesce(p_role, '')) in ('CEO', 'DAF', 'RESPONSABLE')
    when 'result_asset_delete' then true
    when 'result_purchase_value_change' then true
    when 'result_maintenance_ticket' then true
    when 'result_asset_rebus' then true
    else false
  end
$$;

revoke all on function public.notification_advanced_preference_default(text, text, text) from public;
grant execute on function public.notification_advanced_preference_default(text, text, text) to authenticated;

insert into public.notification_routing_rules (
  notification_type,
  request_type,
  channel,
  role,
  is_enabled
)
values
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'APP', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'EMAIL', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'APP', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'EMAIL', 'RESPONSABLE_MAINTENANCE', false)
on conflict (notification_type, request_type, channel, role) do update
set
  is_enabled = excluded.is_enabled,
  updated_at = now(),
  updated_by = coalesce(public.audit_actor_id(), public.notification_routing_rules.updated_by);

create or replace function public.notification_role_routed(
  p_channel text,
  p_notification_type text,
  p_request_type text default 'ANY',
  p_role text default ''
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_type text;
  v_request_type text;
  v_role text;
  v_exact_count integer;
  v_any_count integer;
begin
  v_channel := upper(coalesce(p_channel, ''));
  v_type := upper(coalesce(p_notification_type, ''));
  v_request_type := upper(coalesce(nullif(p_request_type, ''), 'ANY'));
  v_role := upper(coalesce(p_role, ''));

  select count(*)
  into v_exact_count
  from public.notification_routing_rules r
  where upper(coalesce(r.channel, '')) = v_channel
    and upper(coalesce(r.notification_type, '')) = v_type
    and upper(coalesce(r.request_type, 'ANY')) = v_request_type;

  if coalesce(v_exact_count, 0) > 0 then
    return exists (
      select 1
      from public.notification_routing_rules r
      where upper(coalesce(r.channel, '')) = v_channel
        and upper(coalesce(r.notification_type, '')) = v_type
        and upper(coalesce(r.request_type, 'ANY')) = v_request_type
        and upper(coalesce(r.role, '')) = v_role
        and coalesce(r.is_enabled, false)
    );
  end if;

  select count(*)
  into v_any_count
  from public.notification_routing_rules r
  where upper(coalesce(r.channel, '')) = v_channel
    and upper(coalesce(r.notification_type, '')) = v_type
    and upper(coalesce(r.request_type, 'ANY')) = 'ANY';

  if coalesce(v_any_count, 0) > 0 then
    return exists (
      select 1
      from public.notification_routing_rules r
      where upper(coalesce(r.channel, '')) = v_channel
        and upper(coalesce(r.notification_type, '')) = v_type
        and upper(coalesce(r.request_type, 'ANY')) = 'ANY'
        and upper(coalesce(r.role, '')) = v_role
        and coalesce(r.is_enabled, false)
    );
  end if;

  return case
    when v_type = 'WORKFLOW_PENDING' and v_request_type in ('ASSET_DELETE', 'ASSET_PURCHASE_VALUE_CHANGE')
      then v_role = 'CEO'
    when v_type = 'WORKFLOW_PENDING' and v_request_type = 'MAINTENANCE_START'
      then v_role in ('CEO', 'DAF')
    when v_type = 'WORKFLOW_PENDING' and v_request_type = 'ASSET_REBUS'
      then v_role in ('CEO', 'DAF', 'RESPONSABLE')
    when v_type = 'INCIDENT_ALERT'
      then v_role in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE')
    else true
  end;
end;
$$;

revoke all on function public.notification_role_routed(text, text, text, text) from public;
grant execute on function public.notification_role_routed(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
