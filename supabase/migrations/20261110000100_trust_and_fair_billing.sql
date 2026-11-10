-- =====================================================================
-- LiberiaRide · 0026 · Trust & fair billing
--
-- 1. Start-ride PIN: the passenger tells the driver a 4-digit PIN in the car;
--    the trip cannot start without it (web bookings). Wrong attempts are
--    counted and persist; after the limit the driver must reassign the ride.
-- 2. "Arrived" and "passenger no-show" require a fresh GPS fix near the pickup.
-- 3. Upfront price: a trip that ends at the destination is billed the quoted
--    price (plus waiting). It is metered only when the GPS route is materially
--    longer, or when the trip ends away from the destination — and then on the
--    distance actually driven, never the full estimate.
-- 4. Acceptance rate counts only offers the driver could act on (accepted,
--    declined, ignored) — not offers lost to another driver or a cancellation.
-- 5. Trip GPS points are deleted after 90 days.
-- =====================================================================

insert into public.configuration_settings(key, value, description, is_public) values
  ('trip.require_start_pin',         'true', 'Passenger gives the driver a 4-digit PIN to start a web booking', true),
  ('trip.start_pin_max_attempts',    '5',    'Wrong PIN entries allowed before the driver must reassign the ride', false),
  ('trip.dropoff_radius_m',          '500',  'Ending within this distance of the destination bills the upfront price', false),
  ('fare.upfront_pricing',           'true', 'Charge the quoted price (plus waiting) when the trip ends at the destination', true),
  ('fare.upfront_tolerance',         '1.25', 'Meter the trip instead when the GPS route exceeds the estimate by this factor', false)
on conflict (key) do nothing;

alter table public.trips drop constraint trips_distance_source_check;
alter table public.trips add constraint trips_distance_source_check
  check (distance_source in ('gps_track', 'estimate', 'upfront', 'straight_line'));

-- ---------------------------------------------------------------------
-- 1. Start-ride PIN (kept out of `bookings`, which the assigned driver can read)
-- ---------------------------------------------------------------------
create table public.booking_start_pins (
  booking_id      uuid primary key references public.bookings(id) on delete cascade,
  pin             text not null check (pin ~ '^[0-9]{4}$'),
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  verified_at     timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.booking_start_pins enable row level security;
grant select on public.booking_start_pins to authenticated;
create policy booking_start_pins_passenger on public.booking_start_pins for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.passenger_id = (select auth.uid())));

create or replace function public._new_start_pin()
returns text
language sql
volatile
set search_path = public, extensions, pg_temp
as $$
  select lpad((((get_byte(x.b, 0) << 8) | get_byte(x.b, 1)) % 10000)::text, 4, '0')
    from (select extensions.gen_random_bytes(2) as b) x;
$$;

create or replace function public.tg_create_start_pin()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.booking_start_pins(booking_id, pin) values (new.id, public._new_start_pin())
  on conflict (booking_id) do nothing;
  return null;
end;
$$;
create trigger bookings_create_start_pin after insert on public.bookings
  for each row execute function public.tg_create_start_pin();

-- Rides already in flight get a PIN too.
insert into public.booking_start_pins(booking_id, pin)
select id, public._new_start_pin() from public.bookings
 where status not in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED')
on conflict (booking_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Arrival needs a fresh fix within the arrival radius
-- ---------------------------------------------------------------------
create or replace function public.driver_mark_arrived(p_booking_id uuid)
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
  if v_b.status = 'DRIVER_ARRIVED' then return v_b; end if;
  select round(extensions.st_distance(dl.location, v_b.pickup))::integer into v_dist
    from public.driver_locations dl
   where dl.driver_id = v_uid
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));
  if v_dist is null then
    raise exception 'your location is out of date — turn on GPS and try again in a moment' using errcode = '55000';
  end if;
  if v_dist > public.config_int('trip.arrival_radius_m') then
    raise exception 'you are % m from the pickup point', v_dist using errcode = '55000';
  end if;
  update public.bookings set arrived_at = now() where id = p_booking_id;
  return public._transition_booking(p_booking_id, 'DRIVER_ARRIVED', 'driver',
    jsonb_build_object('distance_to_pickup_m', v_dist, 'location_fresh', true));
