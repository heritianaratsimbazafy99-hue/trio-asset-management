-- Hotfix: admin_upsert_profile ambiguous "id" safeguard
-- Date: 2026-03-08
-- Goal:
-- 1) recreate admin_upsert_profile with explicit aliases only
-- 2) harden RLS policy expressions with qualified table columns

-- ---------------------------------------------------------------------
-- 1) Profiles policies (qualified id references)
-- ---------------------------------------------------------------------
alter table if exists public.profiles enable row level security;

drop policy if exists profiles_select_own_or_ceo on public.profiles;
create policy profiles_select_own_or_ceo
on public.profiles
for select
using (auth.uid() = profiles.id or public.is_ceo());

drop policy if exists profiles_update_own_only on public.profiles;
create policy profiles_update_own_only
on public.profiles
for update
using (auth.uid() = profiles.id)
with check (auth.uid() = profiles.id);

-- ---------------------------------------------------------------------
-- 2) User directory policy (qualified id reference)
-- ---------------------------------------------------------------------
alter table if exists public.user_directory enable row level security;

drop policy if exists user_directory_select_own_or_ceo on public.user_directory;
drop policy if exists user_directory_select_own_or_leadership on public.user_directory;
create policy user_directory_select_own_or_leadership
on public.user_directory
for select
using (auth.uid() = user_directory.id or public.is_ceo() or public.is_daf());

-- ---------------------------------------------------------------------
-- 3) Recreate admin_upsert_profile
-- ---------------------------------------------------------------------
drop function if exists public.admin_upsert_profile(uuid, text, uuid);

create function public.admin_upsert_profile(
  p_user_id uuid,
  p_role text,
  p_company_id uuid
)
returns table (id uuid, role text, company_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.is_ceo() then
    raise exception 'forbidden: only CEO can manage profiles';
  end if;

  v_role := upper(trim(coalesce(p_role, '')));
  if v_role not in ('CEO', 'DAF', 'RESPONSABLE', 'RESPONSABLE_MAINTENANCE') then
    raise exception 'invalid role: %', p_role;
  end if;

  if p_company_id is null then
    raise exception 'company is required';
  end if;

  if not exists (
    select 1
    from auth.users as au
    where au.id = p_user_id
  ) then
    raise exception 'user not found in auth.users';
  end if;

  insert into public.profiles as p (id, role, company_id)
  values (p_user_id, v_role, p_company_id)
  on conflict (id) do update
    set role = excluded.role,
        company_id = excluded.company_id;

  return query
  select p.id, p.role, p.company_id
  from public.profiles as p
  where p.id = p_user_id
  limit 1;
end;
$$;

revoke all on function public.admin_upsert_profile(uuid, text, uuid) from public;
grant execute on function public.admin_upsert_profile(uuid, text, uuid) to authenticated;

-- Quick check:
-- select * from public.admin_upsert_profile('00000000-0000-0000-0000-000000000000', 'DAF', '11111111-1111-1111-1111-111111111111');
