-- Hotfix - Asset code auto-generation (SOC-CAT-YY-####)
-- Date: 2026-03-09
--
-- Behavior:
-- - If assets.code is provided, it is kept (uppercased/trimmed).
-- - If assets.code is empty, a code is generated automatically:
--   <company_prefix>-<category_prefix>-<yy>-<increment>
--   Example: MAD-LOG-26-0001

create or replace function public.asset_category_short_code(p_category text)
returns text
language sql
immutable
as $$
  select case upper(coalesce(btrim(p_category), ''))
    when 'IT_ORDINATEURS' then 'ORD'
    when 'IT_ECRANS_ACCESSOIRES' then 'ECR'
    when 'IT_IMPRESSION' then 'IMP'
    when 'IT_SERVEURS_RESEAU' then 'SRV'
    when 'IT_LOGICIELS' then 'LOG'
    when 'TELEPHONIE_MOBILE' then 'TEL'
    when 'MOBILIER_BUREAU' then 'MBL'
    when 'SECURITE_SURVEILLANCE' then 'SEC'
    when 'VEHICULE_MOTO' then 'MOT'
    when 'VEHICULE_VOITURE' then 'VOI'
    when 'VEHICULE_UTILITAIRE' then 'UTI'
    when 'OUTILLAGE_TECHNIQUE' then 'OUT'
    when 'AUTRE' then 'AUT'
    else left(coalesce(nullif(regexp_replace(upper(coalesce(p_category, '')), '[^A-Z0-9]', '', 'g'), ''), 'GEN'), 3)
  end;
$$;

create or replace function public.set_asset_code_if_missing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_name text;
  v_company_code text;
  v_category_code text;
  v_year text;
  v_prefix text;
  v_next integer;
begin
  if nullif(btrim(coalesce(new.code, '')), '') is not null then
    new.code := upper(btrim(new.code));
    return new;
  end if;

  if new.company_id is null then
    raise exception 'asset code generation failed: company_id is required';
  end if;

  select o.name
  into v_company_name
  from public.organisations o
  where o.id = new.company_id;

  v_company_code := upper(coalesce(v_company_name, ''));
  v_company_code := regexp_replace(v_company_code, '[^A-Z0-9]', '', 'g');
  v_company_code := left(v_company_code || 'ORG', 3);

  v_category_code := public.asset_category_short_code(new.category);
  v_year := to_char(coalesce(new.purchase_date, current_date), 'YY');
  v_prefix := v_company_code || '-' || v_category_code || '-' || v_year;

  -- Lock by prefix to avoid duplicate suffix on concurrent inserts.
  perform pg_advisory_xact_lock(hashtext('asset-code:' || v_prefix));

  select coalesce(max(right(a.code, 4)::integer), 0) + 1
  into v_next
  from public.assets a
  where a.code like (v_prefix || '-____')
    and right(a.code, 4) ~ '^[0-9]{4}$';

  new.code := v_prefix || '-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_set_asset_code_if_missing on public.assets;
create trigger trg_set_asset_code_if_missing
before insert on public.assets
for each row
execute function public.set_asset_code_if_missing();

revoke all on function public.asset_category_short_code(text) from public;
grant execute on function public.asset_category_short_code(text) to authenticated;
grant execute on function public.asset_category_short_code(text) to service_role;

revoke all on function public.set_asset_code_if_missing() from public;
grant execute on function public.set_asset_code_if_missing() to authenticated;
grant execute on function public.set_asset_code_if_missing() to service_role;

-- Quick checks:
-- insert into public.assets (name, category, company_id, purchase_date, purchase_value, value, status)
-- values ('Laptop test', 'IT_ORDINATEURS', '<company_uuid>', current_date, 1000000, 1000000, 'EN_SERVICE')
-- returning id, code, name;
