-- =====================================================================
-- LiberiaRide · 0027 · Driver "Cancel — reassign" fixes
--
-- 1. driver_cancel_booking cleared driver_id while the booking was still
--    DRIVER_ASSIGNED/ARRIVING/ARRIVED, which violates bookings_driver_when_assigned,
--    so a driver could never hand a ride back. Move to SEARCHING_DRIVER first,
--    then clear the driver.
-- 2. Ride PIN attempts reset when a new driver is assigned. After 5 wrong PINs
--    the driver is told to reassign; without a reset the next driver would be
--    locked out too. Every new assignment (offer accept, bid accept, operator
--    assign) starts with a fresh count; the PIN itself is kept so the
--    passenger's screen stays correct. Not a brute-force path: dispatch never
--    re-offers a booking to a driver who already saw it.
-- =====================================================================

create or replace function public.driver_cancel_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := public.require_active_user();
  v_b    public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_dist integer;
begin
  if v_b.status not in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED') then
    raise exception 'cannot cancel in status %', v_b.status using errcode = '55000';
  end if;

  if v_b.status = 'DRIVER_ARRIVED' and p_reason = 'passenger_no_show'
     and v_b.arrived_at < now() - make_interval(mins => public.config_int('trip.no_show_wait_minutes')) then
    select round(extensions.st_distance(dl.location, v_b.pickup))::integer into v_dist
      from public.driver_locations dl
     where dl.driver_id = v_uid
       and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));
    if v_dist is null then
      raise exception 'your location is out of date — turn on GPS and try again in a moment' using errcode = '55000';
    end if;
    if v_dist > public.config_int('trip.arrival_radius_m') then
      raise exception 'you must be at the pickup point to report a no-show (you are % m away)', v_dist using errcode = '55000';
    end if;
    update public.booking_assignments set released_at = now(), release_reason = 'passenger_no_show'
     where booking_id = p_booking_id and released_at is null;
    return public._cancel_booking(p_booking_id, 'driver', 'passenger_no_show', true);
  end if;

  update public.booking_assignments set released_at = now(), release_reason = coalesce(p_reason, 'driver_cancelled')
   where booking_id = p_booking_id and released_at is null;
  perform public._transition_booking(p_booking_id, 'SEARCHING_DRIVER', 'driver',
    jsonb_build_object('reason', coalesce(p_reason, 'driver_cancelled'), 'released_driver', v_uid));
  update public.bookings set driver_id = null, vehicle_id = null, assigned_at = null, arrived_at = null,
         search_expires_at = greatest(coalesce(search_expires_at, now()),
                                      now() + make_interval(secs => public.config_int('dispatch.search_timeout_seconds')))
   where id = p_booking_id;
  insert into public.notifications(user_id, kind, title, body, data)
  values (v_b.passenger_id, 'booking.driver_cancelled', 'Finding you another driver',
          'Your driver had to cancel. We are finding another driver.', jsonb_build_object('booking_id', p_booking_id));
  perform public.dispatch_booking(p_booking_id);
  select * into v_b from public.bookings where id = p_booking_id;
  return v_b;
end;
$$;

create or replace function public.tg_reset_start_pin_attempts()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  update public.booking_start_pins set failed_attempts = 0
   where booking_id = new.booking_id and failed_attempts > 0;
  return null;
end;
$$;
create trigger booking_assignments_reset_pin_attempts after insert on public.booking_assignments
  for each row execute function public.tg_reset_start_pin_attempts();

revoke execute on function public.tg_reset_start_pin_attempts() from public, anon, authenticated;
