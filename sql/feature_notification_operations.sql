-- Feature - Email notification operations supervision
-- Date: 2026-03-11
--
-- Run after:
-- 1) sql/feature_email_notifications.sql
-- 2) sql/feature_notification_preferences.sql

create or replace function public.assert_notification_operations_access()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.audit_actor_id() is null then
    raise exception 'forbidden: authentication required';
  end if;

  if not (public.is_ceo() or public.is_daf()) then
    raise exception 'forbidden: notification operations reserved to CEO or DAF';
  end if;
end;
$$;

revoke all on function public.assert_notification_operations_access() from public;
grant execute on function public.assert_notification_operations_access() to authenticated;

create or replace function public.get_email_notification_metrics_secure()
returns table (
  pending_count bigint,
  processing_count bigint,
  sent_count bigint,
  failed_count bigint,
  canceled_count bigint,
  sent_last_24h bigint,
  failed_last_24h bigint,
  retryable_failed_count bigint,
  oldest_pending_at timestamptz,
  queue_last_7d bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_notification_operations_access();

  return query
  select
    count(*) filter (where upper(coalesce(q.status, '')) = 'PENDING')::bigint as pending_count,
    count(*) filter (where upper(coalesce(q.status, '')) = 'PROCESSING')::bigint as processing_count,
    count(*) filter (where upper(coalesce(q.status, '')) = 'SENT')::bigint as sent_count,
    count(*) filter (where upper(coalesce(q.status, '')) = 'FAILED')::bigint as failed_count,
    count(*) filter (where upper(coalesce(q.status, '')) = 'CANCELED')::bigint as canceled_count,
    count(*) filter (
      where upper(coalesce(q.status, '')) = 'SENT'
        and coalesce(q.sent_at, q.updated_at, q.created_at) >= now() - interval '24 hours'
    )::bigint as sent_last_24h,
    count(*) filter (
      where upper(coalesce(q.status, '')) = 'FAILED'
        and coalesce(q.updated_at, q.created_at) >= now() - interval '24 hours'
    )::bigint as failed_last_24h,
    count(*) filter (
      where upper(coalesce(q.status, '')) = 'FAILED'
        and coalesce(q.attempt_count, 0) < 5
    )::bigint as retryable_failed_count,
    min(q.created_at) filter (where upper(coalesce(q.status, '')) = 'PENDING') as oldest_pending_at,
    count(*) filter (where q.created_at >= now() - interval '7 days')::bigint as queue_last_7d
  from public.email_notification_queue q;
end;
$$;

revoke all on function public.get_email_notification_metrics_secure() from public;
grant execute on function public.get_email_notification_metrics_secure() to authenticated;

create or replace function public.list_email_notification_queue_secure(
  p_status text default 'ALL',
  p_notification_type text default 'ALL',
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  notification_id bigint,
  recipient_user_id uuid,
  recipient_email text,
  recipient_label text,
  notification_type text,
  subject text,
  status text,
  attempt_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  provider_message_id text,
  link_path text,
  payload jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_type text;
  v_search text;
begin
  perform public.assert_notification_operations_access();

  v_status := upper(coalesce(p_status, 'ALL'));
  v_type := upper(coalesce(p_notification_type, 'ALL'));
  v_search := nullif(trim(coalesce(p_search, '')), '');

  return query
  with filtered as (
    select
      q.id as queue_id,
      q.notification_id,
      q.recipient_user_id,
      q.recipient_email,
      coalesce(
        nullif(ud.full_name, ''),
        nullif(split_part(coalesce(q.recipient_email, ''), '@', 1), ''),
        'Utilisateur'
      ) as recipient_label,
      q.notification_type,
      q.subject,
      q.status,
      q.attempt_count,
      q.created_at,
      q.updated_at,
      q.next_attempt_at,
      q.last_attempt_at,
      q.sent_at,
      q.last_error,
      q.provider_message_id,
      nullif(trim(coalesce(q.payload ->> 'link_path', '')), '') as link_path,
      q.payload,
      count(*) over() as total_count
    from public.email_notification_queue q
    left join public.user_directory ud on ud.id = q.recipient_user_id
    where
      (v_status = 'ALL' or upper(coalesce(q.status, '')) = v_status)
      and (v_type = 'ALL' or upper(coalesce(q.notification_type, '')) = v_type)
      and (
        v_search is null
        or q.recipient_email ilike '%' || v_search || '%'
        or coalesce(ud.full_name, '') ilike '%' || v_search || '%'
        or coalesce(q.subject, '') ilike '%' || v_search || '%'
        or coalesce(q.last_error, '') ilike '%' || v_search || '%'
      )
  )
  select
    f.queue_id,
    f.notification_id,
    f.recipient_user_id,
    f.recipient_email,
    f.recipient_label,
    f.notification_type,
    f.subject,
    f.status,
    f.attempt_count,
    f.created_at,
    f.updated_at,
    f.next_attempt_at,
    f.last_attempt_at,
    f.sent_at,
    f.last_error,
    f.provider_message_id,
    f.link_path,
    f.payload,
    f.total_count
  from filtered f
  order by
    case upper(coalesce(f.status, ''))
      when 'FAILED' then 0
      when 'PENDING' then 1
      when 'PROCESSING' then 2
      when 'CANCELED' then 3
      when 'SENT' then 4
      else 9
    end,
    f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_email_notification_queue_secure(text, text, text, integer, integer) from public;
grant execute on function public.list_email_notification_queue_secure(text, text, text, integer, integer) to authenticated;

create or replace function public.requeue_email_notification(
  p_queue_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id bigint;
begin
  perform public.assert_notification_operations_access();

  update public.email_notification_queue q
  set
    status = 'PENDING',
    claimed_at = null,
    last_error = null,
    next_attempt_at = now(),
    updated_at = now()
  where q.id = p_queue_id
    and upper(coalesce(q.status, '')) in ('FAILED', 'CANCELED')
  returning q.id into v_queue_id;

  if v_queue_id is null then
    raise exception 'Email introuvable ou non replanifiable';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    payload
  )
  values (
    public.audit_actor_id(),
    'EMAIL_NOTIFICATION_REQUEUED',
    'email_notification_queue',
    v_queue_id::text,
    jsonb_build_object('queue_id', v_queue_id)
  );

  return v_queue_id;
end;
$$;

revoke all on function public.requeue_email_notification(bigint) from public;
grant execute on function public.requeue_email_notification(bigint) to authenticated;

create or replace function public.requeue_failed_email_notifications(
  p_limit integer default 50
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer := 0;
begin
  perform public.assert_notification_operations_access();
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  update public.email_notification_queue q
  set
    status = 'PENDING',
    claimed_at = null,
    last_error = null,
    next_attempt_at = now(),
    updated_at = now()
  where q.id in (
    select selected.id
    from public.email_notification_queue selected
    where upper(coalesce(selected.status, '')) = 'FAILED'
      and coalesce(selected.attempt_count, 0) < 5
    order by selected.updated_at desc, selected.created_at desc
    limit v_limit
  );

  get diagnostics v_count = row_count;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    payload
  )
  values (
    public.audit_actor_id(),
    'EMAIL_NOTIFICATION_REQUEUED_BATCH',
    'email_notification_queue',
    null,
    jsonb_build_object(
      'count', coalesce(v_count, 0),
      'limit', v_limit
    )
  );

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.requeue_failed_email_notifications(integer) from public;
grant execute on function public.requeue_failed_email_notifications(integer) to authenticated;

create or replace function public.cancel_email_notification(
  p_queue_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id bigint;
begin
  perform public.assert_notification_operations_access();

  update public.email_notification_queue q
  set
    status = 'CANCELED',
    claimed_at = null,
    updated_at = now()
  where q.id = p_queue_id
    and upper(coalesce(q.status, '')) in ('PENDING', 'FAILED')
  returning q.id into v_queue_id;

  if v_queue_id is null then
    raise exception 'Email introuvable ou non annulable';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    payload
  )
  values (
    public.audit_actor_id(),
    'EMAIL_NOTIFICATION_CANCELED',
    'email_notification_queue',
    v_queue_id::text,
    jsonb_build_object('queue_id', v_queue_id)
  );

  return v_queue_id;
end;
$$;

revoke all on function public.cancel_email_notification(bigint) from public;
grant execute on function public.cancel_email_notification(bigint) to authenticated;
