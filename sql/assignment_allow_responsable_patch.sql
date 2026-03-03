-- Patch: allow RESPONSABLE to update "Attribué à"
-- Run this if assignment_update_ceo_daf_and_history_names.sql was already executed.

create or replace function public.guard_asset_assignment_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_role text;
begin
  if old.assigned_to_user_id is not distinct from new.assigned_to_user_id
     and coalesce(nullif(btrim(old.assigned_to_name), ''), '') is not distinct from coalesce(nullif(btrim(new.assigned_to_name), ''), '')
  then
    return new;
  end if;

  v_claim_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  if v_claim_role <> 'authenticated' then
    return new;
  end if;

  if public.is_ceo() or public.is_daf() or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) = 'RESPONSABLE'
  ) then
    return new;
  end if;

  raise exception 'forbidden: only CEO, DAF, or RESPONSABLE can update "attribue a"';
end;
$$;

-- Quick check
-- select public.is_ceo() as is_ceo, public.is_daf() as is_daf;
