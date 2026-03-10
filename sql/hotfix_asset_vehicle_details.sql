-- Hotfix - Vehicle details for moto/voiture assets
-- Date: 2026-03-10
--
-- Adds JSONB field used by UI to store conditional vehicle information.

alter table if exists public.assets
  add column if not exists vehicle_details jsonb;

alter table if exists public.assets
  drop constraint if exists assets_vehicle_details_object_check;

alter table if exists public.assets
  add constraint assets_vehicle_details_object_check
  check (
    vehicle_details is null
    or jsonb_typeof(vehicle_details) = 'object'
  );

comment on column public.assets.vehicle_details is
'Additional vehicle metadata shown only for VEHICULE_MOTO and VEHICULE_VOITURE.';

-- Optional checks:
-- select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'assets' and column_name = 'vehicle_details';
-- select id, name, category, vehicle_details from public.assets where category in ('VEHICULE_MOTO', 'VEHICULE_VOITURE') order by created_at desc limit 20;
