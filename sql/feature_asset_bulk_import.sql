-- Feature - Bulk asset import with dry-run validation
-- Date: 2026-03-10
--
-- Run after:
-- 1) sql/security_admin_audit_upgrade.sql
-- 2) sql/feature_audit_assignment_history.sql
-- 3) sql/feature_lot3_workflow_roles_and_asset_history.sql
-- 4) sql/feature_data_health_actions.sql
-- 5) sql/feature_app_notifications.sql
-- 6) sql/hotfix_asset_code_autogenerate.sql

create or replace function public.bulk_import_assets(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns table (
  row_number integer,
  status text,
  source_name text,
  company_name text,
  asset_id uuid,
  asset_code text,
  errors jsonb,
  warnings jsonb,
  normalized_payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_row jsonb;
  v_row_number integer;
  v_rows_count integer;
  v_name text;
  v_code text;
  v_category text;
  v_company_id uuid;
  v_company_id_text text;
  v_company_name_input text;
  v_company record;
  v_purchase_date_text text;
  v_purchase_date date;
  v_purchase_value_text text;
  v_purchase_value numeric;
  v_status text;
  v_current_condition text;
  v_amortissement_type text;
  v_amortissement_duration_text text;
  v_amortissement_duration integer;
  v_assigned_to_name text;
  v_assigned_to_user_id uuid;
  v_assigned_to_user_id_text text;
  v_description text;
  v_numeric_text text;
  v_insurance_start_date_text text;
  v_insurance_end_date_text text;
  v_vehicle_details jsonb;
  v_asset_id uuid;
  v_asset_code text;
  v_errors text[];
  v_warnings text[];
  v_result_status text;
  v_payload jsonb;
  v_imported_count integer := 0;
  v_error_count integer := 0;
  v_ready_count integer := 0;
  v_imported_assets jsonb := '[]'::jsonb;
  v_seen_codes text[] := array[]::text[];
  v_has_vehicle_payload boolean;
begin
  v_actor_id := public.audit_actor_id();
  if v_actor_id is null then
    raise exception 'forbidden: authentication required';
  end if;

  v_actor_role := coalesce(public.current_actor_role(), '');
  if v_actor_role not in ('CEO', 'DAF', 'RESPONSABLE') then
    raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can import assets';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Le lot d''import doit être un tableau JSON';
  end if;

  v_rows_count := jsonb_array_length(p_rows);
  if v_rows_count = 0 then
    raise exception 'Le lot d''import est vide';
  end if;

  if v_rows_count > 1000 then
    raise exception 'Le lot maximal supporté est de 1000 lignes';
  end if;

  for v_row_number, v_row in
    select ordinality::integer, value
    from jsonb_array_elements(p_rows) with ordinality as t(value, ordinality)
  loop
    v_name := nullif(btrim(coalesce(v_row ->> 'name', '')), '');
    v_code := nullif(upper(btrim(coalesce(v_row ->> 'code', ''))), '');
    v_category := upper(nullif(btrim(coalesce(v_row ->> 'category', '')), ''));
    v_company_id := null;
    v_company_id_text := nullif(btrim(coalesce(v_row ->> 'company_id', '')), '');
    v_company_name_input := nullif(btrim(coalesce(v_row ->> 'company_name', '')), '');
    v_purchase_date := null;
    v_purchase_date_text := nullif(btrim(coalesce(v_row ->> 'purchase_date', '')), '');
    v_purchase_value := null;
    v_purchase_value_text := nullif(btrim(coalesce(v_row ->> 'purchase_value', '')), '');
    v_status := upper(coalesce(nullif(btrim(coalesce(v_row ->> 'status', '')), ''), 'EN_SERVICE'));
    v_current_condition := upper(coalesce(nullif(btrim(coalesce(v_row ->> 'current_condition', '')), ''), 'BON'));
    v_amortissement_type := upper(coalesce(nullif(btrim(coalesce(v_row ->> 'amortissement_type', '')), ''), 'LINEAIRE'));
    v_amortissement_duration_text := nullif(btrim(coalesce(v_row ->> 'amortissement_duration', '')), '');
    v_amortissement_duration := 5;
    v_assigned_to_name := nullif(btrim(coalesce(v_row ->> 'assigned_to_name', '')), '');
    v_assigned_to_user_id := null;
    v_assigned_to_user_id_text := nullif(btrim(coalesce(v_row ->> 'assigned_to_user_id', '')), '');
    v_description := nullif(btrim(coalesce(v_row ->> 'description', '')), '');
    v_insurance_start_date_text := nullif(btrim(coalesce(v_row ->> 'insurance_start_date', '')), '');
    v_insurance_end_date_text := nullif(btrim(coalesce(v_row ->> 'insurance_end_date', '')), '');
    v_vehicle_details := null;
    v_asset_id := null;
    v_asset_code := null;
    v_errors := array[]::text[];
    v_warnings := array[]::text[];
    select null::uuid as id, null::text as name into v_company;
    v_has_vehicle_payload := false;

    if v_name is null then
      v_errors := array_append(v_errors, 'Nom obligatoire');
    end if;

    if v_category is null then
      v_errors := array_append(v_errors, 'Catégorie obligatoire');
    elsif v_category not in (
      'IT_ORDINATEURS',
      'IT_ECRANS_ACCESSOIRES',
      'IT_IMPRESSION',
      'IT_SERVEURS_RESEAU',
      'TELEPHONIE_MOBILE',
      'MOBILIER_BUREAU',
      'SALLE_REUNION',
      'EQUIPEMENT_ELECTRIQUE',
      'SECURITE_SURVEILLANCE',
      'VEHICULE_MOTO',
      'VEHICULE_VOITURE',
      'VEHICULE_UTILITAIRE',
      'OUTILLAGE_TECHNIQUE',
      'AUTRE'
    ) then
      v_errors := array_append(v_errors, 'Catégorie invalide');
    end if;

    if v_company_id_text is not null then
      begin
        v_company_id := v_company_id_text::uuid;
      exception
        when others then
          v_errors := array_append(v_errors, 'company_id invalide');
      end;
    end if;

    if v_company_id is not null then
      select o.id, o.name
      into v_company
      from public.organisations o
      where o.id = v_company_id;
    elsif v_company_name_input is not null then
      select o.id, o.name
      into v_company
      from public.organisations o
      where upper(o.name) = upper(v_company_name_input)
      limit 1;
    else
      v_errors := array_append(v_errors, 'Société obligatoire');
    end if;

    if v_company_id_text is not null or v_company_name_input is not null then
      if v_company.id is null then
        v_errors := array_append(v_errors, 'Société introuvable');
      end if;
    end if;

    if v_purchase_date_text is not null then
      begin
        v_purchase_date := v_purchase_date_text::date;
      exception
        when others then
          v_errors := array_append(v_errors, 'Date d''achat invalide');
      end;
    end if;

    if v_purchase_value_text is not null then
      begin
        v_numeric_text := regexp_replace(v_purchase_value_text, '[^0-9,.\-]', '', 'g');
        if position(',' in v_numeric_text) > 0 and position('.' in v_numeric_text) = 0 then
          v_numeric_text := replace(v_numeric_text, ',', '.');
        else
          v_numeric_text := replace(v_numeric_text, ',', '');
        end if;
        v_purchase_value := nullif(v_numeric_text, '')::numeric;
      exception
        when others then
          v_errors := array_append(v_errors, 'Valeur d''achat invalide');
      end;
    end if;

    if v_purchase_value is not null and v_purchase_value < 0 then
      v_errors := array_append(v_errors, 'Valeur d''achat invalide');
    elsif v_purchase_value is null then
      v_warnings := array_append(
        v_warnings,
        'Valeur d''achat absente: la ligne créera une anomalie de santé des données'
      );
    end if;

    if v_amortissement_duration_text is not null then
      begin
        v_amortissement_duration := v_amortissement_duration_text::integer;
      exception
        when others then
          v_errors := array_append(v_errors, 'Durée d''amortissement invalide');
      end;
    end if;

    if v_status not in ('EN_SERVICE', 'EN_MAINTENANCE', 'HS', 'REBUS') then
      v_errors := array_append(v_errors, 'Statut invalide');
    end if;

    if v_current_condition not in ('MAUVAIS', 'MOYEN', 'ASSEZ_BON', 'BON', 'NEUF') then
      v_errors := array_append(v_errors, 'Etat actuel invalide');
    end if;

    if v_amortissement_type not in ('LINEAIRE', 'DEGRESSIF') then
      v_errors := array_append(v_errors, 'Type d''amortissement invalide');
    end if;

    if v_amortissement_duration is null or v_amortissement_duration <= 0 or v_amortissement_duration > 50 then
      v_errors := array_append(v_errors, 'Durée d''amortissement invalide');
    end if;

    if v_assigned_to_user_id_text is not null then
      begin
        v_assigned_to_user_id := v_assigned_to_user_id_text::uuid;
      exception
        when others then
          v_errors := array_append(v_errors, 'assigned_to_user_id invalide');
      end;
    end if;

    if v_assigned_to_user_id is not null and not exists (
      select 1
      from public.profiles p
      where p.id = v_assigned_to_user_id
    ) then
      v_errors := array_append(v_errors, 'assigned_to_user_id introuvable');
    end if;

    if v_code is null then
      v_warnings := array_append(v_warnings, 'Code absent: génération automatique à l''import');
    elsif v_code = any(v_seen_codes) then
      v_errors := array_append(v_errors, 'Code actif dupliqué dans le fichier');
    elsif exists (
      select 1
      from public.assets a
      where upper(coalesce(a.code, '')) = v_code
    ) then
      v_errors := array_append(v_errors, 'Code actif déjà existant');
    else
      v_seen_codes := array_append(v_seen_codes, v_code);
    end if;

    v_vehicle_details := jsonb_strip_nulls(
      jsonb_build_object(
        'registration_number', nullif(btrim(coalesce(v_row ->> 'registration_number', '')), ''),
        'brand', nullif(btrim(coalesce(v_row ->> 'brand', '')), ''),
        'model', nullif(btrim(coalesce(v_row ->> 'model', '')), ''),
        'engine_displacement', nullif(btrim(coalesce(v_row ->> 'engine_displacement', '')), ''),
        'chassis_number', nullif(btrim(coalesce(v_row ->> 'chassis_number', '')), ''),
        'color', nullif(btrim(coalesce(v_row ->> 'color', '')), ''),
        'assigned_agent_name', nullif(btrim(coalesce(v_row ->> 'assigned_agent_name', '')), ''),
        'assigned_agent_contact', nullif(btrim(coalesce(v_row ->> 'assigned_agent_contact', '')), ''),
        'assigned_agent_id_number', nullif(btrim(coalesce(v_row ->> 'assigned_agent_id_number', '')), ''),
        'assigned_agent_function', nullif(btrim(coalesce(v_row ->> 'assigned_agent_function', '')), ''),
        'assignment_region', nullif(btrim(coalesce(v_row ->> 'assignment_region', '')), ''),
        'vehicle_operational_status', nullif(upper(btrim(coalesce(v_row ->> 'vehicle_operational_status', ''))), ''),
        'manager_name', nullif(btrim(coalesce(v_row ->> 'manager_name', '')), ''),
        'manager_contact', nullif(btrim(coalesce(v_row ->> 'manager_contact', '')), ''),
        'insurance_company', nullif(btrim(coalesce(v_row ->> 'insurance_company', '')), ''),
        'insurance_type', nullif(upper(btrim(coalesce(v_row ->> 'insurance_type', ''))), ''),
        'policy_number', nullif(btrim(coalesce(v_row ->> 'policy_number', '')), ''),
        'insurance_start_date', v_insurance_start_date_text,
        'insurance_end_date', v_insurance_end_date_text,
        'insurance_status',
          case
            when v_insurance_start_date_text ~ '^\d{4}-\d{2}-\d{2}$'
             and v_insurance_end_date_text ~ '^\d{4}-\d{2}-\d{2}$'
             and current_date between
               v_insurance_start_date_text::date
               and
               v_insurance_end_date_text::date
              then 'ACTIVE'
            when v_insurance_start_date_text is not null
              or v_insurance_end_date_text is not null
              then 'INACTIVE'
            else null
          end,
        'registration_card_number', nullif(btrim(coalesce(v_row ->> 'registration_card_number', '')), ''),
        'registration_card_date', nullif(btrim(coalesce(v_row ->> 'registration_card_date', '')), '')
      )
    );

    v_has_vehicle_payload := v_vehicle_details <> '{}'::jsonb;
    if not v_has_vehicle_payload then
      v_vehicle_details := null;
    end if;

    if v_category not in ('VEHICULE_MOTO', 'VEHICULE_VOITURE', 'VEHICULE_UTILITAIRE') and v_has_vehicle_payload then
      v_warnings := array_append(v_warnings, 'Données véhicule ignorées pour une catégorie non véhicule');
      v_vehicle_details := null;
    end if;

    v_payload := jsonb_strip_nulls(
      jsonb_build_object(
        'name', v_name,
        'code', v_code,
        'category', v_category,
        'company_id', v_company.id,
        'company_name', v_company.name,
        'purchase_date', v_purchase_date,
        'purchase_value', v_purchase_value,
        'value', v_purchase_value,
        'status', v_status,
        'current_condition', v_current_condition,
        'amortissement_type', v_amortissement_type,
        'amortissement_duration', v_amortissement_duration,
        'assigned_to_name', v_assigned_to_name,
        'assigned_to_user_id', v_assigned_to_user_id,
        'description', v_description,
        'vehicle_details', v_vehicle_details
      )
    );

    if array_length(v_errors, 1) is null then
      if p_dry_run then
        v_result_status := 'READY';
        v_ready_count := v_ready_count + 1;
      else
        begin
          insert into public.assets (
            name,
            code,
            category,
            current_condition,
            company_id,
            assigned_to_user_id,
            assigned_to_name,
            purchase_date,
            purchase_value,
            status,
            description,
            amortissement_type,
            amortissement_duration,
            amortissement_method,
            amortissement_rate,
            amortissement_degressive_rate,
            amortissement_degressive_coefficient,
            duration,
            value,
            vehicle_details
          )
          values (
            v_name,
            v_code,
            v_category,
            v_current_condition,
            v_company.id,
            v_assigned_to_user_id,
            v_assigned_to_name,
            v_purchase_date,
            v_purchase_value,
            v_status,
            v_description,
            v_amortissement_type,
            v_amortissement_duration,
            v_amortissement_type,
            case
              when v_purchase_value is not null and v_amortissement_duration > 0
                then round(v_purchase_value / v_amortissement_duration::numeric, 2)
              else null
            end,
            case
              when v_amortissement_duration > 0 then round((
                case
                  when v_amortissement_duration <= 4 then 1.25
                  when v_amortissement_duration <= 6 then 1.75
                  else 2.25
                end / v_amortissement_duration::numeric
              ) * 100, 4)
              else null
            end,
            case
              when v_amortissement_duration <= 4 then 1.25
              when v_amortissement_duration <= 6 then 1.75
              else 2.25
            end,
            v_amortissement_duration,
            v_purchase_value,
            v_vehicle_details
          )
          returning id, code
          into v_asset_id, v_asset_code;

          v_result_status := 'IMPORTED';
          v_imported_count := v_imported_count + 1;
          if jsonb_array_length(v_imported_assets) < 20 then
            v_imported_assets := v_imported_assets || jsonb_build_array(
              jsonb_build_object(
                'id', v_asset_id,
                'code', v_asset_code,
                'name', v_name
              )
            );
          end if;
        exception
          when others then
            v_result_status := 'ERROR';
            v_errors := array_append(v_errors, sqlerrm);
            v_error_count := v_error_count + 1;
        end;
      end if;
    else
      v_result_status := 'ERROR';
      v_error_count := v_error_count + 1;
    end if;

    row_number := v_row_number;
    status := v_result_status;
    source_name := coalesce(v_name, nullif(btrim(coalesce(v_row ->> 'name', '')), ''), '-');
    company_name := coalesce(v_company.name, v_company_name_input, '-');
    asset_id := v_asset_id;
    asset_code := coalesce(v_asset_code, v_code);
    errors := to_jsonb(coalesce(v_errors, array[]::text[]));
    warnings := to_jsonb(coalesce(v_warnings, array[]::text[]));
    normalized_payload := v_payload;
    return next;
  end loop;

  if not p_dry_run and v_imported_count > 0 then
    insert into public.audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      payload
    )
    values (
      v_actor_id,
      'ASSET_IMPORT_BATCH',
      'assets',
      null,
      jsonb_build_object(
        'dry_run', false,
        'rows_count', v_rows_count,
        'imported_count', v_imported_count,
        'error_count', v_error_count,
        'sample_imported_assets', v_imported_assets
      )
    );
  end if;
end;
$$;

revoke all on function public.bulk_import_assets(jsonb, boolean) from public;
grant execute on function public.bulk_import_assets(jsonb, boolean) to authenticated;
