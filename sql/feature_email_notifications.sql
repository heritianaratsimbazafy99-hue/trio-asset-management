-- Feature - Transactional email notifications + incident alerts
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/feature_app_notifications.sql
-- 2) sql/feature_audit_assignment_history.sql
-- 3) sql/step_1_security_integrity_hardening.sql

create table if not exists public.email_notification_queue (
  id bigserial primary key,
  notification_id bigint unique references public.notifications(id) on delete set null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  notification_type text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  provider_response jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_notification_queue_status_check'
      and conrelid = 'public.email_notification_queue'::regclass
  ) then
    alter table public.email_notification_queue
      add constraint email_notification_queue_status_check
      check (upper(coalesce(status, '')) in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_notification_queue_attempt_count_check'
      and conrelid = 'public.email_notification_queue'::regclass
  ) then
    alter table public.email_notification_queue
      add constraint email_notification_queue_attempt_count_check
      check (attempt_count between 0 and 20);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_notification_queue_payload_object_check'
      and conrelid = 'public.email_notification_queue'::regclass
  ) then
    alter table public.email_notification_queue
      add constraint email_notification_queue_payload_object_check
      check (jsonb_typeof(payload) = 'object');
  end if;
end $$;

create index if not exists idx_email_notification_queue_status_next_attempt
on public.email_notification_queue (status, next_attempt_at asc, created_at asc);

create index if not exists idx_email_notification_queue_recipient_created_at
on public.email_notification_queue (recipient_user_id, created_at desc);

alter table if exists public.email_notification_queue enable row level security;

drop policy if exists email_notification_queue_select_leadership on public.email_notification_queue;
create policy email_notification_queue_select_leadership
on public.email_notification_queue
for select
using (public.is_ceo() or public.is_daf());

grant select on public.email_notification_queue to authenticated;
grant usage, select on sequence public.email_notification_queue_id_seq to authenticated;

create or replace function public.notification_supports_email(p_notification_type text)
returns boolean
language sql
immutable
as $$
  select upper(coalesce(p_notification_type, '')) in (
    'WORKFLOW_PENDING',
    'WORKFLOW_APPROVED',
    'WORKFLOW_REJECTED',
    'WORKFLOW_FAILED',
    'INCIDENT_ALERT'
  )
$$;

revoke all on function public.notification_supports_email(text) from public;
grant execute on function public.notification_supports_email(text) to authenticated;

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

create or replace function public.trg_enqueue_email_notification_from_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_email_notification_from_notification(new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_email_notification_from_notification on public.notifications;
create trigger trg_enqueue_email_notification_from_notification
after insert on public.notifications
for each row
execute function public.trg_enqueue_email_notification_from_notification();

create or replace function public.notify_incident_alert(
  p_incident_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident record;
  v_title text;
  v_body text;
  v_link_path text;
begin
  select
    i.id,
    i.asset_id,
    i.title,
    i.description,
    i.status,
    i.reported_by,
    a.name as asset_name,
    a.code as asset_code,
    a.company_id,
    o.name as company_name
  into v_incident
  from public.incidents i
  left join public.assets a on a.id = i.asset_id
  left join public.organisations o on o.id = a.company_id
  where i.id = p_incident_id;

  if not found then
    return;
  end if;

  v_title := format(
    'Alerte incident: %s',
    coalesce(nullif(trim(coalesce(v_incident.asset_name, '')), ''), 'Actif')
  );

  v_body := concat_ws(
    ' | ',
    coalesce(nullif(trim(coalesce(v_incident.title, '')), ''), 'Incident sans titre'),
    coalesce(nullif(trim(coalesce(v_incident.company_name, '')), ''), 'Sans société'),
    nullif(trim(coalesce(v_incident.asset_code, '')), '')
  );

  v_link_path := case
    when v_incident.asset_id is not null then '/assets/' || v_incident.asset_id::text
    else '/incidents'
  end;

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
    v_incident.reported_by,
    'INCIDENT_ALERT',
    v_title,
    v_body,
    v_link_path,
    'incidents',
    v_incident.id::text,
    jsonb_strip_nulls(
      jsonb_build_object(
        'incident_id', v_incident.id,
        'asset_id', v_incident.asset_id,
        'asset_name', v_incident.asset_name,
        'asset_code', v_incident.asset_code,
        'company_id', v_incident.company_id,
        'company_name', v_incident.company_name,
        'incident_title', v_incident.title,
        'incident_description', v_incident.description,
        'incident_status', v_incident.status
      )
    ),
    'UNREAD',
    now(),
    now()
  from public.profiles p
  where upper(coalesce(p.role, '')) in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE')
    and p.id is distinct from v_incident.reported_by
    and not exists (
      select 1
      from public.notifications n
      where n.recipient_user_id = p.id
        and upper(coalesce(n.notification_type, '')) = 'INCIDENT_ALERT'
        and n.payload ->> 'incident_id' = v_incident.id::text
    );
end;
$$;

revoke all on function public.notify_incident_alert(uuid) from public;
grant execute on function public.notify_incident_alert(uuid) to authenticated;

create or replace function public.trg_notify_incident_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_incident_alert(new.id);
  return new;
end;
$$;

drop trigger if exists trg_notify_incident_insert on public.incidents;
create trigger trg_notify_incident_insert
after insert on public.incidents
for each row
execute function public.trg_notify_incident_insert();

create or replace function public.claim_email_notification_batch(
  p_limit integer default 20
)
returns table (
  id bigint,
  recipient_user_id uuid,
  recipient_email text,
  notification_type text,
  subject text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));

  if auth.role() = 'authenticated' then
    raise exception 'forbidden: email dispatch batch is service-only';
  end if;

  return query
  with picked as (
    select q.id
    from public.email_notification_queue q
    where (
      upper(coalesce(q.status, '')) in ('PENDING', 'FAILED')
      or (
        upper(coalesce(q.status, '')) = 'PROCESSING'
        and coalesce(q.claimed_at, q.updated_at, q.created_at) < now() - interval '30 minutes'
      )
    )
      and coalesce(q.attempt_count, 0) < 5
      and coalesce(q.next_attempt_at, now()) <= now()
    order by q.created_at asc
    for update skip locked
    limit v_limit
  ),
  updated as (
    update public.email_notification_queue q
    set
      status = 'PROCESSING',
      claimed_at = now(),
      last_attempt_at = now(),
      attempt_count = coalesce(q.attempt_count, 0) + 1,
      updated_at = now()
    where q.id in (select picked.id from picked)
    returning
      q.id,
      q.recipient_user_id,
      q.recipient_email,
      q.notification_type,
      q.subject,
      q.payload,
      q.attempt_count
  )
  select *
  from updated;
end;
$$;

revoke all on function public.claim_email_notification_batch(integer) from public;
grant execute on function public.claim_email_notification_batch(integer) to authenticated;

create or replace function public.backfill_email_notification_queue(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification record;
  v_count integer := 0;
  v_limit integer;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 100), 1000));

  if auth.role() = 'authenticated' and not (public.is_ceo() or public.is_daf()) then
    raise exception 'forbidden: only CEO or DAF can backfill email queue';
  end if;

  for v_notification in
    select n.id
    from public.notifications n
    where public.notification_supports_email(n.notification_type)
      and not exists (
        select 1
        from public.email_notification_queue q
        where q.notification_id = n.id
      )
    order by n.created_at desc
    limit v_limit
  loop
    if public.enqueue_email_notification_from_notification(v_notification.id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.backfill_email_notification_queue(integer) from public;
grant execute on function public.backfill_email_notification_queue(integer) to authenticated;
