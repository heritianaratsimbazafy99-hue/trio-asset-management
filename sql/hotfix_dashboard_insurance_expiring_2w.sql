-- Hotfix: Dashboard alert for vehicle insurance expiring in 14 days
-- Date: 2026-03-10

create or replace function public.dashboard_insurance_expiring_2w(
  p_company_id uuid default null,
  p_category text default null,
  p_limit integer default 8
)
returns table(
  asset_id uuid,
  asset_name text,
  company_id uuid,
  company_name text,
  category text,
  insurance_company text,
  policy_number text,
  insurance_end_date date,
  days_remaining integer
)
language sql
security invoker
set search_path = public
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_category, '')), '') as normalized_category
  ),
  candidate_assets as (
    select
      a.id as asset_id,
      coalesce(a.name, '-') as asset_name,
      a.company_id,
      coalesce(o.name, 'Sans société') as company_name,
      a.category,
      a.vehicle_details,
      case
        when coalesce(a.vehicle_details->>'insurance_end_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
          and to_char(
            to_date(a.vehicle_details->>'insurance_end_date', 'YYYY-MM-DD'),
            'YYYY-MM-DD'
          ) = a.vehicle_details->>'insurance_end_date'
        then to_date(a.vehicle_details->>'insurance_end_date', 'YYYY-MM-DD')
        else null
      end as insurance_end_date_safe
    from public.assets a
    left join public.organisations o on o.id = a.company_id
    cross join args
    where
      upper(coalesce(a.category, '')) in ('VEHICULE_MOTO', 'VEHICULE_VOITURE')
      and (p_company_id is null or a.company_id = p_company_id)
      and (
        args.normalized_category is null
        or upper(args.normalized_category) = 'ALL'
        or coalesce(a.category, '') = args.normalized_category
      )
  )
  select
    ca.asset_id,
    ca.asset_name,
    ca.company_id,
    ca.company_name,
    ca.category,
    nullif(ca.vehicle_details->>'insurance_company', '') as insurance_company,
    nullif(ca.vehicle_details->>'policy_number', '') as policy_number,
    ca.insurance_end_date_safe as insurance_end_date,
    greatest((ca.insurance_end_date_safe - current_date), 0)::int as days_remaining
  from candidate_assets ca
  cross join args
  where
    ca.insurance_end_date_safe is not null
    and ca.insurance_end_date_safe between current_date and (current_date + 14)
  order by ca.insurance_end_date_safe asc, ca.asset_name asc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

revoke all on function public.dashboard_insurance_expiring_2w(uuid, text, integer) from public;
grant execute on function public.dashboard_insurance_expiring_2w(uuid, text, integer) to authenticated;

-- Quick check:
-- select * from public.dashboard_insurance_expiring_2w(null, null, 10);
