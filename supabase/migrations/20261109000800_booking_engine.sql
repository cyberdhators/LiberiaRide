-- =====================================================================
-- LiberiaRide · 0008 · Booking state machine, fare engine, booking RPCs
-- See docs/BOOKING_LIFECYCLE.md. TS mirror: packages/shared/src/booking-state.ts
-- =====================================================================

-- ---------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------
create or replace function public.booking_transition_allowed(p_from public.booking_status, p_to public.booking_status)
returns boolean
language sql
immutable
parallel safe
set search_path = public, extensions, pg_temp
as $$
  select case p_from
    when 'DRAFT'                then p_to in ('FARE_ESTIMATED', 'CANCELLED')
    when 'FARE_ESTIMATED'       then p_to in ('PENDING_CONFIRMATION', 'CANCELLED', 'EXPIRED')
    when 'PENDING_CONFIRMATION' then p_to in ('SEARCHING_DRIVER', 'CANCELLED', 'EXPIRED')
    when 'SEARCHING_DRIVER'     then p_to in ('DRIVER_OFFERED', 'DRIVER_ASSIGNED', 'CANCELLED', 'EXPIRED', 'FAILED')
    when 'DRIVER_OFFERED'       then p_to in ('DRIVER_ASSIGNED', 'SEARCHING_DRIVER', 'CANCELLED', 'EXPIRED', 'FAILED')
    when 'DRIVER_ASSIGNED'      then p_to in ('DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'SEARCHING_DRIVER', 'CANCELLED', 'FAILED')
    when 'DRIVER_ARRIVING'      then p_to in ('DRIVER_ARRIVED', 'SEARCHING_DRIVER', 'CANCELLED', 'FAILED')
    when 'DRIVER_ARRIVED'       then p_to in ('IN_PROGRESS', 'SEARCHING_DRIVER', 'CANCELLED', 'FAILED')
    when 'IN_PROGRESS'          then p_to in ('COMPLETED', 'FAILED')
    else false   -- COMPLETED, CANCELLED, EXPIRED, FAILED are terminal
  end;
$$;

-- Guard: status may only change inside _transition_booking (sets a txn-local flag).
create or replace function public.guard_booking_status()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then
      raise exception 'bookings must be created in DRAFT' using errcode = '23514';
    end if;
  elsif new.status is distinct from old.status
        and coalesce(current_setting('app.booking_transition', true), '') <> new.id::text then
    raise exception 'booking status may only change via the booking engine' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger bookings_guard_status before insert or update of status on public.bookings
  for each row execute function public.guard_booking_status();

-- The single choke point for status changes. Takes the row lock, validates the
-- transition, updates, and appends booking_events. Not executable by API roles.
create or replace function public._transition_booking(
  p_booking_id uuid,
  p_to public.booking_status,
  p_actor_role text,
  p_metadata jsonb default '{}'::jsonb)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b    public.bookings;
  v_from public.booking_status;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  v_from := v_b.status;
  if not public.booking_transition_allowed(v_from, p_to) then
    raise exception 'invalid booking transition % -> %', v_from, p_to using errcode = '23514';
  end if;

  perform set_config('app.booking_transition', p_booking_id::text, true);
  update public.bookings set status = p_to where id = p_booking_id returning * into v_b;
  perform set_config('app.booking_transition', '', true);

  insert into public.booking_events(booking_id, from_status, to_status, actor_id, actor_role, metadata)
  values (p_booking_id, v_from, p_to, (select auth.uid()), p_actor_role, coalesce(p_metadata, '{}'::jsonb));

  return v_b;
end;
$$;

-- ---------------------------------------------------------------------
-- Fare engine (authoritative). Mirrors packages/shared/src/fare.ts.
-- ---------------------------------------------------------------------
create or replace function public.compute_fare(
  p_rule public.fare_rules,
  p_distance_m integer,
  p_duration_s integer,
  p_extra_stops integer default 0,
  p_waiting_s integer default 0,
  p_discount_minor bigint default 0)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  v_distance   bigint := round(p_rule.per_km_minor::numeric * greatest(p_distance_m, 0) / 1000);
  v_time       bigint := round(p_rule.per_minute_minor::numeric * greatest(p_duration_s, 0) / 60);
  v_stops      bigint := p_rule.per_stop_minor * greatest(p_extra_stops, 0);
  v_wait_min   integer := greatest(0, ceil((greatest(p_waiting_s, 0) - p_rule.waiting_free_minutes * 60)::numeric / 60))::integer;
  v_waiting    bigint := p_rule.waiting_per_minute_minor * v_wait_min;
  v_raw        bigint;
  v_min_adj    bigint;
  v_pre_round  bigint;
  v_gross      bigint;
  v_discount   bigint;
  v_total      bigint;
  v_commission bigint;
begin
  v_raw       := p_rule.base_fare_minor + v_distance + v_time + v_stops + v_waiting + p_rule.booking_fee_minor;
  v_min_adj   := greatest(0, p_rule.minimum_fare_minor - v_raw);
  v_pre_round := v_raw + v_min_adj;
  v_gross     := public.round_minor(v_pre_round, p_rule.rounding_increment_minor);
  v_discount  := least(greatest(coalesce(p_discount_minor, 0), 0), v_gross);
  v_total     := v_gross - v_discount;
  -- Commission is charged on the gross fare: promotions are funded by the platform, not the driver.
  v_commission := round(v_gross::numeric * p_rule.commission_bps / 10000);

  return jsonb_build_object(
    'currency', p_rule.currency,
    'base_minor', p_rule.base_fare_minor,
    'distance_minor', v_distance,
    'time_minor', v_time,
    'stops_minor', v_stops,
    'waiting_minor', v_waiting,
    'booking_fee_minor', p_rule.booking_fee_minor,
    'minimum_adjustment_minor', v_min_adj,
    'rounding_minor', v_gross - v_pre_round,
    'gross_minor', v_gross,
    'discount_minor', v_discount,
    'total_minor', v_total,
    'commission_minor', v_commission,
    'driver_net_minor', v_gross - v_commission,
    'distance_m', p_distance_m,
    'duration_s', p_duration_s,
    'waiting_s', p_waiting_s
  );
end;
$$;

-- Active rule for category/currency, preferring a pricing-zone rule that contains the pickup.
create or replace function public.resolve_fare_rule(
  p_category_id uuid, p_currency public.currency_code, p_pickup extensions.geography)
returns public.fare_rules
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select fr.*
  from public.fare_rules fr
  left join public.geofences g on g.id = fr.geofence_id
  where fr.category_id = p_category_id
    and fr.currency = p_currency
    and fr.is_active
    and fr.valid_from <= now()
    and (fr.valid_to is null or fr.valid_to > now())
    and (fr.geofence_id is null or (g.is_active and extensions.st_covers(g.area, p_pickup)))
  order by (fr.geofence_id is not null) desc, fr.valid_from desc
  limit 1;
$$;

-- Validate a coupon for a passenger and return the discount (0 if not applicable).
create or replace function public.evaluate_coupon(
  p_code text, p_user_id uuid, p_category_id uuid, p_currency public.currency_code, p_gross_minor bigint)
returns table (coupon_id uuid, discount_minor bigint, reason text)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_c public.coupons;
  v_p public.promotions;
  v_used integer;
  v_total_used integer;
  v_discount bigint;
begin
  if p_code is null or btrim(p_code) = '' then
    return query select null::uuid, 0::bigint, null::text; return;
  end if;
  select * into v_c from public.coupons where code = upper(btrim(p_code)) and is_active;
  if not found then return query select null::uuid, 0::bigint, 'coupon_not_found'; return; end if;
  select * into v_p from public.promotions where id = v_c.promotion_id;
  if not v_p.is_active or v_p.starts_at > now() or (v_p.ends_at is not null and v_p.ends_at <= now()) then
    return query select null::uuid, 0::bigint, 'coupon_inactive'; return;
  end if;
  if v_c.assigned_user_id is not null and v_c.assigned_user_id <> p_user_id then
    return query select null::uuid, 0::bigint, 'coupon_not_found'; return;
  end if;
  if v_p.category_id is not null and v_p.category_id <> p_category_id then
    return query select null::uuid, 0::bigint, 'coupon_category_mismatch'; return;
  end if;
  if p_gross_minor < v_p.min_fare_minor then
    return query select null::uuid, 0::bigint, 'coupon_min_fare'; return;
  end if;
  if v_p.discount_type = 'fixed' and v_p.currency <> p_currency then
    return query select null::uuid, 0::bigint, 'coupon_currency_mismatch'; return;
  end if;
  select count(*) into v_used from public.coupon_redemptions r where r.coupon_id = v_c.id and r.user_id = p_user_id;
  if v_used >= v_p.per_user_limit then
    return query select null::uuid, 0::bigint, 'coupon_already_used'; return;
  end if;
  if v_p.usage_limit is not null then
    select count(*) into v_total_used from public.coupon_redemptions r
      join public.coupons c2 on c2.id = r.coupon_id where c2.promotion_id = v_p.id;
    if v_total_used >= v_p.usage_limit then
      return query select null::uuid, 0::bigint, 'coupon_exhausted'; return;
    end if;
  end if;

  if v_p.discount_type = 'percent' then
    v_discount := round(p_gross_minor::numeric * v_p.discount_value / 10000);
  else
    v_discount := v_p.discount_value;
  end if;
  if v_p.max_discount_minor is not null then
    v_discount := least(v_discount, v_p.max_discount_minor);
  end if;
  v_discount := least(v_discount, p_gross_minor);
  return query select v_c.id, v_discount, null::text;
end;
$$;

-- ---------------------------------------------------------------------
-- Fare estimates
-- ---------------------------------------------------------------------
-- Internal: build + store an estimate. Distance/duration are trusted ONLY from
-- the service-role routed variant; the authenticated variant computes them.
create or replace function public._insert_fare_estimate(
  p_passenger_id uuid,
  p_category_code text,
  p_currency public.currency_code,
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text, p_pickup_qls_ref text,
  p_dropoff_lat double precision, p_dropoff_lng double precision, p_dropoff_address text, p_dropoff_qls_ref text,
  p_stops jsonb,
  p_distance_m integer, p_duration_s integer, p_route_source text,
  p_route_polyline text, p_route_steps jsonb,
  p_coupon_code text)
returns public.fare_estimates
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cat     public.vehicle_categories;
  v_rule    public.fare_rules;
  v_pickup  extensions.geography := public.make_point(p_pickup_lat, p_pickup_lng);
  v_dropoff extensions.geography := public.make_point(p_dropoff_lat, p_dropoff_lng);
  v_stops   jsonb := coalesce(p_stops, '[]'::jsonb);
  v_n_stops integer;
  v_fare    jsonb;
  v_coupon  record;
  v_est     public.fare_estimates;
  v_stop    jsonb;
begin
  select * into v_cat from public.vehicle_categories where code = p_category_code and is_active;
  if not found then raise exception 'unknown vehicle category' using errcode = '22023'; end if;

  if jsonb_typeof(v_stops) <> 'array' or jsonb_array_length(v_stops) > public.config_int('booking.max_stops') then
    raise exception 'too many stops' using errcode = '22023';
  end if;
  for v_stop in select * from jsonb_array_elements(v_stops) loop
    perform public.make_point((v_stop->>'lat')::double precision, (v_stop->>'lng')::double precision);
    if coalesce(btrim(v_stop->>'address'), '') = '' then
      raise exception 'stop address required' using errcode = '22023';
    end if;
  end loop;
  v_n_stops := jsonb_array_length(v_stops);

  -- Service area check (pickup must be inside an active service_area if any exist).
  if exists (select 1 from public.geofences where kind = 'service_area' and is_active)
     and not exists (select 1 from public.geofences
                      where kind = 'service_area' and is_active and extensions.st_covers(area, v_pickup)) then
    raise exception 'pickup is outside the service area' using errcode = '22023';
  end if;
  if extensions.st_distance(v_pickup, v_dropoff) < 100 and v_n_stops = 0 then
    raise exception 'pickup and destination are too close' using errcode = '22023';
  end if;

  v_rule := public.resolve_fare_rule(v_cat.id, p_currency, v_pickup);
  if v_rule.id is null then
    raise exception 'no active fare rule for % in %', p_category_code, p_currency using errcode = '22023';
  end if;

  v_fare := public.compute_fare(v_rule, p_distance_m, p_duration_s, v_n_stops, 0, 0);
  select * into v_coupon from public.evaluate_coupon(p_coupon_code, p_passenger_id, v_cat.id, p_currency, (v_fare->>'gross_minor')::bigint);
  if p_coupon_code is not null and v_coupon.reason is not null then
    raise exception '%', v_coupon.reason using errcode = '22023';
  end if;
  if coalesce(v_coupon.discount_minor, 0) > 0 then
    v_fare := public.compute_fare(v_rule, p_distance_m, p_duration_s, v_n_stops, 0, v_coupon.discount_minor);
  end if;

  insert into public.fare_estimates(
    passenger_id, category_id, fare_rule_id, currency,
    pickup, pickup_address, pickup_qls_ref, dropoff, dropoff_address, dropoff_qls_ref, stops,
    distance_m, duration_s, route_source, route_polyline, route_steps,
    subtotal_minor, discount_minor, total_minor, coupon_id, breakdown, expires_at)
  values (
    p_passenger_id, v_cat.id, v_rule.id, p_currency,
    v_pickup, left(btrim(p_pickup_address), 300), p_pickup_qls_ref, v_dropoff, left(btrim(p_dropoff_address), 300), p_dropoff_qls_ref, v_stops,
    p_distance_m, p_duration_s, p_route_source, p_route_polyline, p_route_steps,
    (v_fare->>'gross_minor')::bigint, (v_fare->>'discount_minor')::bigint, (v_fare->>'total_minor')::bigint,
    v_coupon.coupon_id, v_fare,
    now() + make_interval(secs => public.config_int('fare.estimate_ttl_seconds')))
  returning * into v_est;

  insert into public.fare_breakdowns(fare_estimate_id, kind, currency, base_minor, distance_minor, time_minor,
    stops_minor, waiting_minor, booking_fee_minor, minimum_adjustment_minor, rounding_minor, discount_minor,
    total_minor, commission_minor, driver_net_minor, distance_m, duration_s, waiting_s)
  values (v_est.id, 'estimate', p_currency, (v_fare->>'base_minor')::bigint, (v_fare->>'distance_minor')::bigint,
    (v_fare->>'time_minor')::bigint, (v_fare->>'stops_minor')::bigint, 0, (v_fare->>'booking_fee_minor')::bigint,
    (v_fare->>'minimum_adjustment_minor')::bigint, (v_fare->>'rounding_minor')::bigint, (v_fare->>'discount_minor')::bigint,
    (v_fare->>'total_minor')::bigint, (v_fare->>'commission_minor')::bigint, (v_fare->>'driver_net_minor')::bigint,
    p_distance_m, p_duration_s, 0);

  return v_est;
end;
$$;

-- Geodesic distance through the stops × road factor; duration from configured average speed.
create or replace function public.geodesic_route_estimate(p_points extensions.geography[])
returns table (distance_m integer, duration_s integer)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_total double precision := 0;
  i integer;
begin
  for i in 1 .. coalesce(array_length(p_points, 1), 0) - 1 loop
    v_total := v_total + extensions.st_distance(p_points[i], p_points[i + 1]);
  end loop;
  distance_m := round(v_total * public.config_numeric('fare.road_factor'))::integer;
  duration_s := round(distance_m / (public.config_numeric('fare.fallback_speed_kmh') / 3.6))::integer;
  return next;
end;
$$;

-- Passenger-callable estimate (no routing provider): distance computed server-side.
create or replace function public.create_fare_estimate(
  p_category_code text,
  p_currency public.currency_code,
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text,
  p_dropoff_lat double precision, p_dropoff_lng double precision, p_dropoff_address text,
  p_stops jsonb default '[]'::jsonb,
  p_pickup_qls_ref text default null,
  p_dropoff_qls_ref text default null,
  p_coupon_code text default null)
returns public.fare_estimates
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_points extensions.geography[];
  v_route record;
  v_stop jsonb;
begin
  v_points := array[public.make_point(p_pickup_lat, p_pickup_lng)];
  for v_stop in select * from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) loop
    v_points := v_points || public.make_point((v_stop->>'lat')::double precision, (v_stop->>'lng')::double precision);
  end loop;
  v_points := v_points || public.make_point(p_dropoff_lat, p_dropoff_lng);
  select * into v_route from public.geodesic_route_estimate(v_points);

  return public._insert_fare_estimate(v_uid, p_category_code, p_currency,
    p_pickup_lat, p_pickup_lng, p_pickup_address, p_pickup_qls_ref,
    p_dropoff_lat, p_dropoff_lng, p_dropoff_address, p_dropoff_qls_ref,
    p_stops, v_route.distance_m, v_route.duration_s, 'geodesic_fallback', null, null, p_coupon_code);
