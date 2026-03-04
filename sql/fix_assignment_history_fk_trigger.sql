-- Hotfix: resolve FK violation when creating assets
-- Cause: assignment history trigger ran BEFORE INSERT on assets.
-- Effect: child row in asset_assignment_history was inserted before parent asset existed.
-- Fix: run trigger AFTER INSERT/UPDATE.

drop trigger if exists trg_track_asset_assignment_changes on public.assets;

create trigger trg_track_asset_assignment_changes
after insert or update on public.assets
for each row
execute function public.track_asset_assignment_changes();

-- Optional safety check:
-- select tgname, pg_get_triggerdef(oid)
-- from pg_trigger
-- where tgrelid = 'public.assets'::regclass
--   and tgname = 'trg_track_asset_assignment_changes';
