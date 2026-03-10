-- Feature - Actionable data health dashboard
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/security_admin_audit_upgrade.sql
-- 2) sql/step_1_security_integrity_hardening.sql
-- 3) sql/feature_lot3_workflow_roles_and_asset_history.sql
-- 4) sql/feature_company_rules_engine.sql

create or replace function public.current_actor_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(coalesce(p.role, ''))
  from public.profiles p
  where p.id = public.audit_actor_id()
  limit 1
$$;

revoke all on function public.current_actor_role() from public;
grant execute on function public.current_actor_role() to authenticated;

create or replace function public.list_data_health_issues_secure(
  p_issue_type text default null,
  p_company_id uuid default null,
  p_category text default null,
  p_period text default '12M',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  issue_type text,
  entity_type text,
  record_id uuid,
  asset_id uuid,
  asset_name text,
  company_id uuid,
  company_name text,
  label text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period_start timestamptz;
  v_issue_type text;
  v_category text;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role not in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'forbidden: data health details reserved to operational roles';
  end if;

  v_period_start := case upper(coalesce(p_period, '12M'))
    when '30D' then now() - interval '30 days'
    when '90D' then now() - interval '90 days'
    when 'YTD' then date_trunc('year', now())
    when '12M' then now() - interval '365 days'
    else null
  end;

  v_issue_type := upper(nullif(trim(coalesce(p_issue_type, '')), ''));
  v_category := nullif(btrim(coalesce(p_category, '')), '');

  return query
  with filtered_assets as (
    select
      a.id,
      a.name,
      a.code,
      a.status,
      a.company_id,
      a.category,
      a.purchase_date,
      a.purchase_value,
      a.value,
      a.amortissement_type,
      a.amortissement_duration,
      a.created_at,
      o.name as company_name
    from public.assets a
    left join public.organisations o on o.id = a.company_id
    where
      (p_company_id is null or a.company_id = p_company_id)
      and (
        v_category is null
        or upper(v_category) = 'ALL'
        or coalesce(a.category, '') = v_category
      )
  ),
  incidents_period as (
    select
      i.id,
      i.asset_id,
      i.title,
      i.description,
      i.status,
      i.created_at,
      fa.name as asset_name,
      fa.company_id,
      coalesce(fa.company_name, 'Sans société') as company_name
    from public.incidents i
    join filtered_assets fa on fa.id = i.asset_id
    where v_period_start is null or i.created_at >= v_period_start
  ),
  maintenance_backlog as (
    select
      m.id,
      m.asset_id,
      m.title,
      m.description,
      m.status,
      m.priority,
      m.cost,
      m.approval_status,
      m.due_date,
      m.created_at,
      fa.name as asset_name,
      fa.company_id,
      coalesce(fa.company_name, 'Sans société') as company_name
    from public.maintenance m
    join filtered_assets fa on fa.id = m.asset_id
    where
      coalesce(m.is_completed, false) = false
      and upper(coalesce(m.status, '')) <> 'TERMINEE'
  ),
  issue_rows as (
    select
      'MISSING_VALUE'::text as issue_type,
      'assets'::text as entity_type,
      fa.id as record_id,
      fa.id as asset_id,
      fa.name as asset_name,
      fa.company_id,
      coalesce(fa.company_name, 'Sans société') as company_name,
      fa.name as label,
      jsonb_strip_nulls(
        jsonb_build_object(
          'asset_code', fa.code,
          'category', fa.category,
          'status', fa.status,
          'purchase_date', fa.purchase_date
        )
      ) as details,
      fa.created_at
    from filtered_assets fa
    where fa.purchase_value is null and fa.value is null

    union all

    select
      'MISSING_COMPANY'::text as issue_type,
      'assets'::text as entity_type,
      fa.id as record_id,
      fa.id as asset_id,
      fa.name as asset_name,
      fa.company_id,
      coalesce(fa.company_name, 'Sans société') as company_name,
      fa.name as label,
      jsonb_strip_nulls(
        jsonb_build_object(
          'asset_code', fa.code,
          'category', fa.category,
          'status', fa.status,
          'purchase_date', fa.purchase_date
        )
      ) as details,
      fa.created_at
    from filtered_assets fa
    where fa.company_id is null

    union all

    select
      'MISSING_AMORTIZATION'::text as issue_type,
      'assets'::text as entity_type,
      fa.id as record_id,
      fa.id as asset_id,
      fa.name as asset_name,
      fa.company_id,
      coalesce(fa.company_name, 'Sans société') as company_name,
      fa.name as label,
      jsonb_strip_nulls(
        jsonb_build_object(
          'asset_code', fa.code,
          'category', fa.category,
          'status', fa.status,
          'purchase_value_effective', coalesce(fa.purchase_value, fa.value, 0),
          'amortissement_type', fa.amortissement_type,
          'amortissement_duration', fa.amortissement_duration
        )
      ) as details,
      fa.created_at
    from filtered_assets fa
    where coalesce(fa.amortissement_type, '') = '' or fa.amortissement_duration is null

    union all

    select
      'MAINTENANCE_MISSING_DEADLINE'::text as issue_type,
      'maintenance'::text as entity_type,
      mb.id as record_id,
      mb.asset_id,
      mb.asset_name,
      mb.company_id,
      mb.company_name,
      coalesce(nullif(trim(coalesce(mb.title, '')), ''), 'Maintenance sans titre') as label,
      jsonb_strip_nulls(
        jsonb_build_object(
          'title', mb.title,
          'description', mb.description,
          'status', mb.status,
          'approval_status', mb.approval_status,
          'priority', mb.priority,
          'cost', mb.cost
        )
      ) as details,
      mb.created_at
    from maintenance_backlog mb
    where mb.due_date is null

    union all

    select
      'INCIDENT_MISSING_TITLE'::text as issue_type,
      'incidents'::text as entity_type,
      ip.id as record_id,
      ip.asset_id,
      ip.asset_name,
      ip.company_id,
      ip.company_name,
      coalesce(nullif(trim(coalesce(ip.description, '')), ''), 'Incident sans titre') as label,
      jsonb_strip_nulls(
        jsonb_build_object(
          'title', ip.title,
          'description', ip.description,
          'status', ip.status
        )
      ) as details,
      ip.created_at
    from incidents_period ip
    where coalesce(ip.title, '') = ''
  )
  select
    r.issue_type,
    r.entity_type,
    r.record_id,
    r.asset_id,
    r.asset_name,
    r.company_id,
    r.company_name,
    r.label,
    r.details,
    r.created_at
  from issue_rows r
  where
    v_issue_type is null
    or v_issue_type = 'ALL'
    or r.issue_type = v_issue_type
  order by
    case r.issue_type
      when 'MISSING_VALUE' then 1
      when 'MISSING_COMPANY' then 2
      when 'MISSING_AMORTIZATION' then 3
      when 'MAINTENANCE_MISSING_DEADLINE' then 4
      when 'INCIDENT_MISSING_TITLE' then 5
      else 99
    end,
    r.created_at desc,
    r.label asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_data_health_issues_secure(text, uuid, text, text, integer, integer) from public;
grant execute on function public.list_data_health_issues_secure(text, uuid, text, text, integer, integer) to authenticated;

create or replace function public.fix_data_health_asset_purchase_value(
  p_asset_id uuid,
  p_purchase_value numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role <> 'CEO' then
    raise exception 'forbidden: only CEO can fix missing purchase value';
  end if;

  if p_purchase_value is null or p_purchase_value <= 0 then
    raise exception 'Valeur d''achat invalide';
  end if;

  select
    a.id,
    a.name,
    a.code,
    a.company_id,
    a.purchase_value,
    a.value
  into v_asset
  from public.assets a
  where a.id = p_asset_id;

  if not found then
    raise exception 'Asset introuvable';
  end if;

  perform public.update_asset_purchase_value_immediately(
    p_asset_id,
    p_purchase_value,
    'Correction santé données: valeur d''achat manquante'
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'DATA_HEALTH_FIX',
    'assets',
    p_asset_id::text,
    jsonb_build_object(
      'issue_type', 'MISSING_VALUE',
      'asset_id', v_asset.id,
      'asset_name', v_asset.name,
      'asset_code', v_asset.code,
      'company_id', v_asset.company_id,
      'old_purchase_value', v_asset.purchase_value,
      'old_value', v_asset.value,
      'new_purchase_value', p_purchase_value,
      'new_value', p_purchase_value
    )
  );

  return p_asset_id;
end;
$$;

revoke all on function public.fix_data_health_asset_purchase_value(uuid, numeric) from public;
grant execute on function public.fix_data_health_asset_purchase_value(uuid, numeric) to authenticated;

create or replace function public.fix_data_health_asset_company(
  p_asset_id uuid,
  p_company_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_company record;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role not in ('CEO', 'DAF', 'RESPONSABLE') then
    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can fix missing company';
  end if;

  if p_company_id is null then
    raise exception 'Société obligatoire';
  end if;

  select
    a.id,
    a.name,
    a.code,
    a.company_id,
    o.name as company_name
  into v_asset
  from public.assets a
  left join public.organisations o on o.id = a.company_id
  where a.id = p_asset_id
  for update;

  if not found then
    raise exception 'Asset introuvable';
  end if;

  select o.id, o.name
  into v_company
  from public.organisations o
  where o.id = p_company_id;

  if not found then
    raise exception 'Société introuvable';
  end if;

  if v_asset.company_id = p_company_id then
    raise exception 'Cet actif est déjà rattaché à cette société';
  end if;

  begin
    perform set_config('app.asset_change_source', 'DATA_HEALTH_COMPANY_FIX', true);
    perform set_config('app.asset_change_reason', 'Correction santé données: société manquante', true);

    update public.assets
    set company_id = p_company_id
    where id = p_asset_id;

    perform set_config('app.asset_change_source', '', true);
    perform set_config('app.asset_change_reason', '', true);
  exception
    when others then
      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);
      raise;
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'DATA_HEALTH_FIX',
    'assets',
    p_asset_id::text,
    jsonb_build_object(
      'issue_type', 'MISSING_COMPANY',
      'asset_id', v_asset.id,
      'asset_name', v_asset.name,
      'asset_code', v_asset.code,
      'old_company_id', v_asset.company_id,
      'old_company_name', v_asset.company_name,
      'new_company_id', v_company.id,
      'new_company_name', v_company.name
    )
  );

  return p_asset_id;
end;
$$;

revoke all on function public.fix_data_health_asset_company(uuid, uuid) from public;
grant execute on function public.fix_data_health_asset_company(uuid, uuid) to authenticated;

create or replace function public.fix_data_health_asset_amortization(
  p_asset_id uuid,
  p_amortissement_type text,
  p_amortissement_duration integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_type text;
  v_duration integer;
  v_coefficient numeric;
  v_degressive_rate numeric;
  v_linear_annual numeric;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role not in ('CEO', 'DAF', 'RESPONSABLE') then
    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can fix amortization data';
  end if;

  v_type := upper(trim(coalesce(p_amortissement_type, '')));
  v_duration := coalesce(p_amortissement_duration, 0);

  if v_type not in ('LINEAIRE', 'DEGRESSIF') then
    raise exception 'Type d''amortissement invalide';
  end if;

  if v_duration <= 0 or v_duration > 50 then
    raise exception 'Durée d''amortissement invalide';
  end if;

  select
    a.id,
    a.name,
    a.code,
    a.purchase_value,
    a.value,
    a.amortissement_type,
    a.amortissement_duration
  into v_asset
  from public.assets a
  where a.id = p_asset_id
  for update;

  if not found then
    raise exception 'Asset introuvable';
  end if;

  v_coefficient := case
    when v_duration <= 4 then 1.25
    when v_duration <= 6 then 1.75
    else 2.25
  end;

  v_degressive_rate := round((v_coefficient / v_duration::numeric) * 100, 4);
  v_linear_annual := case
    when coalesce(v_asset.purchase_value, v_asset.value, 0) > 0
      then round(coalesce(v_asset.purchase_value, v_asset.value, 0) / v_duration::numeric, 2)
    else null
  end;

  begin
    perform set_config('app.asset_change_source', 'DATA_HEALTH_AMORTIZATION_FIX', true);
    perform set_config('app.asset_change_reason', 'Correction santé données: amortissement incomplet', true);

    update public.assets
    set
      amortissement_type = v_type,
      amortissement_duration = v_duration,
      amortissement_method = v_type,
      amortissement_rate = v_linear_annual,
      amortissement_degressive_rate = v_degressive_rate,
      amortissement_degressive_coefficient = v_coefficient,
      duration = v_duration
    where id = p_asset_id;

    perform set_config('app.asset_change_source', '', true);
    perform set_config('app.asset_change_reason', '', true);
  exception
    when others then
      perform set_config('app.asset_change_source', '', true);
      perform set_config('app.asset_change_reason', '', true);
      raise;
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'DATA_HEALTH_FIX',
    'assets',
    p_asset_id::text,
    jsonb_build_object(
      'issue_type', 'MISSING_AMORTIZATION',
      'asset_id', v_asset.id,
      'asset_name', v_asset.name,
      'asset_code', v_asset.code,
      'old_amortissement_type', v_asset.amortissement_type,
      'old_amortissement_duration', v_asset.amortissement_duration,
      'new_amortissement_type', v_type,
      'new_amortissement_duration', v_duration,
      'new_amortissement_rate', v_linear_annual,
      'new_amortissement_degressive_rate', v_degressive_rate,
      'new_amortissement_degressive_coefficient', v_coefficient
    )
  );

  return p_asset_id;
end;
$$;

revoke all on function public.fix_data_health_asset_amortization(uuid, text, integer) from public;
grant execute on function public.fix_data_health_asset_amortization(uuid, text, integer) to authenticated;

create or replace function public.fix_data_health_maintenance_deadline(
  p_maintenance_id uuid,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maintenance record;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role not in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'forbidden: only operational leadership can fix maintenance deadline';
  end if;

  if p_due_date is null then
    raise exception 'Deadline obligatoire';
  end if;

  select
    m.id,
    m.asset_id,
    m.title,
    m.due_date,
    m.status,
    m.approval_status
  into v_maintenance
  from public.maintenance m
  where m.id = p_maintenance_id
  for update;

  if not found then
    raise exception 'Maintenance introuvable';
  end if;

  if v_maintenance.due_date = p_due_date then
    raise exception 'Cette deadline est déjà renseignée';
  end if;

  update public.maintenance
  set due_date = p_due_date
  where id = p_maintenance_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'DATA_HEALTH_FIX',
    'maintenance',
    p_maintenance_id::text,
    jsonb_build_object(
      'issue_type', 'MAINTENANCE_MISSING_DEADLINE',
      'maintenance_id', v_maintenance.id,
      'asset_id', v_maintenance.asset_id,
      'title', v_maintenance.title,
      'status', v_maintenance.status,
      'approval_status', v_maintenance.approval_status,
      'old_due_date', v_maintenance.due_date,
      'new_due_date', p_due_date
    )
  );

  return p_maintenance_id;
end;
$$;

revoke all on function public.fix_data_health_maintenance_deadline(uuid, date) from public;
grant execute on function public.fix_data_health_maintenance_deadline(uuid, date) to authenticated;

create or replace function public.fix_data_health_incident_title(
  p_incident_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident record;
  v_title text;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role not in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'forbidden: only operational leadership can fix incident title';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    raise exception 'Titre obligatoire';
  end if;

  select
    i.id,
    i.asset_id,
    i.title,
    i.description,
    i.status
  into v_incident
  from public.incidents i
  where i.id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident introuvable';
  end if;

  if coalesce(v_incident.title, '') = v_title then
    raise exception 'Ce titre est déjà renseigné';
  end if;

  update public.incidents
  set title = v_title
  where id = p_incident_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'DATA_HEALTH_FIX',
    'incidents',
    p_incident_id::text,
    jsonb_build_object(
      'issue_type', 'INCIDENT_MISSING_TITLE',
      'incident_id', v_incident.id,
      'asset_id', v_incident.asset_id,
      'old_title', v_incident.title,
      'new_title', v_title,
      'description', v_incident.description,
      'status', v_incident.status
    )
  );

  return p_incident_id;
end;
$$;

revoke all on function public.fix_data_health_incident_title(uuid, text) from public;
grant execute on function public.fix_data_health_incident_title(uuid, text) to authenticated;
