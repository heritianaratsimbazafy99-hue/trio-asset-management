-- Step 4 - Display user labels (full_name else email local-part)
-- Date: 2026-03-04

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

-- Quick check
-- select * from public.get_user_labels(null) limit 20;
