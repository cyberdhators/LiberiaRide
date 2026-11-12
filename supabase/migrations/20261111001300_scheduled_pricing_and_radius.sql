-- =====================================================================
-- LiberiaRide · 0041 · Scheduled rides priced for the pickup time; 12 km dispatch radius
--
-- 1. schedule_booking re-prices with the busy-hour multiplier in force at the
--    pickup time (not at booking time). Off-peak pickups pay the normal fare
--    even when booked during rush hour; rush-hour pickups pay that window's
--    price. Completion already bills with bookings.surge_multiplier.
-- 2. dispatch.max_radius_m = 12 km (was 8 km; Johnsonville–Sinkor is ~12 km).
-- =====================================================================

create or replace function public.schedule_booking(p_booking_id uuid, p_at timestamptz)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
  v_n   integer;
  v_rule public.fare_rules;
  v_mult numeric(3,2);
  v_fare jsonb;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or (v_b.passenger_id <> v_uid and not public.has_permission('bookings.create')) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_b.status = 'SCHEDULED' and v_b.scheduled_for = p_at then return v_b; end if;   -- idempotent
  if v_b.status <> 'PENDING_CONFIRMATION' then
    raise exception 'only a new booking can be scheduled' using errcode = '55000';
  end if;
  if p_at is null or p_at < now() + make_interval(secs => public.config_int('scheduling.min_ahead_seconds')) then
    raise exception 'pick a time at least % minutes from now', public.config_int('scheduling.min_ahead_seconds') / 60
      using errcode = '22023';
  end if;
  if p_at > now() + make_interval(days => public.config_int('scheduling.max_ahead_days')) then
    raise exception 'rides can be scheduled up to % days ahead', public.config_int('scheduling.max_ahead_days') using errcode = '22023';
  end if;
  select count(*) into v_n from public.bookings where passenger_id = v_b.passenger_id and status = 'SCHEDULED';
  if v_n >= public.config_int('scheduling.max_per_passenger') then
    raise exception 'you already have % upcoming rides', v_n using errcode = '55000';
  end if;

  -- Price for the PICKUP time: busy hours in force then, not when booking (passenger offers keep their price).
  v_mult := public.current_surge(v_b.pickup, p_at);
  if v_b.passenger_offer_minor is null and v_mult is distinct from v_b.surge_multiplier then
    select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
    v_fare := public.compute_fare(public._apply_surge(v_rule, v_mult), v_b.estimated_distance_m, v_b.estimated_duration_s,
      (select count(*)::integer from public.booking_stops where booking_id = p_booking_id and kind = 'stop'), 0, v_b.discount_minor);
    update public.bookings set estimated_fare_minor = (v_fare->>'total_minor')::bigint, surge_multiplier = v_mult
     where id = p_booking_id;
  end if;
  update public.bookings set scheduled_for = date_trunc('minute', p_at) where id = p_booking_id;
  return public._transition_booking(p_booking_id, 'SCHEDULED',
    case when v_b.passenger_id = v_uid then 'passenger' else 'admin' end,
    jsonb_build_object('scheduled_for', date_trunc('minute', p_at)));
end;
$$;

update public.configuration_settings
   set value = '12000', description = 'Maximum search radius (m)', updated_at = now()
 where key = 'dispatch.max_radius_m';
insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, after, reason)
values (null, 'system', 'config.update', 'configuration_settings', 'dispatch.max_radius_m', '12000'::jsonb,
        'Owner decision: 12 km search radius for Greater Monrovia');
