-- Free-text assignment support for assets
-- Date: 2026-03-03
-- Purpose:
-- 1) Allow "Attribue a" to be entered without selecting an existing user
-- 2) Enable search/filter by assigned person name

alter table if exists public.assets
  add column if not exists assigned_to_name text;

-- Backfill from user_directory when a technical user assignment already exists.
update public.assets a
set assigned_to_name = coalesce(nullif(ud.full_name, ''), nullif(ud.email, ''), a.assigned_to_name)
from public.user_directory ud
where a.assigned_to_user_id = ud.id
  and coalesce(a.assigned_to_name, '') = '';

create index if not exists idx_assets_assigned_to_name
on public.assets (assigned_to_name);

create extension if not exists pg_trgm;
create index if not exists idx_assets_assigned_to_name_trgm
on public.assets using gin (assigned_to_name gin_trgm_ops);

-- Quick checks
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='assets' and column_name='assigned_to_name';
-- select id, name, assigned_to_user_id, assigned_to_name from public.assets order by created_at desc limit 20;