end;
$$;

-- Server-only estimate: the Next.js route handler has called QLS directions and passes the
-- verified route. Granted to service_role ONLY. p_passenger_id comes from the verified session.
create or replace function public.create_fare_estimate_routed(
  p_passenger_id uuid,
  p_category_code text,
  p_currency public.currency_code,
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text, p_pickup_qls_ref text,
  p_dropoff_lat double precision, p_dropoff_lng double precision, p_dropoff_address text, p_dropoff_qls_ref text,
  p_stops jsonb,
  p_distance_m integer, p_duration_s integer,
  p_route_polyline text, p_route_steps jsonb,
  p_coupon_code text default null)
returns public.fare_estimates
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_geo record;
begin
  if p_distance_m is null or p_distance_m < 0 or p_duration_s is null or p_duration_s < 0 then
    raise exception 'invalid route metrics' using errcode = '22023';
  end if;
  -- Sanity: a road route can't be shorter than the straight line.
  select * into v_geo from public.geodesic_route_estimate(array[
    public.make_point(p_pickup_lat, p_pickup_lng), public.make_point(p_dropoff_lat, p_dropoff_lng)]);
  if p_distance_m < (v_geo.distance_m / public.config_numeric('fare.road_factor')) * 0.95 then
    raise exception 'route distance shorter than straight line' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_passenger_id and is_suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  return public._insert_fare_estimate(p_passenger_id, p_category_code, p_currency,
    p_pickup_lat, p_pickup_lng, p_pickup_address, p_pickup_qls_ref,
    p_dropoff_lat, p_dropoff_lng, p_dropoff_address, p_dropoff_qls_ref,
    p_stops, p_distance_m, p_duration_s, 'qls_directions', p_route_polyline, p_route_steps, p_coupon_code);
