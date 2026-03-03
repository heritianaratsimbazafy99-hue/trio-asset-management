-- Group mode + roles setup
-- Date: 2026-02-22
-- This script switches access model from per-company visibility to group-wide visibility.

-- 1) Ensure 4 companies exist
insert into public.organisations (id, name)
values
  ('33333333-3333-3333-3333-333333333333', 'Mobix'),
  ('55555555-5555-5555-5555-555555555555', 'Roka'),
  ('11111111-1111-1111-1111-111111111111', 'Madajob'),
  ('22222222-2222-2222-2222-222222222222', 'Madatours')
on conflict (id) do update set name = excluded.name;

-- 2) Ensure your profile exists and is CEO
insert into public.profiles (id, company_id, role)
values ('9145f17b-7cf4-4d27-a0c0-36f4c94d6cb5', '33333333-3333-3333-3333-333333333333', 'CEO')
on conflict (id) do update
set role = 'CEO',
    company_id = excluded.company_id;

-- 3) Ensure assets has needed columns
alter table if exists public.assets
  add column if not exists company_id uuid references public.organisations(id);

-- 4) Enable RLS
alter table if exists public.assets enable row level security;
alter table if exists public.incidents enable row level security;
alter table if exists public.maintenance enable row level security;
alter table if exists public.asset_attachments enable row level security;
alter table if exists public.profiles enable row level security;

-- 5) Drop existing policies on target tables (unknown names safe)
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'assets', 'incidents', 'maintenance', 'asset_attachments')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 6) Group-wide access policies
create or replace function public.is_ceo()
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
      and upper(coalesce(p.role, '')) = 'CEO'
  );
$$;

revoke all on function public.is_ceo() from public;
grant execute on function public.is_ceo() to authenticated;

create or replace function public.is_maintenance_manager()
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
      and upper(coalesce(p.role, '')) = 'RESPONSABLE_MAINTENANCE'
  );
$$;

revoke all on function public.is_maintenance_manager() from public;
grant execute on function public.is_maintenance_manager() to authenticated;

-- PROFILES:
-- - everyone authenticated can read their own profile
-- - CEO can read/insert/update all profiles
create policy profiles_select_own_or_ceo
on public.profiles
for select
using (
  auth.uid() = id
  or public.is_ceo()
);

create policy profiles_insert_ceo_only
on public.profiles
for insert
with check (
  public.is_ceo()
);

create policy profiles_update_own_or_ceo
on public.profiles
for update
using (
  auth.uid() = id
  or public.is_ceo()
)
with check (
  auth.uid() = id
  or public.is_ceo()
);

-- ASSETS: everyone authenticated can read/insert/update, only CEO can delete
create policy assets_select_authenticated
on public.assets
for select
using (auth.role() = 'authenticated');

create policy assets_insert_authenticated
on public.assets
for insert
with check (auth.role() = 'authenticated');

create policy assets_update_authenticated
on public.assets
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy assets_delete_ceo_only
on public.assets
for delete
using (
  public.is_ceo()
);

-- INCIDENTS: everyone authenticated can read/insert,
-- only CEO or RESPONSABLE_MAINTENANCE can update (incl. closure)
create policy incidents_select_authenticated
on public.incidents
for select
using (auth.role() = 'authenticated');

create policy incidents_insert_authenticated
on public.incidents
for insert
with check (auth.role() = 'authenticated');

create policy incidents_update_authorized
on public.incidents
for update
using (
  public.is_ceo() or public.is_maintenance_manager()
)
with check (
  public.is_ceo() or public.is_maintenance_manager()
);

-- MAINTENANCE: everyone authenticated can read/insert,
-- only CEO or RESPONSABLE_MAINTENANCE can update (incl. closure)
create policy maintenance_select_authenticated
on public.maintenance
for select
using (auth.role() = 'authenticated');

create policy maintenance_insert_authenticated
on public.maintenance
for insert
with check (auth.role() = 'authenticated');

create policy maintenance_update_authorized
on public.maintenance
for update
using (
  public.is_ceo() or public.is_maintenance_manager()
)
with check (
  public.is_ceo() or public.is_maintenance_manager()
);

-- ATTACHMENTS metadata: authenticated users can read/insert/update/delete
create policy asset_attachments_select_authenticated
on public.asset_attachments
for select
using (auth.role() = 'authenticated');

create policy asset_attachments_insert_authenticated
on public.asset_attachments
for insert
with check (auth.role() = 'authenticated');

create policy asset_attachments_update_authenticated
on public.asset_attachments
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy asset_attachments_delete_authenticated
on public.asset_attachments
for delete
using (auth.role() = 'authenticated');

-- 7) Storage policies for bucket asset-documents (group-wide)
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'asset_docs_select_authenticated',
        'asset_docs_insert_authenticated',
        'asset_docs_update_authenticated',
        'asset_docs_delete_authenticated'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy asset_docs_select_authenticated
on storage.objects
for select
using (
  bucket_id = 'asset-documents'
  and auth.role() = 'authenticated'
);

create policy asset_docs_insert_authenticated
on storage.objects
for insert
with check (
  bucket_id = 'asset-documents'
  and auth.role() = 'authenticated'
);

create policy asset_docs_update_authenticated
on storage.objects
for update
using (
  bucket_id = 'asset-documents'
  and auth.role() = 'authenticated'
)
with check (
  bucket_id = 'asset-documents'
  and auth.role() = 'authenticated'
);

create policy asset_docs_delete_authenticated
on storage.objects
for delete
using (
  bucket_id = 'asset-documents'
  and auth.role() = 'authenticated'
);

-- 8) Quick checks
-- select * from public.organisations where id in (
--   '33333333-3333-3333-3333-333333333333',
--   '55555555-5555-5555-5555-555555555555',
--   '11111111-1111-1111-1111-111111111111',
--   '22222222-2222-2222-2222-222222222222'
-- );
-- select id, company_id, role from public.profiles where id = '9145f17b-7cf4-4d27-a0c0-36f4c94d6cb5';
