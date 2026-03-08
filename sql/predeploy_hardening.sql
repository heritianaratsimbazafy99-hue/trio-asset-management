-- Pre-deploy hardening: access control + audit scaling
-- Date: 2026-02-24
-- Run after:
-- 1) group_mode_roles_setup.sql
-- 2) security_admin_audit_upgrade.sql
-- 3) feature_audit_assignment_history.sql

-- =====================================================================
-- 1) Leadership helper
-- =====================================================================
create or replace function public.is_daf()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) = 'DAF'
  );
$$;

revoke all on function public.is_daf() from public;
grant execute on function public.is_daf() to authenticated;

-- =====================================================================
-- 2) Restrict audit log read access to leadership
-- =====================================================================
alter table if exists public.audit_logs enable row level security;

drop policy if exists audit_logs_select_authenticated on public.audit_logs;
drop policy if exists audit_logs_select_leadership on public.audit_logs;
create policy audit_logs_select_leadership
on public.audit_logs
for select
using (public.is_ceo() or public.is_daf());

-- =====================================================================
-- 3) Restrict raw user_directory reads + expose safe labels through RPC
-- =====================================================================
alter table if exists public.user_directory enable row level security;

drop policy if exists user_directory_select_authenticated on public.user_directory;
drop policy if exists user_directory_select_own_or_ceo on public.user_directory;
drop policy if exists user_directory_select_own_or_leadership on public.user_directory;
create policy user_directory_select_own_or_leadership
on public.user_directory
for select
using (auth.uid() = user_directory.id or public.is_ceo() or public.is_daf());

create or replace function public.get_user_labels(p_ids uuid[] default null)
returns table (id uuid, label text)
language sql
stable
security definer
set search_path = public
as $$
  select
    ud.id,
    coalesce(
      nullif(ud.full_name, ''),
      nullif(split_part(coalesce(ud.email, ''), '@', 1), ''),
      'Utilisateur ' || left(ud.id::text, 8)
    ) as label
  from public.user_directory ud
  where p_ids is null or ud.id = any(p_ids)
  order by label asc;
$$;

revoke all on function public.get_user_labels(uuid[]) from public;
grant execute on function public.get_user_labels(uuid[]) to authenticated;

-- =====================================================================
-- 4) Audit logs indexing for payload contains/filtering
-- =====================================================================
create index if not exists idx_audit_logs_payload_gin
on public.audit_logs using gin (payload);

-- =====================================================================
-- 5) Quick checks
-- =====================================================================
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='audit_logs' order by policyname;
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='user_directory' order by policyname;
-- select public.is_ceo() as is_ceo, public.is_daf() as is_daf;
