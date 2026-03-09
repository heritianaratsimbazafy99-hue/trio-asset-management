-- Hotfix 2026-03-04
-- 1) Fix search_assets_secure ORDER BY alias error
-- 2) Display user labels as full_name, else email local-part

drop function if exists public.search_assets_secure(uuid, text, integer, integer, text, text);
drop function if exists public.search_assets_secure(uuid, text, text, integer, integer, text, text);

create or replace function public.search_assets_secure(
  p_company_id uuid default null,
  p_search text default null,
  p_category text default null,
  p_condition text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort_by text default 'created_at',
  p_sort_direction text default 'desc'
)
returns table (
  id uuid,
  code text,
  name text,
  category text,
  current_condition text,
  purchase_date date,
  purchase_value numeric,
  value numeric,
  status text,
  company_id uuid,
  assigned_to_user_id uuid,
  assigned_to_name text,
  created_at timestamptz,
  organisation_name text,
  total_count bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pattern text;
  v_limit integer;
  v_offset integer;
  v_sort_sql text;
  v_dir_sql text;
begin
  v_pattern := nullif(btrim(coalesce(p_search, '')), '');
  if v_pattern is not null then
    v_pattern := '%' || v_pattern || '%';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));

  v_sort_sql := case lower(coalesce(p_sort_by, ''))
    when 'name' then 'name'
    when 'purchase_value' then 'coalesce(purchase_value, value, 0)'
    when 'created_at' then 'created_at'
    else 'created_at'
  end;

  v_dir_sql := case lower(coalesce(p_sort_direction, ''))
    when 'asc' then 'asc'
    else 'desc'
  end;

  return query execute format(
    $sql$
      with filtered as (
        select
          a.id,
          a.code,
          a.name,
          a.category,
          a.current_condition,
          a.purchase_date,
          a.purchase_value,
          a.value,
          a.status,
          a.company_id,
          a.assigned_to_user_id,
          a.assigned_to_name,
          a.created_at,
          o.name as organisation_name,
          count(*) over()::bigint as total_count
        from public.assets a
        left join public.organisations o on o.id = a.company_id
        where ($1::uuid is null or a.company_id = $1)
          and (
            $2::text is null
            or upper($2::text) = 'ALL'
            or coalesce(a.category, '') = $2
          )
          and (
            $3::text is null
            or upper($3::text) = 'ALL'
            or coalesce(a.current_condition, '') = $3
          )
          and (
            $4::text is null
            or a.name ilike $4
            or coalesce(a.code, '') ilike $4
            or coalesce(a.category, '') ilike $4
            or coalesce(a.current_condition, '') ilike $4
            or coalesce(a.assigned_to_name, '') ilike $4
            or exists (
              select 1
              from public.user_directory ud
              where ud.id = a.assigned_to_user_id
                and (
                  coalesce(ud.full_name, '') ilike $4
                  or coalesce(ud.email, '') ilike $4
                )
            )
          )
      )
      select *
      from filtered
      order by %s %s nulls last, id asc
      limit $5
      offset $6
    $sql$,
    v_sort_sql,
    v_dir_sql
  )
  using p_company_id, nullif(btrim(coalesce(p_category, '')), ''), nullif(btrim(coalesce(p_condition, '')), ''), v_pattern, v_limit, v_offset;
end;
$$;

revoke all on function public.search_assets_secure(uuid, text, text, text, integer, integer, text, text) from public;
grant execute on function public.search_assets_secure(uuid, text, text, text, integer, integer, text, text) to authenticated;

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

-- Quick checks:
-- select * from public.get_user_labels(null) limit 20;
-- select * from public.search_assets_secure(null, null, null, null, 20, 0, 'created_at', 'desc');
