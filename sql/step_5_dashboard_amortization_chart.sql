-- Step 5 - Dashboard amortization annual chart support
-- Date: 2026-03-05

create or replace function public.dashboard_summary(
  p_company_id uuid default null,
  p_category text default null,
  p_period text default '12M',
  p_risk_page integer default 1,
  p_risk_page_size integer default 12
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_period_start timestamptz;
  v_result jsonb;
  v_limit integer;
  v_page integer;
  v_offset integer;
  v_category text;
begin
  v_period_start := case upper(coalesce(p_period, '12M'))
    when '30D' then now() - interval '30 days'
    when '90D' then now() - interval '90 days'
    when 'YTD' then date_trunc('year', now())
    when '12M' then now() - interval '365 days'
    else null
  end;

  v_limit := greatest(1, least(coalesce(p_risk_page_size, 12), 50));
  v_page := greatest(1, coalesce(p_risk_page, 1));
  v_offset := (v_page - 1) * v_limit;
  v_category := nullif(btrim(coalesce(p_category, '')), '');

	  with filtered_assets as (
	    select
	      a.id,
	      a.name,
	      a.company_id,
	      a.category,
	      a.purchase_date,
	      coalesce(a.purchase_value, a.value, 0)::numeric as purchase_value_effective,
	      a.purchase_value as raw_purchase_value,
	      a.value as raw_value,
	      a.amortissement_type,
	      a.amortissement_duration,
	      o.name as company_name
    from public.assets a
    left join public.organisations o on o.id = a.company_id
    where
      (p_company_id is null or a.company_id = p_company_id)
      and (
        v_category is null
        or upper(v_category) = 'ALL'
        or coalesce(a.category, '') = v_category
      )
  ),
  incidents_period as (
    select i.*
    from public.incidents i
    join filtered_assets fa on fa.id = i.asset_id
    where v_period_start is null or i.created_at >= v_period_start
  ),
  maintenance_period as (
    select m.*
    from public.maintenance m
    join filtered_assets fa on fa.id = m.asset_id
    where v_period_start is null or m.created_at >= v_period_start
  ),
  maintenance_backlog as (
    select m.*
    from public.maintenance m
    join filtered_assets fa on fa.id = m.asset_id
    where
      coalesce(m.is_completed, false) = false
      and upper(coalesce(m.status, '')) <> 'TERMINEE'
  ),
  overdue_backlog as (
    select m.*
    from maintenance_backlog m
    where
      m.due_date is not null
      and now() > ((m.due_date::timestamp + interval '1 day') - interval '1 millisecond')
  ),
  inc_stats as (
    select
      i.asset_id,
      count(*) filter (where i.created_at >= now() - interval '30 days') as cnt_30d,
      count(*) filter (where i.created_at >= now() - interval '365 days') as cnt_12m
    from public.incidents i
    group by i.asset_id
  ),
  maint_stats as (
    select
      m.asset_id,
      sum(coalesce(m.cost, 0))::numeric as total_cost,
      count(*) filter (
        where
          coalesce(m.is_completed, false) = false
          and upper(coalesce(m.status, '')) <> 'TERMINEE'
          and m.due_date is not null
          and now() > ((m.due_date::timestamp + interval '1 day') - interval '1 millisecond')
      ) as overdue_count
    from public.maintenance m
    group by m.asset_id
  ),
	  asset_scores as (
	    select
	      fa.id,
	      fa.name,
	      coalesce(fa.company_name, 'Sans société') as company_name,
	      fa.purchase_value_effective,
	      coalesce(ins.cnt_30d, 0)::int as incident_count_30d,
	      coalesce(ins.cnt_12m, 0)::int as incident_count_12m,
	      coalesce(ms.total_cost, 0)::numeric as maintenance_cost,
	      coalesce(ms.overdue_count, 0)::int as overdue_maintenance_count,
	      case
	        when fa.purchase_value_effective > 0
	          then (coalesce(ms.total_cost, 0) / fa.purchase_value_effective) * 100
	        else 0
	      end::numeric as maintenance_ratio,
	      greatest(
	        0,
	        least(
	          100,
	          100
	          - least(60, case when fa.purchase_value_effective > 0 then (coalesce(ms.total_cost, 0) / fa.purchase_value_effective) * 100 else 0 end)
	          - least(35, coalesce(ins.cnt_12m, 0) * 7)
	          - least(20, coalesce(ms.overdue_count, 0) * 5)
	        )
	      )::numeric as score
    from filtered_assets fa
    left join inc_stats ins on ins.asset_id = fa.id
    left join maint_stats ms on ms.asset_id = fa.id
  ),
  top_risks as (
    select
      s.id,
      s.name,
      s.company_name,
      round(s.score, 1) as score,
      round(
        (100 - s.score)
        + (s.incident_count_30d * 8)
        + (s.overdue_maintenance_count * 15)
        + (case when s.maintenance_ratio > 40 then 20 else 0 end)
      )::int as risk_score_30d,
      s.incident_count_30d,
      s.overdue_maintenance_count,
      round(s.maintenance_ratio, 2) as maintenance_ratio,
      case
        when s.maintenance_ratio > 40 then 'Remplacement recommande'
        when s.incident_count_12m > 3 then 'Surveillance renforcee'
        else 'Actif rentable'
      end as recommendation
    from asset_scores s
    order by risk_score_30d desc, score asc, name asc
  ),
  top_risks_paged as (
    select *
    from top_risks
    offset v_offset
    limit v_limit
  ),
  company_assets as (
    select
      fa.company_id,
      coalesce(fa.company_name, 'Sans société') as name,
      count(*)::int as asset_count
    from filtered_assets fa
    group by fa.company_id, fa.company_name
  ),
  company_maintenance as (
    select
      fa.company_id,
      coalesce(sum(coalesce(mp.cost, 0)), 0)::numeric as maintenance_cost
    from filtered_assets fa
    left join maintenance_period mp on mp.asset_id = fa.id
    group by fa.company_id
  ),
  company_incidents as (
    select
      fa.company_id,
      count(*) filter (where upper(coalesce(ip.status, '')) <> 'RESOLU')::int as open_incidents
    from filtered_assets fa
    left join incidents_period ip on ip.asset_id = fa.id
    group by fa.company_id
  ),
  company_scores as (
    select
      fa.company_id,
      avg(s.score)::numeric as average_score
    from filtered_assets fa
    join asset_scores s on s.id = fa.id
    group by fa.company_id
  ),
  company_comparison as (
    select
      ca.company_id,
      ca.name,
      ca.asset_count,
      coalesce(cm.maintenance_cost, 0)::numeric as maintenance_cost,
      coalesce(ci.open_incidents, 0)::int as open_incidents,
      round(coalesce(cs.average_score, 0), 1) as average_score
    from company_assets ca
    left join company_maintenance cm on cm.company_id = ca.company_id
    left join company_incidents ci on ci.company_id = ca.company_id
    left join company_scores cs on cs.company_id = ca.company_id
    order by coalesce(cm.maintenance_cost, 0) desc, ca.name asc
  ),
  maintenance_monthly as (
    select
      to_char(date_trunc('month', mp.created_at), 'YYYY-MM') as month,
      coalesce(sum(coalesce(mp.cost, 0)), 0)::numeric as value
    from maintenance_period mp
    group by 1
    order by 1
  ),
  amortization_months as (
    select
      gs::date as month_start,
      (gs + interval '1 month - 1 day')::date as month_end,
      to_char(gs, 'YYYY-MM') as month,
      row_number() over (order by gs) as month_rank
    from generate_series(
      date_trunc('year', now())::date,
      (date_trunc('year', now()) + interval '11 months')::date,
      interval '1 month'
    ) gs
  ),
  amortizable_assets as (
    select
      fa.id,
      fa.purchase_date::date as amort_start,
      (
        fa.purchase_date
        + (coalesce(fa.amortissement_duration, 0)::text || ' years')::interval
        - interval '1 day'
      )::date as amort_end,
      (
        fa.purchase_value_effective / nullif(fa.amortissement_duration::numeric, 0)
      )::numeric as annual_amount,
      (
        fa.purchase_value_effective / nullif(fa.amortissement_duration::numeric, 0) / 12
      )::numeric as monthly_amount
    from filtered_assets fa
    where
      fa.purchase_date is not null
      and coalesce(fa.amortissement_duration, 0) > 0
      and fa.purchase_value_effective > 0
  ),
  amortization_monthly as (
    select
      m.month,
      m.month_rank,
      coalesce(sum(a.monthly_amount), 0)::numeric as amortized
    from amortization_months m
    left join amortizable_assets a
      on a.amort_start <= m.month_end
      and a.amort_end >= m.month_start
    group by m.month, m.month_rank
    order by m.month
  ),
  amortization_year as (
    select
      coalesce(
        sum(
          case
            when a.amort_end >= date_trunc('year', now())::date
             and a.amort_start <= (date_trunc('year', now()) + interval '1 year - 1 day')::date
            then a.annual_amount
            else 0
          end
        ),
        0
      )::numeric as annual_target
    from amortizable_assets a
  ),
  amortization_monthly_enriched as (
    select
      am.month,
      round(am.amortized, 2) as amortized,
      round(sum(am.amortized) over (order by am.month_rank), 2) as cumulative,
      round(((ay.annual_target / 12) * am.month_rank), 2) as target_cumulative
    from amortization_monthly am
    cross join amortization_year ay
    order by am.month
  ),
  amortization_kpis as (
    select
      round(
        coalesce(
          sum(am.amortized) filter (
            where am.month_rank <= extract(month from now())::int
          ),
          0
        ),
        2
      ) as amortized_ytd,
      round(coalesce((select annual_target from amortization_year), 0), 2) as annual_target
    from amortization_monthly am
  ),
  open_incident_actions as (
    select
      i.id,
      i.asset_id,
      coalesce(fa.name, '-') as asset_name,
      coalesce(i.title, i.description, 'Incident') as title,
      i.created_at
    from public.incidents i
    join filtered_assets fa on fa.id = i.asset_id
    where upper(coalesce(i.status, '')) <> 'RESOLU'
    order by i.created_at asc
    limit 5
  ),
  overdue_maintenance_actions as (
    select
      m.id,
      m.asset_id,
      coalesce(fa.name, '-') as asset_name,
      coalesce(m.title, m.description, 'Maintenance') as title,
      m.due_date,
      m.created_at
    from public.maintenance m
    join filtered_assets fa on fa.id = m.asset_id
    where
      coalesce(m.is_completed, false) = false
      and upper(coalesce(m.status, '')) <> 'TERMINEE'
      and m.due_date is not null
      and now() > ((m.due_date::timestamp + interval '1 day') - interval '1 millisecond')
    order by m.due_date asc
    limit 5
  )
  select jsonb_build_object(
	    'kpis', jsonb_build_object(
	      'assets_count', (select count(*) from filtered_assets),
	      'portfolio_value', coalesce((select sum(fa.purchase_value_effective) from filtered_assets fa), 0),
      'maintenance_cost_period', coalesce((select sum(coalesce(mp.cost, 0)) from maintenance_period mp), 0),
      'open_incidents', coalesce((select count(*) from incidents_period ip where upper(coalesce(ip.status, '')) <> 'RESOLU'), 0),
      'resolved_incidents', coalesce((select count(*) from incidents_period ip where upper(coalesce(ip.status, '')) = 'RESOLU'), 0),
      'active_maintenance_backlog', coalesce((select count(*) from maintenance_backlog), 0),
      'overdue_maintenance', coalesce((select count(*) from overdue_backlog), 0),
      'average_score', coalesce((select round(avg(score), 1) from asset_scores), 0),
      'sla_late_rate',
        case
          when (select count(*) from maintenance_backlog) = 0 then 0
          else round(
            ((select count(*) from overdue_backlog)::numeric / (select count(*) from maintenance_backlog)::numeric) * 100,
            1
          )
        end
    ),
    'quality', jsonb_build_object(
	      'missing_value', coalesce((
	        select count(*)
	        from filtered_assets fa
	        where fa.raw_purchase_value is null and fa.raw_value is null
	      ), 0),
      'missing_company', coalesce((
        select count(*) from filtered_assets fa where fa.company_id is null
      ), 0),
      'missing_amortization', coalesce((
        select count(*)
        from filtered_assets fa
        where coalesce(fa.amortissement_type, '') = '' or fa.amortissement_duration is null
      ), 0),
      'maintenance_missing_deadline', coalesce((
        select count(*) from maintenance_backlog mb where mb.due_date is null
      ), 0),
      'incidents_missing_title', coalesce((
        select count(*) from incidents_period ip where coalesce(ip.title, '') = ''
      ), 0)
    ),
    'top_risks_total', coalesce((select count(*) from top_risks), 0),
    'top_risks', coalesce((select jsonb_agg(to_jsonb(r) order by r.risk_score_30d desc, r.score asc, r.name asc) from top_risks_paged r), '[]'::jsonb),
    'company_comparison', coalesce((select jsonb_agg(to_jsonb(c)) from company_comparison c), '[]'::jsonb),
    'maintenance_monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month) from maintenance_monthly m), '[]'::jsonb),
    'amortization_monthly', coalesce((select jsonb_agg(to_jsonb(a) order by a.month) from amortization_monthly_enriched a), '[]'::jsonb),
    'amortization_kpis', (
      select jsonb_build_object(
        'amortized_ytd', coalesce(k.amortized_ytd, 0),
        'annual_target', coalesce(k.annual_target, 0),
        'remaining', greatest(coalesce(k.annual_target, 0) - coalesce(k.amortized_ytd, 0), 0),
        'coverage_rate',
          case
            when coalesce(k.annual_target, 0) <= 0 then 0
            else round((coalesce(k.amortized_ytd, 0) / k.annual_target) * 100, 1)
          end
      )
      from amortization_kpis k
    ),
    'actions_open_incidents', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at asc) from open_incident_actions i), '[]'::jsonb),
    'actions_overdue_maintenance', coalesce((select jsonb_agg(to_jsonb(m) order by m.due_date asc) from overdue_maintenance_actions m), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.dashboard_summary(uuid, text, text, integer, integer) from public;
grant execute on function public.dashboard_summary(uuid, text, text, integer, integer) to authenticated;

-- Quick check
-- select public.dashboard_summary(null, 'ALL', '12M', 1, 12);

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
