-- Feature - Notification preferences for app and email channels
-- Date: 2026-03-11
--
-- Run after:
-- 1) sql/feature_app_notifications.sql
-- 2) sql/feature_email_notifications.sql

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  app_workflow_pending boolean not null,
  app_workflow_approved boolean not null,
  app_workflow_rejected boolean not null,
  app_workflow_failed boolean not null,
  app_incident_alert boolean not null,
  email_workflow_pending boolean not null,
  email_workflow_approved boolean not null,
  email_workflow_rejected boolean not null,
  email_workflow_failed boolean not null,
  email_incident_alert boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_notification_preferences_updated_at
on public.user_notification_preferences (updated_at desc);

alter table if exists public.user_notification_preferences enable row level security;

drop policy if exists user_notification_preferences_select_own on public.user_notification_preferences;
create policy user_notification_preferences_select_own
on public.user_notification_preferences
for select
using (user_id = public.audit_actor_id());

drop policy if exists user_notification_preferences_update_own on public.user_notification_preferences;
create policy user_notification_preferences_update_own
on public.user_notification_preferences
for update
using (user_id = public.audit_actor_id())
with check (user_id = public.audit_actor_id());

grant select, update on public.user_notification_preferences to authenticated;

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

create or replace function public.ensure_user_notification_preferences(
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

  select upper(coalesce(role, ''))
  into v_role
  from public.profiles
  where id = p_user_id;

  insert into public.user_notification_preferences (
    user_id,
    app_workflow_pending,
    app_workflow_approved,
    app_workflow_rejected,
    app_workflow_failed,
    app_incident_alert,
    email_workflow_pending,
    email_workflow_approved,
    email_workflow_rejected,
    email_workflow_failed,
    email_incident_alert,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    public.notification_preference_default(v_role, 'APP', 'WORKFLOW_PENDING'),
    public.notification_preference_default(v_role, 'APP', 'WORKFLOW_APPROVED'),
    public.notification_preference_default(v_role, 'APP', 'WORKFLOW_REJECTED'),
    public.notification_preference_default(v_role, 'APP', 'WORKFLOW_FAILED'),
    public.notification_preference_default(v_role, 'APP', 'INCIDENT_ALERT'),
    public.notification_preference_default(v_role, 'EMAIL', 'WORKFLOW_PENDING'),
    public.notification_preference_default(v_role, 'EMAIL', 'WORKFLOW_APPROVED'),
    public.notification_preference_default(v_role, 'EMAIL', 'WORKFLOW_REJECTED'),
    public.notification_preference_default(v_role, 'EMAIL', 'WORKFLOW_FAILED'),
    public.notification_preference_default(v_role, 'EMAIL', 'INCIDENT_ALERT'),
    now(),
    now()
  )
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.ensure_user_notification_preferences(uuid) from public;
grant execute on function public.ensure_user_notification_preferences(uuid) to authenticated;

create or replace function public.notification_channel_enabled(
  p_user_id uuid,
  p_channel text,
  p_notification_type text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
  v_default boolean;
  v_preferences public.user_notification_preferences%rowtype;
  v_channel text;
  v_type text;
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

  v_default := public.notification_preference_default(v_role, v_channel, v_type);

  select *
  into v_preferences
  from public.user_notification_preferences
  where user_id = p_user_id;

  if not found then
    return v_default;
  end if;

  if v_channel = 'APP' then
    return case v_type
      when 'WORKFLOW_PENDING' then coalesce(v_preferences.app_workflow_pending, v_default)
      when 'WORKFLOW_APPROVED' then coalesce(v_preferences.app_workflow_approved, v_default)
      when 'WORKFLOW_REJECTED' then coalesce(v_preferences.app_workflow_rejected, v_default)
      when 'WORKFLOW_FAILED' then coalesce(v_preferences.app_workflow_failed, v_default)
      when 'INCIDENT_ALERT' then coalesce(v_preferences.app_incident_alert, v_default)
      else v_default
    end;
  end if;

  if v_channel = 'EMAIL' then
    return case v_type
      when 'WORKFLOW_PENDING' then coalesce(v_preferences.email_workflow_pending, v_default)
      when 'WORKFLOW_APPROVED' then coalesce(v_preferences.email_workflow_approved, v_default)
      when 'WORKFLOW_REJECTED' then coalesce(v_preferences.email_workflow_rejected, v_default)
      when 'WORKFLOW_FAILED' then coalesce(v_preferences.email_workflow_failed, v_default)
      when 'INCIDENT_ALERT' then coalesce(v_preferences.email_incident_alert, v_default)
      else v_default
    end;
  end if;

  return false;
end;
$$;

revoke all on function public.notification_channel_enabled(uuid, text, text) from public;
grant execute on function public.notification_channel_enabled(uuid, text, text) to authenticated;

create or replace function public.get_my_notification_preferences()
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

  perform public.ensure_user_notification_preferences(v_actor_id);

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
    pref.created_at,
    pref.updated_at
  from public.user_notification_preferences pref
  join public.profiles p on p.id = pref.user_id
  where pref.user_id = v_actor_id;
end;
$$;

revoke all on function public.get_my_notification_preferences() from public;
grant execute on function public.get_my_notification_preferences() to authenticated;

create or replace function public.update_my_notification_preferences(
  p_app_workflow_pending boolean,
  p_app_workflow_approved boolean,
  p_app_workflow_rejected boolean,
  p_app_workflow_failed boolean,
  p_app_incident_alert boolean,
  p_email_workflow_pending boolean,
  p_email_workflow_approved boolean,
  p_email_workflow_rejected boolean,
  p_email_workflow_failed boolean,
  p_email_incident_alert boolean
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

  perform public.ensure_user_notification_preferences(v_actor_id);

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
    updated_at = now()
  where user_id = v_actor_id;

  return query
  select *
  from public.get_my_notification_preferences();
end;
$$;

revoke all on function public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

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
volatile
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

  perform public.ensure_user_notification_preferences(v_actor_id);
  v_status := upper(coalesce(p_status, 'ALL'));

  return query
  with filtered as (
    select
      n.*,
      count(*) over() as total_count
    from public.notifications n
    where n.recipient_user_id = v_actor_id
      and public.notification_channel_enabled(v_actor_id, 'APP', n.notification_type)
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

  perform public.ensure_user_notification_preferences(v_actor_id);

  update public.notifications n
  set
    status = 'READ',
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where n.id = p_notification_id
    and n.recipient_user_id = v_actor_id
    and public.notification_channel_enabled(v_actor_id, 'APP', n.notification_type)
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

  perform public.ensure_user_notification_preferences(v_actor_id);

  update public.notifications n
  set
    status = 'READ',
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where n.recipient_user_id = v_actor_id
    and upper(coalesce(n.status, '')) = 'UNREAD'
    and public.notification_channel_enabled(v_actor_id, 'APP', n.notification_type);

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

  perform public.ensure_user_notification_preferences(v_actor_id);

  select count(*)::integer
  into v_count
  from public.notifications n
  where n.recipient_user_id = v_actor_id
    and upper(coalesce(n.status, '')) = 'UNREAD'
    and public.notification_channel_enabled(v_actor_id, 'APP', n.notification_type);

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

  if not public.notification_channel_enabled(v_notification.recipient_user_id, 'EMAIL', v_notification.notification_type) then
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

do $$
declare
  v_profile record;
begin
  for v_profile in
    select p.id
    from public.profiles p
  loop
    perform public.ensure_user_notification_preferences(v_profile.id);
  end loop;
end $$;