end;
$$;

-- ---------------------------------------------------------------------
-- Booking creation (idempotent) and confirmation
-- ---------------------------------------------------------------------
create or replace function public._create_booking(
  p_passenger_id uuid,
  p_estimate_id uuid,
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_channel public.booking_channel,
  p_passenger_offer_minor bigint,
  p_note text,
  p_actor_role text)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_existing public.bookings;
  v_est      public.fare_estimates;
  v_rule     public.fare_rules;
  v_b        public.bookings;
  v_stop     jsonb;
  v_seq      smallint := 1;
  v_bidding  boolean := false;
  v_strategy public.allocation_strategy;
begin
  -- Idempotency: same key → same booking, no side effects.
  select * into v_existing from public.bookings
   where passenger_id = p_passenger_id and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_est from public.fare_estimates where id = p_estimate_id for update;
  if not found or v_est.passenger_id <> p_passenger_id then
    raise exception 'fare estimate not found' using errcode = 'P0002';
  end if;
  if v_est.expires_at < now() then
    raise exception 'fare estimate expired' using errcode = '22023';
  end if;
  select * into v_rule from public.fare_rules where id = v_est.fare_rule_id;

  if p_passenger_offer_minor is not null then
    if not v_rule.bidding_enabled or not public.config_bool('bidding.enabled') then
      raise exception 'bidding is not enabled for this category' using errcode = '22023';
    end if;
    if p_passenger_offer_minor < round(v_est.total_minor::numeric * v_rule.bid_min_pct / 100)
       or p_passenger_offer_minor > round(v_est.total_minor::numeric * v_rule.bid_max_pct / 100) then
      raise exception 'offer outside allowed range' using errcode = '22023';
    end if;
    v_bidding := true;
  end if;
  -- Bidding offers go to several drivers at once; otherwise the ops-configured default.
  v_strategy := case when v_bidding then 'broadcast'::public.allocation_strategy
                     else public.config_text('dispatch.default_strategy')::public.allocation_strategy end;

  insert into public.bookings(
    passenger_id, category_id, channel, idempotency_key,
    pickup, pickup_address, pickup_qls_ref, dropoff, dropoff_address, dropoff_qls_ref,
    fare_estimate_id, fare_rule_id, currency,
    estimated_distance_m, estimated_duration_s, estimated_fare_minor, discount_minor, coupon_id,
    payment_method, allocation_strategy, bidding_enabled, passenger_offer_minor,
    route_polyline, passenger_note)
  values (
    p_passenger_id, v_est.category_id, p_channel, p_idempotency_key,
    v_est.pickup, v_est.pickup_address, v_est.pickup_qls_ref, v_est.dropoff, v_est.dropoff_address, v_est.dropoff_qls_ref,
    v_est.id, v_est.fare_rule_id, v_est.currency,
    v_est.distance_m, v_est.duration_s, v_est.total_minor, v_est.discount_minor, v_est.coupon_id,
    p_payment_method, v_strategy, v_bidding, p_passenger_offer_minor,
    v_est.route_polyline, nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  returning * into v_b;

  insert into public.booking_events(booking_id, from_status, to_status, actor_id, actor_role, metadata)
  values (v_b.id, null, 'DRAFT', (select auth.uid()), p_actor_role, jsonb_build_object('channel', p_channel));

  -- Stops: pickup (0), intermediate (1..n), dropoff (n+1)
  insert into public.booking_stops(booking_id, seq, kind, location, address, qls_ref)
  values (v_b.id, 0, 'pickup', v_est.pickup, v_est.pickup_address, v_est.pickup_qls_ref);
  for v_stop in select * from jsonb_array_elements(v_est.stops) loop
    insert into public.booking_stops(booking_id, seq, kind, location, address, qls_ref)
    values (v_b.id, v_seq, 'stop',
            public.make_point((v_stop->>'lat')::double precision, (v_stop->>'lng')::double precision),
            left(v_stop->>'address', 300), v_stop->>'qls_ref');
    v_seq := v_seq + 1;
  end loop;
  insert into public.booking_stops(booking_id, seq, kind, location, address, qls_ref)
  values (v_b.id, v_seq, 'dropoff', v_est.dropoff, v_est.dropoff_address, v_est.dropoff_qls_ref);

  if v_est.coupon_id is not null and v_est.discount_minor > 0 then
    insert into public.coupon_redemptions(coupon_id, user_id, booking_id, discount_minor, currency)
    values (v_est.coupon_id, p_passenger_id, v_b.id, v_est.discount_minor, v_est.currency);
    update public.coupons set redeemed_count = redeemed_count + 1 where id = v_est.coupon_id;
  end if;

  if v_bidding then
    insert into public.booking_bids(booking_id, party, amount_minor, currency, status, expires_at)
    values (v_b.id, 'passenger', p_passenger_offer_minor, v_est.currency, 'open',
            now() + make_interval(secs => public.config_int('dispatch.search_timeout_seconds')));
  end if;

  -- Consume the estimate so it cannot seed a second booking.
  update public.fare_estimates set expires_at = least(expires_at, now()) where id = v_est.id;

  perform public._transition_booking(v_b.id, 'FARE_ESTIMATED', p_actor_role, jsonb_build_object('estimate_id', v_est.id));
  return public._transition_booking(v_b.id, 'PENDING_CONFIRMATION', p_actor_role, '{}'::jsonb);
end;
$$;

-- Passenger RPC. p_confirm = true goes straight to driver search (single-tap booking).
create or replace function public.create_booking(
  p_estimate_id uuid,
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_confirm boolean default true,
  p_passenger_offer_minor bigint default null,
  p_note text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
begin
  v_b := public._create_booking(v_uid, p_estimate_id, p_payment_method, p_idempotency_key, 'web',
                                p_passenger_offer_minor, p_note, 'passenger');
  if p_confirm and v_b.status = 'PENDING_CONFIRMATION' then
    v_b := public.confirm_booking(v_b.id);
  end if;
  return v_b;
end;
$$;

-- PENDING_CONFIRMATION → SEARCHING_DRIVER, then immediately run a dispatch round.
create or replace function public.confirm_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_b   public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or (v_uid is not null and v_b.passenger_id <> v_uid and not public.is_staff()) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_b.status <> 'PENDING_CONFIRMATION' then
    return v_b;   -- idempotent confirm
  end if;

  update public.bookings
     set confirmed_at = now(),
         search_expires_at = now() + make_interval(secs => public.config_int('dispatch.search_timeout_seconds'))
   where id = p_booking_id;
  v_b := public._transition_booking(p_booking_id, 'SEARCHING_DRIVER',
           case when v_uid is null then 'system' when v_b.passenger_id = v_uid then 'passenger' else 'admin' end);

  if v_b.allocation_strategy <> 'manual' then
    perform public.dispatch_booking(p_booking_id);
  end if;
  select * into v_b from public.bookings where id = p_booking_id;
  return v_b;
end;
$$;

-- ---------------------------------------------------------------------
-- Cancellation (passenger, driver, admin/system share one implementation)
-- ---------------------------------------------------------------------
create or replace function public._cancel_booking(
  p_booking_id uuid, p_actor_role text, p_reason text, p_charge_fee boolean)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b    public.bookings;
  v_rule public.fare_rules;
  v_fee  bigint := 0;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.status in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED') then
    return v_b;  -- idempotent
  end if;
  if v_b.status = 'IN_PROGRESS' then
    raise exception 'a ride in progress cannot be cancelled; complete it or raise SOS' using errcode = '23514';
  end if;

  if p_charge_fee then
    select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
    v_fee := v_rule.cancellation_fee_minor;
  end if;

  update public.booking_offers set status = 'cancelled', responded_at = now()
   where booking_id = p_booking_id and status = 'pending';
  update public.booking_bids set status = 'withdrawn', responded_at = now()
   where booking_id = p_booking_id and status = 'open';
  update public.booking_assignments set released_at = now(), release_reason = 'booking_cancelled'
   where booking_id = p_booking_id and released_at is null;
  update public.chat_conversations set closed_at = now() where booking_id = p_booking_id and closed_at is null;

  update public.bookings
     set cancelled_at = now(), cancelled_by = (select auth.uid()), cancelled_by_role = p_actor_role,
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), ''),
         cancellation_fee_minor = v_fee, reserved_driver_id = null, reserved_until = null
   where id = p_booking_id;

  if v_fee > 0 then
    insert into public.fare_breakdowns(booking_id, kind, currency, cancellation_minor, total_minor)
    values (p_booking_id, 'cancellation', v_b.currency, v_fee, v_fee);
    insert into public.payments(booking_id, payer_id, method, provider, status, amount_minor, currency, idempotency_key)
    values (p_booking_id, v_b.passenger_id, v_b.payment_method, v_b.payment_method::text, 'pending', v_fee, v_b.currency,
            'cancel-fee:' || p_booking_id);
  end if;

  return public._transition_booking(p_booking_id, 'CANCELLED', p_actor_role,
    jsonb_build_object('reason', p_reason, 'fee_minor', v_fee));
end;
$$;

-- Passenger cancels. Fee applies once a driver has been assigned for longer than the grace period.
create or replace function public.passenger_cancel_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := public.require_active_user();
  v_b    public.bookings;
  v_rule public.fare_rules;
  v_fee  boolean := false;
begin
  select * into v_b from public.bookings where id = p_booking_id and passenger_id = v_uid for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;

  if v_b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED') then
    select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
    v_fee := v_b.assigned_at < now() - make_interval(secs => v_rule.cancellation_grace_seconds);
  end if;
  return public._cancel_booking(p_booking_id, 'passenger', p_reason, v_fee);
end;
$$;
