-- Feature - Notification governance for routing and templates
-- Date: 2026-03-11
--
-- Run after:
-- 1) sql/feature_notification_advanced_preferences.sql
-- 2) sql/feature_email_notifications.sql

create table if not exists public.notification_template_configs (
  id bigserial primary key,
  notification_type text not null,
  request_type text not null default 'ANY',
  template_name text not null,
  email_subject_template text,
  title_template text not null,
  body_template text not null,
  cta_label text,
  is_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_type, request_type)
);

create table if not exists public.notification_routing_rules (
  id bigserial primary key,
  notification_type text not null,
  request_type text not null default 'ANY',
  channel text not null,
  role text not null,
  is_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_type, request_type, channel, role)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_template_configs_type_check'
      and conrelid = 'public.notification_template_configs'::regclass
  ) then
    alter table public.notification_template_configs
      add constraint notification_template_configs_type_check
      check (upper(coalesce(notification_type, '')) in (
        'WORKFLOW_PENDING',
        'WORKFLOW_APPROVED',
        'WORKFLOW_REJECTED',
        'WORKFLOW_FAILED',
        'INCIDENT_ALERT'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_template_configs_request_type_check'
      and conrelid = 'public.notification_template_configs'::regclass
  ) then
    alter table public.notification_template_configs
      add constraint notification_template_configs_request_type_check
      check (upper(coalesce(request_type, '')) in (
        'ANY',
        'ASSET_DELETE',
        'ASSET_PURCHASE_VALUE_CHANGE',
        'MAINTENANCE_START',
        'ASSET_REBUS'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_routing_rules_type_check'
      and conrelid = 'public.notification_routing_rules'::regclass
  ) then
    alter table public.notification_routing_rules
      add constraint notification_routing_rules_type_check
      check (upper(coalesce(notification_type, '')) in (
        'WORKFLOW_PENDING',
        'INCIDENT_ALERT'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_routing_rules_request_type_check'
      and conrelid = 'public.notification_routing_rules'::regclass
  ) then
    alter table public.notification_routing_rules
      add constraint notification_routing_rules_request_type_check
      check (upper(coalesce(request_type, '')) in (
        'ANY',
        'ASSET_DELETE',
        'ASSET_PURCHASE_VALUE_CHANGE',
        'MAINTENANCE_START',
        'ASSET_REBUS'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_routing_rules_channel_check'
      and conrelid = 'public.notification_routing_rules'::regclass
  ) then
    alter table public.notification_routing_rules
      add constraint notification_routing_rules_channel_check
      check (upper(coalesce(channel, '')) in ('APP', 'EMAIL'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_routing_rules_role_check'
      and conrelid = 'public.notification_routing_rules'::regclass
  ) then
    alter table public.notification_routing_rules
      add constraint notification_routing_rules_role_check
      check (upper(coalesce(role, '')) in (
        'CEO',
        'DAF',
        'RESPONSABLE',
        'RESPONSABLE_MAINTENANCE'
      ));
  end if;
end $$;

create index if not exists idx_notification_template_configs_type_request
on public.notification_template_configs (notification_type, request_type, is_enabled);

create index if not exists idx_notification_routing_rules_type_request_channel
on public.notification_routing_rules (notification_type, request_type, channel, role);

alter table if exists public.notification_template_configs enable row level security;
alter table if exists public.notification_routing_rules enable row level security;

drop policy if exists notification_template_configs_select_leadership on public.notification_template_configs;
create policy notification_template_configs_select_leadership
on public.notification_template_configs
for select
using (public.is_ceo() or public.is_daf());

drop policy if exists notification_template_configs_insert_leadership on public.notification_template_configs;
create policy notification_template_configs_insert_leadership
on public.notification_template_configs
for insert
with check (public.is_ceo() or public.is_daf());

drop policy if exists notification_template_configs_update_leadership on public.notification_template_configs;
create policy notification_template_configs_update_leadership
on public.notification_template_configs
for update
using (public.is_ceo() or public.is_daf())
with check (public.is_ceo() or public.is_daf());

drop policy if exists notification_template_configs_delete_leadership on public.notification_template_configs;
create policy notification_template_configs_delete_leadership
on public.notification_template_configs
for delete
using (public.is_ceo() or public.is_daf());

drop policy if exists notification_routing_rules_select_leadership on public.notification_routing_rules;
create policy notification_routing_rules_select_leadership
on public.notification_routing_rules
for select
using (public.is_ceo() or public.is_daf());

drop policy if exists notification_routing_rules_insert_leadership on public.notification_routing_rules;
create policy notification_routing_rules_insert_leadership
on public.notification_routing_rules
for insert
with check (public.is_ceo() or public.is_daf());

drop policy if exists notification_routing_rules_update_leadership on public.notification_routing_rules;
create policy notification_routing_rules_update_leadership
on public.notification_routing_rules
for update
using (public.is_ceo() or public.is_daf())
with check (public.is_ceo() or public.is_daf());

drop policy if exists notification_routing_rules_delete_leadership on public.notification_routing_rules;
create policy notification_routing_rules_delete_leadership
on public.notification_routing_rules
for delete
using (public.is_ceo() or public.is_daf());

grant select, insert, update, delete on public.notification_template_configs to authenticated;
grant select, insert, update, delete on public.notification_routing_rules to authenticated;
grant usage, select on sequence public.notification_template_configs_id_seq to authenticated;
grant usage, select on sequence public.notification_routing_rules_id_seq to authenticated;

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

drop trigger if exists trg_audit_notification_template_configs on public.notification_template_configs;
create trigger trg_audit_notification_template_configs
after insert or update or delete on public.notification_template_configs
for each row
execute function public.audit_notification_governance_change();

drop trigger if exists trg_audit_notification_routing_rules on public.notification_routing_rules;
create trigger trg_audit_notification_routing_rules
after insert or update or delete on public.notification_routing_rules
for each row
execute function public.audit_notification_governance_change();

insert into public.notification_template_configs (
  notification_type,
  request_type,
  template_name,
  email_subject_template,
  title_template,
  body_template,
  cta_label,
  is_enabled
)
values
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'Validation suppression d''actif', 'Validation requise - suppression d''actif {{asset_name}}', 'Validation requise - suppression d''actif', 'Une demande de suppression d''actif attend votre décision pour {{asset_name}}. Motif: {{reason}}', 'Traiter la demande', true),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'Validation valeur d''achat', 'Validation requise - valeur d''achat {{asset_name}}', 'Validation requise - valeur d''achat', 'Une demande de changement de valeur d''achat attend votre décision pour {{asset_name}}. Motif: {{reason}}', 'Traiter la demande', true),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'Validation ticket maintenance', 'Validation requise - ticket maintenance {{asset_name}}', 'Validation requise - ticket maintenance', 'Un ticket maintenance attend votre décision pour {{asset_name}}. Objet: {{title}}', 'Valider le ticket', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'Validation passage en rebus', 'Validation requise - passage en rebus {{asset_name}}', 'Validation requise - passage en rebus', 'Une demande de passage en rebus attend votre décision pour {{asset_name}}. Motif: {{reason}}', 'Traiter la demande', true),
  ('WORKFLOW_APPROVED', 'ANY', 'Demande approuvée', 'Demande approuvée - {{request_type_label}}', 'Demande approuvée - {{request_type_label}}', 'Votre demande de {{request_type_label}} a été approuvée pour {{asset_name}}.', 'Ouvrir la demande', true),
  ('WORKFLOW_REJECTED', 'ANY', 'Demande rejetée', 'Demande rejetée - {{request_type_label}}', 'Demande rejetée - {{request_type_label}}', 'Votre demande de {{request_type_label}} a été rejetée pour {{asset_name}}. Note: {{resolution_note}}', 'Ouvrir la demande', true),
  ('WORKFLOW_FAILED', 'ANY', 'Demande en échec', 'Demande en échec - {{request_type_label}}', 'Demande en échec - {{request_type_label}}', 'Votre demande de {{request_type_label}} a rencontré un problème technique pour {{asset_name}}. Détail: {{resolution_note}}', 'Ouvrir la demande', true),
  ('INCIDENT_ALERT', 'ANY', 'Alerte incident', 'Alerte incident - {{asset_name}}', 'Alerte incident - {{asset_name}}', 'Un incident a été déclaré sur {{asset_name}}. Objet: {{incident_title}} | Statut: {{incident_status}}', 'Ouvrir l''actif', true)
on conflict (notification_type, request_type) do nothing;

insert into public.notification_routing_rules (
  notification_type,
  request_type,
  channel,
  role,
  is_enabled
)
values
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'APP', 'CEO', true),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'APP', 'DAF', false),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'APP', 'RESPONSABLE', false),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'APP', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'EMAIL', 'CEO', true),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'EMAIL', 'DAF', false),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'EMAIL', 'RESPONSABLE', false),
  ('WORKFLOW_PENDING', 'ASSET_DELETE', 'EMAIL', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'APP', 'CEO', true),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'APP', 'DAF', false),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'APP', 'RESPONSABLE', false),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'APP', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'EMAIL', 'CEO', true),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'EMAIL', 'DAF', false),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'EMAIL', 'RESPONSABLE', false),
  ('WORKFLOW_PENDING', 'ASSET_PURCHASE_VALUE_CHANGE', 'EMAIL', 'RESPONSABLE_MAINTENANCE', false),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'APP', 'CEO', true),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'APP', 'DAF', true),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'APP', 'RESPONSABLE', false),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'APP', 'RESPONSABLE_MAINTENANCE', true),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'EMAIL', 'CEO', true),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'EMAIL', 'DAF', true),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'EMAIL', 'RESPONSABLE', false),
  ('WORKFLOW_PENDING', 'MAINTENANCE_START', 'EMAIL', 'RESPONSABLE_MAINTENANCE', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'APP', 'CEO', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'APP', 'DAF', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'APP', 'RESPONSABLE', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'APP', 'RESPONSABLE_MAINTENANCE', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'EMAIL', 'CEO', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'EMAIL', 'DAF', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'EMAIL', 'RESPONSABLE', true),
  ('WORKFLOW_PENDING', 'ASSET_REBUS', 'EMAIL', 'RESPONSABLE_MAINTENANCE', true),
  ('INCIDENT_ALERT', 'ANY', 'APP', 'CEO', true),
  ('INCIDENT_ALERT', 'ANY', 'APP', 'DAF', true),
  ('INCIDENT_ALERT', 'ANY', 'APP', 'RESPONSABLE', true),
  ('INCIDENT_ALERT', 'ANY', 'APP', 'RESPONSABLE_MAINTENANCE', true),
  ('INCIDENT_ALERT', 'ANY', 'EMAIL', 'CEO', true),
  ('INCIDENT_ALERT', 'ANY', 'EMAIL', 'DAF', true),
  ('INCIDENT_ALERT', 'ANY', 'EMAIL', 'RESPONSABLE', true),
  ('INCIDENT_ALERT', 'ANY', 'EMAIL', 'RESPONSABLE_MAINTENANCE', true)
