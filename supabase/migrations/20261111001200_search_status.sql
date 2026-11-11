-- =====================================================================
-- LiberiaRide · 0040 · Tell the passenger when no driver is in reach
-- booking_search_status(booking): for the passenger (or staff) while the
-- ride is looking for a driver — how many free, online drivers of the right
-- type are within the maximum search radius, so the app can say "no drivers
-- near your pickup yet" instead of an endless "looking for a driver".
-- Counts only; never positions.
-- =====================================================================

create or replace function public.booking_search_status(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
  v_max integer := public.config_int('dispatch.max_radius_m');
  v_n   integer;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (v_b.passenger_id = v_uid or public.is_staff()) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_b.status not in ('SEARCHING_DRIVER', 'DRIVER_OFFERED') then
    return jsonb_build_object('searching', false);
  end if;
  select count(*) into v_n from public.find_eligible_drivers(p_booking_id, v_max, 50);
  return jsonb_build_object('searching', true, 'drivers_in_reach', v_n, 'radius_m', v_max,
                            'offers_made', (select count(*) from public.booking_offers where booking_id = p_booking_id));
end;
$$;

revoke execute on function public.booking_search_status(uuid) from public, anon;
grant execute on function public.booking_search_status(uuid) to authenticated;
