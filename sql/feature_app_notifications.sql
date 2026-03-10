-- Feature - In-app notifications for workflows
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/security_admin_audit_upgrade.sql
-- 2) sql/feature_audit_assignment_history.sql
-- 3) sql/feature_lot3_workflow_roles_and_asset_history.sql
-- 4) sql/feature_data_health_actions.sql

create table if not exists public.notifications (
  id bigserial primary key,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null default '',
  link_path text,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'UNREAD',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_status_check'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_status_check
      check (upper(coalesce(status, '')) in ('UNREAD', 'READ', 'ARCHIVED'));
  end if;
end $$;

create index if not exists idx_notifications_recipient_status_created_at
on public.notifications (recipient_user_id, status, created_at desc);

create index if not exists idx_notifications_recipient_created_at
on public.notifications (recipient_user_id, created_at desc);

alter table if exists public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select
using (recipient_user_id = public.audit_actor_id());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications
for update
using (recipient_user_id = public.audit_actor_id())
with check (recipient_user_id = public.audit_actor_id());

grant select, update on public.notifications to authenticated;
grant usage, select on sequence public.notifications_id_seq to authenticated;

create or replace function public.notification_workflow_type_label(p_request_type text)
returns text
language sql
immutable
as $$
  select case upper(coalesce(p_request_type, ''))
    when 'ASSET_DELETE' then 'suppression d''actif'
    when 'ASSET_PURCHASE_VALUE_CHANGE' then 'changement de valeur d''achat'
    when 'MAINTENANCE_START' then 'validation de maintenance'
    when 'ASSET_REBUS' then 'passage en rebus'
    else 'demande'
  end
$$;

revoke all on function public.notification_workflow_type_label(text) from public;
grant execute on function public.notification_workflow_type_label(text) to authenticated;

create or replace function public.create_app_notification(
  p_recipient_user_id uuid,
  p_notification_type text,
  p_title text,
  p_body text default '',
  p_link_path text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id bigint;
begin
  if p_recipient_user_id is null then
    return null;
  end if;

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
  values (
    p_recipient_user_id,
    coalesce(p_actor_user_id, public.audit_actor_id()),
    upper(coalesce(p_notification_type, '')),
    coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Notification'),
    coalesce(p_body, ''),
    nullif(trim(coalesce(p_link_path, '')), ''),
    nullif(trim(coalesce(p_entity_type, '')), ''),
    nullif(trim(coalesce(p_entity_id, '')), ''),
    coalesce(p_payload, '{}'::jsonb),
    'UNREAD',
    now(),
    now()
  )
  returning id into v_notification_id;

  return v_notification_id;
end;
$$;

revoke all on function public.create_app_notification(uuid, text, text, text, text, text, text, jsonb, uuid) from public;
grant execute on function public.create_app_notification(uuid, text, text, text, text, text, text, jsonb, uuid) to authenticated;

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

  v_type_label := public.notification_workflow_type_label(v_request.request_type);
  v_title := format('Validation requise: %s', initcap(v_type_label));
  v_body := coalesce(
    nullif(trim(coalesce(v_request.title, '')), ''),
    nullif(trim(coalesce(v_request.reason, '')), ''),
    coalesce(v_request.asset_name_snapshot, 'Nouvelle demande')
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
    v_title,
    v_body,
    '/approvals',
    'workflow_requests',
    v_request.id::text,
    jsonb_strip_nulls(
      jsonb_build_object(
        'workflow_request_id', v_request.id,
        'request_type', v_request.request_type,
        'request_status', v_request.status,
        'asset_id', v_request.asset_id,
        'asset_name', v_request.asset_name_snapshot,
        'company_id', v_request.company_id,
        'company_name', v_request.company_name_snapshot,
        'reason', v_request.reason,
        'title', v_request.title
      )
    ),
    'UNREAD',
    now(),
    now()
  from public.profiles p
  where upper(coalesce(p.role, '')) = any(coalesce(v_request.approver_roles, array[]::text[]))
    and p.id is distinct from v_request.requested_by
    and not exists (
      select 1
      from public.notifications n
      where n.recipient_user_id = p.id
        and n.notification_type = 'WORKFLOW_PENDING'
        and n.payload ->> 'workflow_request_id' = v_request.id::text
    );
end;
$$;

revoke all on function public.notify_workflow_request_pending(uuid) from public;
grant execute on function public.notify_workflow_request_pending(uuid) to authenticated;

create or replace function public.notify_workflow_request_resolution(
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
  v_notification_type text;
  v_title text;
  v_body text;
  v_link_path text;
begin
  select *
  into v_request
  from public.workflow_requests
  where id = p_request_id;

  if not found then
    return;
  end if;

  if v_request.requested_by is null then
    return;
  end if;

  v_type_label := public.notification_workflow_type_label(v_request.request_type);

  case upper(coalesce(v_request.status, ''))
    when 'APPROVED' then
      v_notification_type := 'WORKFLOW_APPROVED';
      v_title := format('Demande approuvée: %s', initcap(v_type_label));
    when 'REJECTED' then
      v_notification_type := 'WORKFLOW_REJECTED';
      v_title := format('Demande rejetée: %s', initcap(v_type_label));
    when 'FAILED' then
      v_notification_type := 'WORKFLOW_FAILED';
      v_title := format('Demande en échec: %s', initcap(v_type_label));
    else
      return;
  end case;

  v_body := coalesce(
    nullif(trim(coalesce(v_request.resolution_note, '')), ''),
    nullif(trim(coalesce(v_request.title, '')), ''),
    nullif(trim(coalesce(v_request.reason, '')), ''),
    'Votre demande a été mise à jour.'
  );

  v_link_path := case
    when v_request.asset_id is not null then '/assets/' || v_request.asset_id::text
    else '/approvals'
  end;

  if exists (
    select 1
    from public.notifications n
    where n.recipient_user_id = v_request.requested_by
      and n.notification_type = v_notification_type
      and n.payload ->> 'workflow_request_id' = v_request.id::text
  ) then
    return;
  end if;

  perform public.create_app_notification(
    v_request.requested_by,
    v_notification_type,
    v_title,
    v_body,
    v_link_path,
    'workflow_requests',
    v_request.id::text,
    jsonb_strip_nulls(
      jsonb_build_object(
        'workflow_request_id', v_request.id,
        'request_type', v_request.request_type,
        'request_status', v_request.status,
        'asset_id', v_request.asset_id,
        'asset_name', v_request.asset_name_snapshot,
        'resolution_note', v_request.resolution_note
      )
    ),
    v_request.resolved_by
  );
end;
$$;

revoke all on function public.notify_workflow_request_resolution(uuid) from public;
grant execute on function public.notify_workflow_request_resolution(uuid) to authenticated;

create or replace function public.trg_notify_workflow_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if upper(coalesce(new.status, '')) = 'PENDING' then
    perform public.notify_workflow_request_pending(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.trg_notify_workflow_request_status_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if upper(coalesce(old.status, '')) is distinct from upper(coalesce(new.status, ''))
     and upper(coalesce(new.status, '')) in ('APPROVED', 'REJECTED', 'FAILED') then
    perform public.notify_workflow_request_resolution(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_workflow_request_insert on public.workflow_requests;
create trigger trg_notify_workflow_request_insert
after insert on public.workflow_requests
for each row
execute function public.trg_notify_workflow_request_insert();

drop trigger if exists trg_notify_workflow_request_status_update on public.workflow_requests;
create trigger trg_notify_workflow_request_status_update
after update of status on public.workflow_requests
for each row
execute function public.trg_notify_workflow_request_status_update();

do $$
declare
  v_request record;
begin
  for v_request in
    select id
    from public.workflow_requests
    where upper(coalesce(status, '')) = 'PENDING'
  loop
    perform public.notify_workflow_request_pending(v_request.id);
  end loop;
end $$;

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

  v_status := upper(coalesce(p_status, 'ALL'));

  return query
  with filtered as (
    select
      n.*,
      count(*) over() as total_count
    from public.notifications n
    where n.recipient_user_id = v_actor_id
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

  update public.notifications
  set
    status = 'READ',
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where id = p_notification_id
    and recipient_user_id = v_actor_id
  returning id into v_notification_id;

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

  update public.notifications
  set
    status = 'READ',
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where recipient_user_id = v_actor_id
    and upper(coalesce(status, '')) = 'UNREAD';

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

  select count(*)::integer
  into v_count
  from public.notifications n
  where n.recipient_user_id = v_actor_id
    and upper(coalesce(n.status, '')) = 'UNREAD';

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_unread_notifications_count() from public;
grant execute on function public.get_unread_notifications_count() to authenticated;
