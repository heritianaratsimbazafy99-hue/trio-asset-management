-- Feature - Advanced notification preferences and workflow subtype targeting
-- Date: 2026-03-11
--
-- Run after:
-- 1) sql/feature_notification_preferences.sql
-- 2) sql/feature_email_notifications.sql

alter table if exists public.user_notification_preferences
  add column if not exists advanced_preferences jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_notification_preferences_advanced_preferences_object_check'
      and conrelid = 'public.user_notification_preferences'::regclass
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_preferences_advanced_preferences_object_check
      check (jsonb_typeof(advanced_preferences) = 'object');
  end if;
end $$;

create or replace function public.notification_advanced_preference_key(
  p_notification_type text,
  p_payload jsonb default '{}'::jsonb
)
returns text
language sql
immutable
as $$
  with normalized as (
    select
      upper(coalesce(p_notification_type, '')) as notification_type,
      upper(
        coalesce(
          coalesce(p_payload, '{}'::jsonb) ->> 'request_type',
          coalesce(p_payload, '{}'::jsonb) -> 'notification_payload' ->> 'request_type',
          ''
        )
      ) as request_type
  )
  select case
    when notification_type = 'WORKFLOW_PENDING' and request_type = 'ASSET_DELETE' then 'pending_asset_delete'
    when notification_type = 'WORKFLOW_PENDING' and request_type = 'ASSET_PURCHASE_VALUE_CHANGE' then 'pending_purchase_value_change'
    when notification_type = 'WORKFLOW_PENDING' and request_type = 'MAINTENANCE_START' then 'pending_maintenance_ticket'
    when notification_type = 'WORKFLOW_PENDING' and request_type = 'ASSET_REBUS' then 'pending_asset_rebus'
    when notification_type in ('WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'WORKFLOW_FAILED') and request_type = 'ASSET_DELETE' then 'result_asset_delete'
    when notification_type in ('WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'WORKFLOW_FAILED') and request_type = 'ASSET_PURCHASE_VALUE_CHANGE' then 'result_purchase_value_change'
    when notification_type in ('WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'WORKFLOW_FAILED') and request_type = 'MAINTENANCE_START' then 'result_maintenance_ticket'
    when notification_type in ('WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'WORKFLOW_FAILED') and request_type = 'ASSET_REBUS' then 'result_asset_rebus'
    else null
  end
  from normalized;
$$;

revoke all on function public.notification_advanced_preference_key(text, jsonb) from public;
grant execute on function public.notification_advanced_preference_key(text, jsonb) to authenticated;

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

create or replace function public.build_notification_advanced_preferences_defaults(
  p_role text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'app_pending_asset_delete', public.notification_advanced_preference_default(p_role, 'APP', 'pending_asset_delete'),
    'email_pending_asset_delete', public.notification_advanced_preference_default(p_role, 'EMAIL', 'pending_asset_delete'),
    'app_pending_purchase_value_change', public.notification_advanced_preference_default(p_role, 'APP', 'pending_purchase_value_change'),
    'email_pending_purchase_value_change', public.notification_advanced_preference_default(p_role, 'EMAIL', 'pending_purchase_value_change'),
    'app_pending_maintenance_ticket', public.notification_advanced_preference_default(p_role, 'APP', 'pending_maintenance_ticket'),
    'email_pending_maintenance_ticket', public.notification_advanced_preference_default(p_role, 'EMAIL', 'pending_maintenance_ticket'),
    'app_pending_asset_rebus', public.notification_advanced_preference_default(p_role, 'APP', 'pending_asset_rebus'),
    'email_pending_asset_rebus', public.notification_advanced_preference_default(p_role, 'EMAIL', 'pending_asset_rebus'),
    'app_result_asset_delete', public.notification_advanced_preference_default(p_role, 'APP', 'result_asset_delete'),
    'email_result_asset_delete', public.notification_advanced_preference_default(p_role, 'EMAIL', 'result_asset_delete'),
    'app_result_purchase_value_change', public.notification_advanced_preference_default(p_role, 'APP', 'result_purchase_value_change'),
    'email_result_purchase_value_change', public.notification_advanced_preference_default(p_role, 'EMAIL', 'result_purchase_value_change'),
    'app_result_maintenance_ticket', public.notification_advanced_preference_default(p_role, 'APP', 'result_maintenance_ticket'),
    'email_result_maintenance_ticket', public.notification_advanced_preference_default(p_role, 'EMAIL', 'result_maintenance_ticket'),
    'app_result_asset_rebus', public.notification_advanced_preference_default(p_role, 'APP', 'result_asset_rebus'),
    'email_result_asset_rebus', public.notification_advanced_preference_default(p_role, 'EMAIL', 'result_asset_rebus')
  );
$$;

revoke all on function public.build_notification_advanced_preferences_defaults(text) from public;
grant execute on function public.build_notification_advanced_preferences_defaults(text) to authenticated;

create or replace function public.ensure_user_notification_preferences_advanced(
  p_user_id uuid default public.audit_actor_id()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_user_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  perform public.ensure_user_notification_preferences(p_user_id);

  select upper(coalesce(role, ''))
  into v_role
  from public.profiles
  where id = p_user_id;

  update public.user_notification_preferences pref
  set advanced_preferences =
    public.build_notification_advanced_preferences_defaults(v_role) || coalesce(pref.advanced_preferences, '{}'::jsonb)
  where pref.user_id = p_user_id
    and coalesce(pref.advanced_preferences, '{}'::jsonb) is distinct from
      public.build_notification_advanced_preferences_defaults(v_role) || coalesce(pref.advanced_preferences, '{}'::jsonb);
end;
$$;

revoke all on function public.ensure_user_notification_preferences_advanced(uuid) from public;
grant execute on function public.ensure_user_notification_preferences_advanced(uuid) to authenticated;

create or replace function public.notification_channel_enabled_advanced(
  p_user_id uuid,
  p_channel text,
  p_notification_type text,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_generic_default boolean;
  v_preferences public.user_notification_preferences%rowtype;
  v_channel text;
  v_type text;
  v_advanced_key text;
  v_advanced_field text;
begin
  if p_user_id is null then
    return false;
  end if;

  v_channel := upper(coalesce(p_channel, ''));
  v_type := upper(coalesce(p_notification_type, ''));

  select upper(coalesce(role, ''))
  into v_role
  from public.profiles
  where id = p_user_id;

  v_generic_default := public.notification_preference_default(v_role, v_channel, v_type);
  v_advanced_key := public.notification_advanced_preference_key(v_type, coalesce(p_payload, '{}'::jsonb));

  select *
  into v_preferences
  from public.user_notification_preferences
  where user_id = p_user_id;

  if not found then
    if v_advanced_key is not null then
      return public.notification_advanced_preference_default(v_role, v_channel, v_advanced_key);
    end if;
    return v_generic_default;
  end if;

  if v_advanced_key is not null then
    v_advanced_field := lower(v_channel) || '_' || v_advanced_key;
    if coalesce(v_preferences.advanced_preferences, '{}'::jsonb) ? v_advanced_field then
      return coalesce((v_preferences.advanced_preferences ->> v_advanced_field)::boolean, v_generic_default);
    end if;
    return public.notification_advanced_preference_default(v_role, v_channel, v_advanced_key);
  end if;

  if v_channel = 'APP' then
    return case v_type
      when 'WORKFLOW_PENDING' then coalesce(v_preferences.app_workflow_pending, v_generic_default)
      when 'WORKFLOW_APPROVED' then coalesce(v_preferences.app_workflow_approved, v_generic_default)
      when 'WORKFLOW_REJECTED' then coalesce(v_preferences.app_workflow_rejected, v_generic_default)
      when 'WORKFLOW_FAILED' then coalesce(v_preferences.app_workflow_failed, v_generic_default)
      when 'INCIDENT_ALERT' then coalesce(v_preferences.app_incident_alert, v_generic_default)
      else v_generic_default
    end;
  end if;

  if v_channel = 'EMAIL' then
    return case v_type
      when 'WORKFLOW_PENDING' then coalesce(v_preferences.email_workflow_pending, v_generic_default)
      when 'WORKFLOW_APPROVED' then coalesce(v_preferences.email_workflow_approved, v_generic_default)
      when 'WORKFLOW_REJECTED' then coalesce(v_preferences.email_workflow_rejected, v_generic_default)
      when 'WORKFLOW_FAILED' then coalesce(v_preferences.email_workflow_failed, v_generic_default)
      when 'INCIDENT_ALERT' then coalesce(v_preferences.email_incident_alert, v_generic_default)
      else v_generic_default
    end;
  end if;

  return false;
end;
$$;

revoke all on function public.notification_channel_enabled_advanced(uuid, text, text, jsonb) from public;
grant execute on function public.notification_channel_enabled_advanced(uuid, text, text, jsonb) to authenticated;

create or replace function public.get_my_notification_preferences_advanced()
returns table (
  user_id uuid,
  user_role text,
  app_workflow_pending boolean,
  app_workflow_approved boolean,
  app_workflow_rejected boolean,
  app_workflow_failed boolean,
  app_incident_alert boolean,
  email_workflow_pending boolean,
  email_workflow_approved boolean,
  email_workflow_rejected boolean,
  email_workflow_failed boolean,
  email_incident_alert boolean,
  advanced_preferences jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  perform public.ensure_user_notification_preferences_advanced(v_actor_id);

  return query
  select
    pref.user_id,
    upper(coalesce(p.role, '')) as user_role,
    pref.app_workflow_pending,
    pref.app_workflow_approved,
    pref.app_workflow_rejected,
    pref.app_workflow_failed,
    pref.app_incident_alert,
    pref.email_workflow_pending,
    pref.email_workflow_approved,
    pref.email_workflow_rejected,
    pref.email_workflow_failed,
    pref.email_incident_alert,
    coalesce(pref.advanced_preferences, '{}'::jsonb) as advanced_preferences,
    pref.created_at,
    pref.updated_at
  from public.user_notification_preferences pref
  join public.profiles p on p.id = pref.user_id
  where pref.user_id = v_actor_id;
end;
$$;

revoke all on function public.get_my_notification_preferences_advanced() from public;
grant execute on function public.get_my_notification_preferences_advanced() to authenticated;

create or replace function public.update_my_notification_preferences_advanced(
  p_app_workflow_pending boolean,
  p_app_workflow_approved boolean,
  p_app_workflow_rejected boolean,
  p_app_workflow_failed boolean,
  p_app_incident_alert boolean,
  p_email_workflow_pending boolean,
  p_email_workflow_approved boolean,
  p_email_workflow_rejected boolean,
  p_email_workflow_failed boolean,
  p_email_incident_alert boolean,
  p_advanced_preferences jsonb default '{}'::jsonb
)
returns table (
  user_id uuid,
  user_role text,
  app_workflow_pending boolean,
  app_workflow_approved boolean,
  app_workflow_rejected boolean,
  app_workflow_failed boolean,
  app_incident_alert boolean,
  email_workflow_pending boolean,
  email_workflow_approved boolean,
  email_workflow_rejected boolean,
  email_workflow_failed boolean,
  email_incident_alert boolean,
  advanced_preferences jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_payload jsonb;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  if p_advanced_preferences is null or jsonb_typeof(p_advanced_preferences) <> 'object' then
    raise exception 'advanced_preferences must be a JSON object';
  end if;

  perform public.ensure_user_notification_preferences_advanced(v_actor_id);

  select upper(coalesce(role, ''))
  into v_role
  from public.profiles
  where id = v_actor_id;

  v_payload := public.build_notification_advanced_preferences_defaults(v_role) || coalesce(p_advanced_preferences, '{}'::jsonb);

  update public.user_notification_preferences
  set
    app_workflow_pending = p_app_workflow_pending,
    app_workflow_approved = p_app_workflow_approved,
    app_workflow_rejected = p_app_workflow_rejected,
    app_workflow_failed = p_app_workflow_failed,
    app_incident_alert = p_app_incident_alert,
    email_workflow_pending = p_email_workflow_pending,
    email_workflow_approved = p_email_workflow_approved,
    email_workflow_rejected = p_email_workflow_rejected,
    email_workflow_failed = p_email_workflow_failed,
    email_incident_alert = p_email_incident_alert,
    advanced_preferences = v_payload,
    updated_at = now()
  where user_id = v_actor_id;

  return query
  select *
  from public.get_my_notification_preferences_advanced();
end;
$$;

revoke all on function public.update_my_notification_preferences_advanced(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, jsonb) from public;
grant execute on function public.update_my_notification_preferences_advanced(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, jsonb) to authenticated;

create or replace function public.list_notifications_secure(
  p_status text default 'ALL',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  notification_type text,
  title text,
  body text,
  link_path text,
  entity_type text,
  entity_id text,
  actor_user_id uuid,
  status text,
  read_at timestamptz,
  created_at timestamptz,
  payload jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_status text;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  perform public.ensure_user_notification_preferences_advanced(v_actor_id);
  v_status := upper(coalesce(p_status, 'ALL'));

  return query
  with filtered as (
    select
      n.*,
      count(*) over() as total_count
    from public.notifications n
    where n.recipient_user_id = v_actor_id
      and public.notification_channel_enabled_advanced(v_actor_id, 'APP', n.notification_type, n.payload)
      and (
        v_status = 'ALL'
        or upper(coalesce(n.status, '')) = v_status
      )
  )
  select
    f.id,
    f.notification_type,
    f.title,
    f.body,
    f.link_path,
    f.entity_type,
    f.entity_id,
    f.actor_user_id,
    f.status,
    f.read_at,
    f.created_at,
    f.payload,
    f.total_count
  from filtered f
  order by
    case when upper(coalesce(f.status, '')) = 'UNREAD' then 0 else 1 end,
    f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_notifications_secure(text, integer, integer) from public;
grant execute on function public.list_notifications_secure(text, integer, integer) to authenticated;

create or replace function public.mark_notification_read(
  p_notification_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_notification_id bigint;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  perform public.ensure_user_notification_preferences_advanced(v_actor_id);

  update public.notifications n
  set
    status = 'READ',
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where n.id = p_notification_id
    and n.recipient_user_id = v_actor_id
    and public.notification_channel_enabled_advanced(v_actor_id, 'APP', n.notification_type, n.payload)
  returning n.id into v_notification_id;

  if v_notification_id is null then
    raise exception 'Notification introuvable ou non autorisée';
  end if;

  return v_notification_id;
end;
$$;

revoke all on function public.mark_notification_read(bigint) from public;
grant execute on function public.mark_notification_read(bigint) to authenticated;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_count integer;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  perform public.ensure_user_notification_preferences_advanced(v_actor_id);

  update public.notifications n
  set
    status = 'READ',
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where n.recipient_user_id = v_actor_id
    and upper(coalesce(n.status, '')) = 'UNREAD'
    and public.notification_channel_enabled_advanced(v_actor_id, 'APP', n.notification_type, n.payload);

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;

create or replace function public.get_unread_notifications_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_count integer;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  perform public.ensure_user_notification_preferences_advanced(v_actor_id);

  select count(*)::integer
  into v_count
  from public.notifications n
  where n.recipient_user_id = v_actor_id
    and upper(coalesce(n.status, '')) = 'UNREAD'
    and public.notification_channel_enabled_advanced(v_actor_id, 'APP', n.notification_type, n.payload);

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_unread_notifications_count() from public;
grant execute on function public.get_unread_notifications_count() to authenticated;

create or replace function public.enqueue_email_notification_from_notification(
  p_notification_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification record;
  v_queue_id bigint;
  v_recipient_label text;
begin
  select
    n.*,
    ud.email as recipient_email,
    coalesce(
      nullif(ud.full_name, ''),
      nullif(split_part(coalesce(ud.email, ''), '@', 1), ''),
      'Utilisateur'
    ) as recipient_label
  into v_notification
  from public.notifications n
  left join public.user_directory ud on ud.id = n.recipient_user_id
  where n.id = p_notification_id;

  if not found then
    return null;
  end if;

  if not public.notification_supports_email(v_notification.notification_type) then
    return null;
  end if;

  if not public.notification_channel_enabled_advanced(
    v_notification.recipient_user_id,
    'EMAIL',
    v_notification.notification_type,
    v_notification.payload
  ) then
    return null;
  end if;

  if nullif(trim(coalesce(v_notification.recipient_email, '')), '') is null then
    return null;
  end if;

  v_recipient_label := coalesce(v_notification.recipient_label, 'Utilisateur');

  insert into public.email_notification_queue (
    notification_id,
    recipient_user_id,
    recipient_email,
    notification_type,
    subject,
    payload,
    status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
  )
  values (
    v_notification.id,
    v_notification.recipient_user_id,
    v_notification.recipient_email,
    upper(coalesce(v_notification.notification_type, '')),
    coalesce(nullif(trim(coalesce(v_notification.title, '')), ''), 'Notification Trio Asset'),
    jsonb_strip_nulls(
      jsonb_build_object(
        'title', v_notification.title,
        'body', v_notification.body,
        'link_path', v_notification.link_path,
        'entity_type', v_notification.entity_type,
        'entity_id', v_notification.entity_id,
        'recipient_label', v_recipient_label,
        'notification_payload', v_notification.payload
      )
    ),
    'PENDING',
    0,
    now(),
    now(),
    now()
  )
  on conflict (notification_id) do nothing
  returning id into v_queue_id;

  if v_queue_id is null then
    select q.id
    into v_queue_id
    from public.email_notification_queue q
    where q.notification_id = p_notification_id
    limit 1;
  end if;

  return v_queue_id;
end;
$$;

revoke all on function public.enqueue_email_notification_from_notification(bigint) from public;
grant execute on function public.enqueue_email_notification_from_notification(bigint) to authenticated;

update public.user_notification_preferences pref
set advanced_preferences =
  public.build_notification_advanced_preferences_defaults(upper(coalesce(p.role, ''))) || coalesce(pref.advanced_preferences, '{}'::jsonb)
from public.profiles p
where p.id = pref.user_id;

do $$
declare
  v_profile record;
begin
  for v_profile in
    select p.id
    from public.profiles p
  loop
    perform public.ensure_user_notification_preferences_advanced(v_profile.id);
  end loop;
end $$;