on conflict (notification_type, request_type, channel, role) do nothing;

create or replace function public.notification_request_type_from_payload(
  p_payload jsonb default '{}'::jsonb
)
returns text
language sql
immutable
as $$
  select upper(
    coalesce(
      coalesce(p_payload, '{}'::jsonb) ->> 'request_type',
      coalesce(p_payload, '{}'::jsonb) -> 'notification_payload' ->> 'request_type',
      'ANY'
    )
  )
$$;

revoke all on function public.notification_request_type_from_payload(jsonb) from public;
grant execute on function public.notification_request_type_from_payload(jsonb) to authenticated;

create or replace function public.render_notification_template_text(
  p_template text,
  p_context jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
as $$
declare
  v_rendered text := coalesce(p_template, '');
  v_item record;
begin
  for v_item in
    select key, value
    from jsonb_each_text(coalesce(p_context, '{}'::jsonb))
  loop
    v_rendered := replace(v_rendered, '{{' || v_item.key || '}}', coalesce(v_item.value, ''));
  end loop;

  return trim(v_rendered);
end;
$$;

revoke all on function public.render_notification_template_text(text, jsonb) from public;
grant execute on function public.render_notification_template_text(text, jsonb) to authenticated;

create or replace function public.resolve_notification_template_values(
  p_notification_type text,
  p_payload jsonb default '{}'::jsonb,
  p_fallback_subject text default null,
  p_fallback_title text default null,
  p_fallback_body text default null,
  p_fallback_cta_label text default null
)
returns table (
  email_subject text,
  title text,
  body text,
  cta_label text,
  template_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text;
  v_request_type text;
  v_request_type_label text;
  v_payload jsonb;
  v_template public.notification_template_configs%rowtype;
  v_context jsonb;
begin
  v_type := upper(coalesce(p_notification_type, ''));
  v_payload := coalesce(p_payload, '{}'::jsonb);
  v_request_type := public.notification_request_type_from_payload(v_payload);
  if v_request_type = '' then
    v_request_type := 'ANY';
  end if;

  select *
  into v_template
  from public.notification_template_configs t
  where upper(coalesce(t.notification_type, '')) = v_type
    and upper(coalesce(t.request_type, 'ANY')) in (v_request_type, 'ANY')
    and coalesce(t.is_enabled, true)
  order by case when upper(coalesce(t.request_type, 'ANY')) = v_request_type then 0 else 1 end
  limit 1;

  v_request_type_label := case
    when v_request_type = 'ANY' then 'demande'
    else public.notification_workflow_type_label(v_request_type)
  end;

  v_context := jsonb_build_object(
    'asset_name', coalesce(v_payload ->> 'asset_name', v_payload -> 'notification_payload' ->> 'asset_name', ''),
    'asset_code', coalesce(v_payload ->> 'asset_code', v_payload -> 'notification_payload' ->> 'asset_code', ''),
    'company_name', coalesce(v_payload ->> 'company_name', v_payload -> 'notification_payload' ->> 'company_name', ''),
    'request_type_label', coalesce(v_request_type_label, ''),
    'reason', coalesce(v_payload ->> 'reason', v_payload -> 'notification_payload' ->> 'reason', ''),
    'resolution_note', coalesce(v_payload ->> 'resolution_note', v_payload -> 'notification_payload' ->> 'resolution_note', ''),
    'title', coalesce(v_payload ->> 'title', v_payload -> 'notification_payload' ->> 'title', ''),
    'incident_title', coalesce(v_payload ->> 'incident_title', v_payload -> 'notification_payload' ->> 'incident_title', ''),
    'incident_status', coalesce(v_payload ->> 'incident_status', v_payload -> 'notification_payload' ->> 'incident_status', '')
  );

  return query
  select
    coalesce(
      nullif(public.render_notification_template_text(v_template.email_subject_template, v_context), ''),
      nullif(trim(coalesce(p_fallback_subject, '')), ''),
      nullif(trim(coalesce(p_fallback_title, '')), ''),
      'Notification Trio Asset'
    ),
    coalesce(
      nullif(public.render_notification_template_text(v_template.title_template, v_context), ''),
      nullif(trim(coalesce(p_fallback_title, '')), ''),
      'Notification Trio Asset'
    ),
    coalesce(
      nullif(public.render_notification_template_text(v_template.body_template, v_context), ''),
      nullif(trim(coalesce(p_fallback_body, '')), ''),
      'Une notification necessitant votre attention a ete enregistree dans Trio Asset.'
    ),
    coalesce(
      nullif(public.render_notification_template_text(v_template.cta_label, v_context), ''),
      nullif(trim(coalesce(p_fallback_cta_label, '')), ''),
      'Ouvrir'
    ),
    coalesce(v_template.template_name, '');
end;
$$;

revoke all on function public.resolve_notification_template_values(text, jsonb, text, text, text, text) from public;
grant execute on function public.resolve_notification_template_values(text, jsonb, text, text, text, text) to authenticated;

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
      then v_role in ('CEO', 'DAF', 'RESPONSABLE_MAINTENANCE')
    when v_type = 'WORKFLOW_PENDING' and v_request_type = 'ASSET_REBUS'
      then v_role in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE')
    when v_type = 'INCIDENT_ALERT'
      then v_role in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE')
    else true
  end;
end;
$$;

revoke all on function public.notification_role_routed(text, text, text, text) from public;
grant execute on function public.notification_role_routed(text, text, text, text) to authenticated;

create or replace function public.notification_delivery_enabled(
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
  v_request_type text;
begin
  if p_user_id is null then
    return false;
  end if;

  if not public.notification_channel_enabled_advanced(
    p_user_id,
    p_channel,
    p_notification_type,
    coalesce(p_payload, '{}'::jsonb)
  ) then
    return false;
  end if;

  select upper(coalesce(role, ''))
  into v_role
  from public.profiles
  where id = p_user_id;

  v_request_type := public.notification_request_type_from_payload(coalesce(p_payload, '{}'::jsonb));
  if v_request_type = '' then
    v_request_type := 'ANY';
  end if;

  return public.notification_role_routed(
    p_channel,
    p_notification_type,
    v_request_type,
    v_role
  );
end;
$$;

revoke all on function public.notification_delivery_enabled(uuid, text, text, jsonb) from public;
grant execute on function public.notification_delivery_enabled(uuid, text, text, jsonb) to authenticated;

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
      'title', v_request.title
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
  where upper(coalesce(p.role, '')) = any(coalesce(v_request.approver_roles, array[]::text[]))
    and p.id is distinct from v_request.requested_by
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
  v_payload jsonb;
  v_rendered record;
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
      'resolution_note', v_request.resolution_note,
      'title', v_request.title
    )
  );

  select *
  into v_rendered
  from public.resolve_notification_template_values(
    v_notification_type,
    v_payload,
    v_title,
    v_title,
    v_body,
    'Ouvrir la demande'
  );

  v_payload := v_payload || jsonb_strip_nulls(
    jsonb_build_object(
      'email_subject', v_rendered.email_subject,
      'cta_label', v_rendered.cta_label,
      'template_name', v_rendered.template_name
    )
  );

  if not (
    public.notification_delivery_enabled(v_request.requested_by, 'APP', v_notification_type, v_payload)
    or public.notification_delivery_enabled(v_request.requested_by, 'EMAIL', v_notification_type, v_payload)
  ) then
    return;
  end if;

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
    v_rendered.title,
    v_rendered.body,
    v_link_path,
    'workflow_requests',
    v_request.id::text,
    v_payload,
    v_request.resolved_by
  );