end;
$$;

-- ---------------------------------------------------------------------
-- Start trip: PIN (web bookings) or, when no PIN applies, proximity to pickup.
-- Returns {ok, reason?, attempts_left?} so a wrong PIN is recorded, not rolled back.
-- ---------------------------------------------------------------------
drop function public.driver_start_trip(uuid);
create function public.driver_start_trip(p_booking_id uuid, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid      uuid := public.require_active_user();
  v_b        public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_pin      public.booking_start_pins;
  v_need_pin boolean;
  v_max      integer := coalesce(public.config_int('trip.start_pin_max_attempts'), 5);
  v_loc      extensions.geography;
  v_dist     integer;
begin
  if v_b.status = 'IN_PROGRESS' then
    return jsonb_build_object('ok', true, 'status', v_b.status);
  end if;
  if v_b.status <> 'DRIVER_ARRIVED' then
    raise exception 'mark yourself arrived at the pickup first' using errcode = '55000';
  end if;

  select dl.location into v_loc from public.driver_locations dl where dl.driver_id = v_uid;
  select round(extensions.st_distance(dl.location, v_b.pickup))::integer into v_dist
    from public.driver_locations dl
   where dl.driver_id = v_uid
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));

  select * into v_pin from public.booking_start_pins where booking_id = p_booking_id for update;
  -- A missing PIN row (should not happen) falls back to the proximity check below.
  v_need_pin := found and v_b.channel = 'web' and coalesce(public.config_bool('trip.require_start_pin'), true);

  if v_need_pin then
    if v_pin.failed_attempts >= v_max then
      raise exception 'too many wrong PIN attempts — use "Cancel — reassign" so another driver can take the ride, or contact support'
        using errcode = '55000';
    end if;
    if nullif(btrim(coalesce(p_pin, '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'pin_required', 'attempts_left', v_max - v_pin.failed_attempts);
    end if;
    if btrim(p_pin) <> v_pin.pin then
      update public.booking_start_pins set failed_attempts = failed_attempts + 1 where booking_id = p_booking_id;
      return jsonb_build_object('ok', false, 'reason', 'wrong_pin', 'attempts_left', v_max - v_pin.failed_attempts - 1);
    end if;
    update public.booking_start_pins set verified_at = now() where booking_id = p_booking_id;
  else
    if v_dist is null then
      raise exception 'your location is out of date — turn on GPS and try again in a moment' using errcode = '55000';
    end if;
    if v_dist > public.config_int('trip.arrival_radius_m') then
      raise exception 'you are % m from the pickup point', v_dist using errcode = '55000';
    end if;
  end if;

  insert into public.trips(booking_id, driver_id, vehicle_id, start_location, waiting_s)
  values (p_booking_id, v_uid, v_b.vehicle_id, v_loc,
          greatest(0, extract(epoch from now() - coalesce(v_b.arrived_at, now())))::integer);
  update public.bookings set started_at = now() where id = p_booking_id;
  update public.booking_stops set departed_at = now() where booking_id = p_booking_id and kind = 'pickup';
  v_b := public._transition_booking(p_booking_id, 'IN_PROGRESS', 'driver',
    jsonb_build_object('pin_verified', v_need_pin, 'distance_to_pickup_m', v_dist));
  return jsonb_build_object('ok', true, 'status', v_b.status);
end;
$$;
revoke execute on function public.driver_start_trip(uuid, text) from public, anon;
grant execute on function public.driver_start_trip(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Completion with upfront pricing
-- ---------------------------------------------------------------------
create or replace function public.driver_complete_trip(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid       uuid := public.require_active_user();
  v_b         public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_rule      public.fare_rules;
  v_trip      public.trips;
  v_tracked   integer;
  v_straight  integer;
  v_cap       integer;
  v_billed    integer;
  v_bill_dur  integer;
  v_source    text;
  v_duration  integer;
  v_stops     integer;
  v_fare      jsonb;
  v_final     bigint;
  v_comm      bigint;
  v_end       extensions.geography;
  v_end_dist  integer;
  v_near      boolean;
begin
  if v_b.status = 'COMPLETED' then return v_b; end if;
  if v_b.status <> 'IN_PROGRESS' then raise exception 'trip not in progress' using errcode = '55000'; end if;

  select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
  select * into v_trip from public.trips where booking_id = p_booking_id for update;
  select dl.location into v_end from public.driver_locations dl where dl.driver_id = v_uid;
  select round(extensions.st_distance(dl.location, v_b.dropoff))::integer into v_end_dist
    from public.driver_locations dl
   where dl.driver_id = v_uid
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));
  v_near := v_end_dist is not null and v_end_dist <= coalesce(public.config_int('trip.dropoff_radius_m'), 500);

  -- GPS track length from good-quality fixes.
  select round(coalesce(extensions.st_length(extensions.st_makeline(tl.location::extensions.geometry order by tl.recorded_at)::extensions.geography), 0))::integer
    into v_tracked
    from public.trip_locations tl
   where tl.trip_id = v_trip.id and tl.accuracy_m <= public.config_int('gps.billing_accuracy_m');
  -- Honest lower bound when the track is sparse: straight line start → last known position, as roads.
  v_straight := round(coalesce(extensions.st_distance(coalesce(v_trip.start_location, v_b.pickup), v_end), 0)
                      * public.config_numeric('fare.road_factor'))::integer;
  v_cap := round(v_b.estimated_distance_m * public.config_numeric('fare.max_distance_ratio'))::integer;
  v_duration := greatest(0, extract(epoch from now() - v_trip.started_at))::integer;
  v_bill_dur := v_duration;

  if v_near and coalesce(public.config_bool('fare.upfront_pricing'), true)
     and v_tracked <= v_b.estimated_distance_m * coalesce(public.config_numeric('fare.upfront_tolerance'), 1.25) then
    -- Arrived at the destination by a normal route: the quoted price stands.
    v_billed := v_b.estimated_distance_m;
    v_bill_dur := v_b.estimated_duration_s;
    v_source := 'upfront';
  elsif v_near and v_tracked >= v_b.estimated_distance_m * public.config_numeric('fare.min_track_coverage') then
    -- Materially longer route (detour/extra stop): meter the GPS track, capped.
    v_billed := least(v_tracked, v_cap);
    v_source := 'gps_track';
  elsif v_near then
    -- Upfront pricing switched off and the track is poor: bill the estimate.
    v_billed := v_b.estimated_distance_m;
    v_source := 'estimate';
  else
    -- Ended away from the destination (early drop-off, or no fresh GPS):
    -- bill what was actually driven, never the full estimate.
    v_billed := least(greatest(v_tracked, v_straight), v_cap);
    v_source := case when v_tracked >= v_straight then 'gps_track' else 'straight_line' end;
  end if;
  select count(*) into v_stops from public.booking_stops where booking_id = p_booking_id and kind = 'stop';

  if v_b.agreed_fare_minor is not null then
    -- Bid-agreed rides are fixed price.
    v_final := greatest(v_b.agreed_fare_minor - v_b.discount_minor, 0);
    v_comm  := round(v_b.agreed_fare_minor::numeric * v_rule.commission_bps / 10000);
    v_fare  := jsonb_build_object('gross_minor', v_b.agreed_fare_minor, 'discount_minor', least(v_b.discount_minor, v_b.agreed_fare_minor),
                                  'total_minor', v_final, 'commission_minor', v_comm,
                                  'driver_net_minor', v_b.agreed_fare_minor - v_comm, 'fixed_price', true);
  else
    v_fare  := public.compute_fare(v_rule, v_billed, v_bill_dur, v_stops, v_trip.waiting_s, v_b.discount_minor);
    v_final := (v_fare->>'total_minor')::bigint;
    v_comm  := (v_fare->>'commission_minor')::bigint;
  end if;

  update public.trips set ended_at = now(), end_location = v_end, tracked_distance_m = v_tracked,
         billed_distance_m = v_billed, duration_s = v_duration, distance_source = v_source
   where id = v_trip.id;

  update public.bookings set completed_at = now(), final_fare_minor = v_final where id = p_booking_id;
  update public.booking_stops set arrived_at = coalesce(arrived_at, now()) where booking_id = p_booking_id and kind = 'dropoff';

  insert into public.fare_breakdowns(booking_id, kind, currency, base_minor, distance_minor, time_minor, stops_minor,
    waiting_minor, booking_fee_minor, minimum_adjustment_minor, rounding_minor, discount_minor, total_minor,
    commission_minor, driver_net_minor, distance_m, duration_s, waiting_s)
  values (p_booking_id, 'final', v_b.currency,
    coalesce((v_fare->>'base_minor')::bigint, 0), coalesce((v_fare->>'distance_minor')::bigint, 0),
    coalesce((v_fare->>'time_minor')::bigint, 0), coalesce((v_fare->>'stops_minor')::bigint, 0),
    coalesce((v_fare->>'waiting_minor')::bigint, 0), coalesce((v_fare->>'booking_fee_minor')::bigint, 0),
    coalesce((v_fare->>'minimum_adjustment_minor')::bigint, 0), coalesce((v_fare->>'rounding_minor')::bigint, 0),
    (v_fare->>'discount_minor')::bigint, v_final, v_comm, (v_fare->>'driver_net_minor')::bigint,
    v_billed, v_duration, v_trip.waiting_s);

  insert into public.platform_commissions(booking_id, driver_id, currency, fare_minor, rate_bps, amount_minor)
  values (p_booking_id, v_uid, v_b.currency, (v_fare->>'gross_minor')::bigint, v_rule.commission_bps, v_comm);
  insert into public.driver_earnings(driver_id, booking_id, currency, gross_minor, commission_minor, net_minor, payment_method)
  values (v_uid, p_booking_id, v_b.currency, (v_fare->>'gross_minor')::bigint, v_comm,
          (v_fare->>'gross_minor')::bigint - v_comm, v_b.payment_method);

  -- Payment record: cash awaits driver confirmation; mobile money awaits provider verification.
  insert into public.payments(booking_id, payer_id, method, provider, status, amount_minor, currency, idempotency_key,
                              collected_by_driver_id)
  values (p_booking_id, v_b.passenger_id, v_b.payment_method, v_b.payment_method::text, 'pending', v_final, v_b.currency,
          'fare:' || p_booking_id, case when v_b.payment_method = 'cash' then v_uid end)
  on conflict (idempotency_key) do nothing;
  if v_b.payment_method = 'cash' then
    insert into public.cash_reconciliation(driver_id, booking_id, currency, expected_minor)
    values (v_uid, p_booking_id, v_b.currency, v_final);
  end if;

  update public.booking_assignments set released_at = now(), release_reason = 'completed'
   where booking_id = p_booking_id and released_at is null;
  update public.drivers set completed_trips = completed_trips + 1 where id = v_uid;
  update public.passengers set completed_trips = completed_trips + 1 where id = v_b.passenger_id;
  update public.chat_conversations set closed_at = now() where booking_id = p_booking_id;

  insert into public.notifications(user_id, kind, title, body, data)
  values (v_b.passenger_id, 'booking.completed', 'Trip complete',
          'Your trip has ended. Please rate your driver.', jsonb_build_object('booking_id', p_booking_id));

  return public._transition_booking(p_booking_id, 'COMPLETED', 'driver',
    jsonb_build_object('final_fare_minor', v_final, 'billed_distance_m', v_billed, 'distance_source', v_source,
                       'tracked_distance_m', v_tracked, 'distance_to_dropoff_m', v_end_dist));
end;
$$;

-- ---------------------------------------------------------------------
-- No-show needs the driver to still be at the pickup (fresh fix).
-- ---------------------------------------------------------------------
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
  update public.bookings set driver_id = null, vehicle_id = null, assigned_at = null, arrived_at = null,
         search_expires_at = greatest(coalesce(search_expires_at, now()),
                                      now() + make_interval(secs => public.config_int('dispatch.search_timeout_seconds')))
   where id = p_booking_id;
  perform public._transition_booking(p_booking_id, 'SEARCHING_DRIVER', 'driver',
    jsonb_build_object('reason', coalesce(p_reason, 'driver_cancelled'), 'released_driver', v_uid));
  insert into public.notifications(user_id, kind, title, body, data)
  values (v_b.passenger_id, 'booking.driver_cancelled', 'Finding you another driver',
          'Your driver had to cancel. We are finding another driver.', jsonb_build_object('booking_id', p_booking_id));
  perform public.dispatch_booking(p_booking_id);
  select * into v_b from public.bookings where id = p_booking_id;
  return v_b;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Fair acceptance rate. Offers are counted when the driver could act on them
-- (accepted / declined / expired), not when created. Accepts stay counted in
-- accept_offer and passenger_accept_bid.
-- ---------------------------------------------------------------------
create or replace function public._make_offer(
  p_b public.bookings, p_driver_id uuid, p_distance_m integer, p_rank smallint, p_timeout_s integer)
returns public.booking_offers
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_offer public.booking_offers;
  v_cat_code text;
begin
  select code into v_cat_code from public.vehicle_categories where id = p_b.category_id;
  insert into public.booking_offers(
    booking_id, driver_id, strategy, dispatch_round, rank, pickup, pickup_address, dropoff_address,
    category_code, currency, fare_minor, trip_distance_m, trip_duration_s, pickup_distance_m,
    bidding_enabled, expires_at)
  values (
    p_b.id, p_driver_id, p_b.allocation_strategy, p_b.dispatch_round + 1, p_rank, p_b.pickup, p_b.pickup_address,
    case when public.config_bool('dispatch.show_destination_before_accept') then p_b.dropoff_address end,
    v_cat_code, p_b.currency,
    coalesce(p_b.passenger_offer_minor, p_b.estimated_fare_minor),
    p_b.estimated_distance_m, p_b.estimated_duration_s, p_distance_m,
    p_b.bidding_enabled, now() + make_interval(secs => p_timeout_s))
  returning * into v_offer;
  return v_offer;
end;
$$;

create or replace function public.tg_offer_acceptance_stats()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if old.status = 'pending' and new.status in ('accepted', 'rejected', 'expired') then
    update public.drivers set acceptance_offers = acceptance_offers + 1 where id = new.driver_id;
  end if;
  return null;
end;
$$;
create trigger booking_offers_acceptance_stats after update of status on public.booking_offers
  for each row execute function public.tg_offer_acceptance_stats();

-- Recompute existing counters on the new definition.
update public.drivers d
   set acceptance_offers = s.offered, acceptance_accepts = s.accepted
  from (select d2.id,
               count(o.id) filter (where o.status in ('accepted', 'rejected', 'expired'))::integer as offered,
               count(o.id) filter (where o.status = 'accepted')::integer as accepted
          from public.drivers d2 left join public.booking_offers o on o.driver_id = d2.id
         group by d2.id) s
 where s.id = d.id;

-- ---------------------------------------------------------------------
-- 5. Retention: trip GPS points after 90 days.
-- ---------------------------------------------------------------------
create or replace function public.run_retention()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.location_history where received_at < now() - interval '90 days';
  delete from public.trip_locations tl using public.trips t
   where t.id = tl.trip_id and t.ended_at < now() - interval '90 days';
  delete from public.realtime_events where created_at < now() - interval '30 days';
  delete from public.qls_lookup_cache where expires_at < now();
  delete from public.fare_estimates fe where fe.expires_at < now() - interval '7 days'
     and not exists (select 1 from public.bookings b where b.fare_estimate_id = fe.id);
end;
$$;

-- Internal helpers: owner and triggers only.
revoke execute on function
  public._new_start_pin(),
  public.tg_create_start_pin(),
  public.tg_offer_acceptance_stats()
  from public, anon, authenticated;
