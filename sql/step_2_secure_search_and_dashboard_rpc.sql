-- Step 2 - Secure search + scalable dashboard RPC
-- Date: 2026-03-04

create extension if not exists pg_trgm;

-- =====================================================================
-- 1) Search RPC for assets (replaces dynamic .or(...) client strings)
-- =====================================================================
create or replace function public.search_assets_secure(
  p_company_id uuid default null,
  p_search text default null,
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
    when 'name' then 'a.name'
    when 'purchase_value' then 'coalesce(a.purchase_value, a.value, 0)'
    when 'created_at' then 'a.created_at'
    else 'a.created_at'
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
            or a.name ilike $2
            or coalesce(a.code, '') ilike $2
            or coalesce(a.assigned_to_name, '') ilike $2
            or exists (
              select 1
              from public.user_directory ud
              where ud.id = a.assigned_to_user_id
                and (
                  coalesce(ud.full_name, '') ilike $2
                  or coalesce(ud.email, '') ilike $2
                )
            )
          )
      )
      select *
      from filtered
      order by %s %s nulls last, id asc
      limit $3
      offset $4
    $sql$,
    v_sort_sql,
    v_dir_sql
  )
  using p_company_id, v_pattern, v_limit, v_offset;
end;
$$;

revoke all on function public.search_assets_secure(uuid, text, integer, integer, text, text) from public;
grant execute on function public.search_assets_secure(uuid, text, integer, integer, text, text) to authenticated;

-- =====================================================================
-- 2) Search RPC for audit logs (server-side search + pagination)
-- =====================================================================
create or replace function public.search_audit_logs_secure(
  p_action text default 'ALL',
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  actor_user_id uuid,
  action text,
  entity_type text,
  entity_id text,
  payload jsonb,
  created_at timestamptz,
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
  v_action text;
begin
  v_pattern := nullif(btrim(coalesce(p_search, '')), '');
  if v_pattern is not null then
    v_pattern := '%' || v_pattern || '%';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_action := upper(coalesce(p_action, 'ALL'));

  return query
  with filtered as (
    select
      l.id,
      l.actor_user_id,
      l.action,
      l.entity_type,
      l.entity_id,
      l.payload,
      l.created_at,
      count(*) over()::bigint as total_count
    from public.audit_logs l
    where
      (v_action = 'ALL' or upper(l.action) = v_action)
      and (
        v_pattern is null
        or l.action ilike v_pattern
        or l.entity_type ilike v_pattern
        or l.entity_id ilike v_pattern
        or coalesce(l.payload::text, '') ilike v_pattern
        or exists (
          select 1
          from public.user_directory ud
          where ud.id = l.actor_user_id
            and (
              coalesce(ud.full_name, '') ilike v_pattern
              or coalesce(ud.email, '') ilike v_pattern
            )
        )
      )
  )
  select *
  from filtered
  order by created_at desc, id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.search_audit_logs_secure(text, text, integer, integer) from public;
grant execute on function public.search_audit_logs_secure(text, text, integer, integer) to authenticated;

-- =====================================================================
-- 3) Category helper (for dashboard filters)
-- =====================================================================
create or replace function public.list_asset_categories(
  p_company_id uuid default null
)
returns table (category text)
language sql
security invoker
set search_path = public
as $$
  select distinct a.category
  from public.assets a
  where
    coalesce(a.category, '') <> ''
    and (p_company_id is null or a.company_id = p_company_id)
  order by a.category;
$$;

revoke all on function public.list_asset_categories(uuid) from public;
grant execute on function public.list_asset_categories(uuid) to authenticated;

-- =====================================================================
-- 4) Dashboard aggregation RPC (no full-table client load)
-- =====================================================================
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
    'actions_open_incidents', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at asc) from open_incident_actions i), '[]'::jsonb),
    'actions_overdue_maintenance', coalesce((select jsonb_agg(to_jsonb(m) order by m.due_date asc) from overdue_maintenance_actions m), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.dashboard_summary(uuid, text, text, integer, integer) from public;
grant execute on function public.dashboard_summary(uuid, text, text, integer, integer) to authenticated;

-- =====================================================================
-- 5) Indexes supporting the new RPC workloads
-- =====================================================================
create index if not exists idx_incidents_asset_created_at on public.incidents (asset_id, created_at desc);
create index if not exists idx_incidents_status on public.incidents (status);
create index if not exists idx_maintenance_asset_created_at on public.maintenance (asset_id, created_at desc);
create index if not exists idx_maintenance_due_status on public.maintenance (due_date, status, is_completed);

-- =====================================================================
-- 6) Quick checks
-- =====================================================================
-- select * from public.search_assets_secure(null, 'serveur', 20, 0, 'created_at', 'desc');
-- select * from public.search_audit_logs_secure('ALL', 'incident', 20, 0);
-- select * from public.list_asset_categories(null);
-- select public.dashboard_summary(null, 'ALL', '12M', 1, 12);