end;
$$;

revoke all on function public.notify_workflow_request_resolution(uuid) from public;
grant execute on function public.notify_workflow_request_resolution(uuid) to authenticated;

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
  v_payload jsonb;
  v_rendered record;
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

  v_payload := jsonb_strip_nulls(
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
  );

  select *
  into v_rendered
  from public.resolve_notification_template_values(
    'INCIDENT_ALERT',
    v_payload,
    v_title,
    v_title,
    v_body,
    'Ouvrir l''actif'
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
    v_incident.reported_by,
    'INCIDENT_ALERT',
    v_rendered.title,
    v_rendered.body,
    v_link_path,
    'incidents',
    v_incident.id::text,
    v_payload,
    'UNREAD',
    now(),
    now()
  from public.profiles p
  where p.id is distinct from v_incident.reported_by
    and (
      public.notification_delivery_enabled(p.id, 'APP', 'INCIDENT_ALERT', v_payload)
      or public.notification_delivery_enabled(p.id, 'EMAIL', 'INCIDENT_ALERT', v_payload)
    )
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
      and public.notification_delivery_enabled(v_actor_id, 'APP', n.notification_type, n.payload)
      and (
        v_status = 'ALL'
        or upper(coalesce(n.status, '')) = v_status
      )
  )
  select
    filtered.id,
    filtered.notification_type,
    filtered.title,
    filtered.body,
    filtered.link_path,
    filtered.entity_type,
    filtered.entity_id,
    filtered.actor_user_id,
    filtered.status,
    filtered.read_at,
    filtered.created_at,
    filtered.payload,
    filtered.total_count
  from filtered
  order by
    case when upper(coalesce(filtered.status, '')) = 'UNREAD' then 0 else 1 end,
    filtered.created_at desc
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
    and public.notification_delivery_enabled(v_actor_id, 'APP', n.notification_type, n.payload)
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
    and public.notification_delivery_enabled(v_actor_id, 'APP', n.notification_type, n.payload);

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
    and public.notification_delivery_enabled(v_actor_id, 'APP', n.notification_type, n.payload);

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

  if not public.notification_delivery_enabled(
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
    coalesce(
      nullif(trim(coalesce(v_notification.payload ->> 'email_subject', '')), ''),
      nullif(trim(coalesce(v_notification.title, '')), ''),
      'Notification Trio Asset'
    ),
    jsonb_strip_nulls(
      jsonb_build_object(
        'title', v_notification.title,
        'body', v_notification.body,
        'link_path', v_notification.link_path,
        'entity_type', v_notification.entity_type,
        'entity_id', v_notification.entity_id,
        'recipient_label', v_recipient_label,
        'cta_label', nullif(trim(coalesce(v_notification.payload ->> 'cta_label', '')), ''),
        'email_subject', nullif(trim(coalesce(v_notification.payload ->> 'email_subject', '')), ''),
        'template_name', nullif(trim(coalesce(v_notification.payload ->> 'template_name', '')), ''),
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
