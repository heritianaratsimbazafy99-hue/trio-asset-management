-- Hotfix - Asset purchase value update rights + audit logging
-- Date: 2026-03-09
--
-- 1) Allow RESPONSABLE role to update accounting fields on assets.
-- 2) Audit every purchase value update in public.audit_logs.

create or replace function public.guard_asset_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_role text;
  v_status_changed boolean;
  v_accounting_changed boolean;
begin
  v_status_changed := coalesce(old.status, '') is distinct from coalesce(new.status, '');

  v_accounting_changed :=
    old.company_id is distinct from new.company_id
    or old.purchase_value is distinct from new.purchase_value
    or old.value is distinct from new.value
    or coalesce(old.amortissement_type, '') is distinct from coalesce(new.amortissement_type, '')
    or old.amortissement_duration is distinct from new.amortissement_duration
    or coalesce(old.amortissement_method, '') is distinct from coalesce(new.amortissement_method, '')
    or old.amortissement_rate is distinct from new.amortissement_rate
    or old.amortissement_degressive_rate is distinct from new.amortissement_degressive_rate
    or old.amortissement_degressive_coefficient is distinct from new.amortissement_degressive_coefficient;

  if not v_status_changed and not v_accounting_changed then
    return new;
  end if;

  -- Allow migrations / SQL editor / service flows without an authenticated JWT.
  v_claim_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  if v_claim_role <> 'authenticated' then
    return new;
  end if;

  if v_accounting_changed then
    if public.is_ceo() or public.is_daf() or public.is_responsable() then
      return new;
    end if;

    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can update company/value/amortization fields';
  end if;

  if v_status_changed then
    if public.is_ceo() or public.is_daf() or public.is_responsable() or public.is_maintenance_manager() then
      return new;
    end if;

    raise exception 'forbidden: only leadership roles can update asset status';
  end if;

  return new;
end;
$$;

create or replace function public.audit_log_asset_purchase_value_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_effective numeric;
  v_new_effective numeric;
begin
  v_old_effective := coalesce(old.purchase_value, old.value, 0);
  v_new_effective := coalesce(new.purchase_value, new.value, 0);

  if v_old_effective is distinct from v_new_effective then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, payload)
    values (
      public.audit_actor_id(),
      'ASSET_PURCHASE_VALUE_UPDATE',
      'assets',
      new.id::text,
      jsonb_build_object(
        'asset_id', new.id,
        'name', new.name,
        'old_purchase_value', old.purchase_value,
        'new_purchase_value', new.purchase_value,
        'old_value', old.value,
        'new_value', new.value,
        'old_effective_purchase_value', v_old_effective,
        'new_effective_purchase_value', v_new_effective,
        'company_id', new.company_id
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_asset_purchase_value_update on public.assets;
create trigger trg_audit_asset_purchase_value_update
after update on public.assets
for each row
when (coalesce(old.purchase_value, old.value, 0) is distinct from coalesce(new.purchase_value, new.value, 0))
execute function public.audit_log_asset_purchase_value_update();

-- Quick checks:
-- select tgname, pg_get_triggerdef(oid)
-- from pg_trigger
-- where tgrelid = 'public.assets'::regclass
--   and tgname in ('trg_guard_asset_sensitive_fields', 'trg_audit_asset_purchase_value_update');
--
-- select action, entity_type, entity_id, payload, created_at
-- from public.audit_logs
-- where action = 'ASSET_PURCHASE_VALUE_UPDATE'
-- order by created_at desc
-- limit 20;
