-- =====================================================================
-- LiberiaRide · 0034 · Busy-hour pricing
--
-- Operators define surge windows (days + local Monrovia time, optional zone,
-- multiplier 1.05–3.00). The multiplier scales the fare rule's base, per-km,
-- per-minute, per-stop and minimum (not the booking fee, waiting or
-- cancellation fee) when a price is QUOTED; it is stored on the estimate and
-- copied onto the booking, and completion bills with the same multiplier, so
-- the upfront price still holds. compute_fare itself is unchanged.
-- =====================================================================

create table public.surge_windows (
  id           uuid primary key default gen_random_uuid(),
  label        text not null check (char_length(btrim(label)) between 2 and 60),
  geofence_id  uuid references public.geofences(id) on delete cascade,   -- null = everywhere
  multiplier   numeric(3,2) not null check (multiplier between 1.05 and 3.00),
  days         smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]::smallint[]),
  start_local  time not null,
  end_local    time not null check (end_local <> start_local),            -- end < start = crosses midnight
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger surge_windows_updated_at before update on public.surge_windows
  for each row execute function public.set_updated_at();
alter table public.surge_windows enable row level security;
grant select on public.surge_windows to authenticated;
create policy surge_windows_staff on public.surge_windows for select to authenticated using (public.is_staff());

alter table public.fare_estimates add column surge_multiplier numeric(3,2) not null default 1.00
  check (surge_multiplier between 1.00 and 3.00);

-- Highest multiplier of the active windows covering this place and moment (1.00 if none).
-- days: 0 = Sunday … 6 = Saturday, in Monrovia time (UTC, no DST).
create or replace function public.current_surge(p_pickup extensions.geography, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with t as (select (p_at at time zone 'Africa/Monrovia') as l)
  select coalesce(max(w.multiplier), 1.00)::numeric(3,2)
    from public.surge_windows w
    left join public.geofences g on g.id = w.geofence_id, t
   where w.is_active
     and (w.geofence_id is null or (g.is_active and extensions.st_covers(g.area, p_pickup)))
     and case when w.start_local < w.end_local
              then extract(dow from t.l)::smallint = any(w.days) and t.l::time >= w.start_local and t.l::time < w.end_local
              else (extract(dow from t.l)::smallint = any(w.days) and t.l::time >= w.start_local)
                or (((extract(dow from t.l)::int + 6) % 7)::smallint = any(w.days) and t.l::time < w.end_local)
         end;
$$;

-- The rule with distance/time/base/stop/minimum components scaled (whole minor units).
create or replace function public._apply_surge(p_rule public.fare_rules, p_mult numeric)
returns public.fare_rules
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  v public.fare_rules := p_rule;
begin
  if p_mult is null or p_mult <= 1 then return p_rule; end if;
  v.base_fare_minor    := round(p_rule.base_fare_minor * p_mult);
  v.per_km_minor       := round(p_rule.per_km_minor * p_mult);
  v.per_minute_minor   := round(p_rule.per_minute_minor * p_mult);
  v.per_stop_minor     := round(p_rule.per_stop_minor * p_mult);
  v.minimum_fare_minor := round(p_rule.minimum_fare_minor * p_mult);
  return v;
end;
$$;

-- Bookings keep the multiplier they were quoted, even after the estimate row is cleaned up.
create or replace function public.tg_booking_surge()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  new.surge_multiplier := coalesce((select fe.surge_multiplier from public.fare_estimates fe where fe.id = new.fare_estimate_id), 1.00);
  return new;
end;
$$;
create trigger bookings_surge before insert on public.bookings
  for each row execute function public.tg_booking_surge();

-- Operators manage windows (fares.manage); audited.
create or replace function public.admin_upsert_surge_window(
  p_id uuid, p_label text, p_geofence_code text, p_multiplier numeric, p_days smallint[], p_start time, p_end time, p_active boolean)
returns public.surge_windows
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old public.surge_windows;
  v_w   public.surge_windows;
  v_geo uuid;
begin
  perform public.require_permission('fares.manage');
  if p_geofence_code is not null and btrim(p_geofence_code) <> '' then
    select id into v_geo from public.geofences where code = btrim(p_geofence_code);
    if v_geo is null then raise exception 'unknown area %', p_geofence_code using errcode = '22023'; end if;
  end if;
  if p_multiplier is null or p_multiplier < 1.05 or p_multiplier > 3.00 then
    raise exception 'multiplier must be between 1.05 and 3.00' using errcode = '22023';
  end if;
  if p_days is null or cardinality(p_days) = 0 then raise exception 'pick at least one day' using errcode = '22023'; end if;
  if p_start is null or p_end is null or p_start = p_end then
    raise exception 'start and end times must differ' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.surge_windows(label, geofence_id, multiplier, days, start_local, end_local, is_active, created_by)
    values (btrim(p_label), v_geo, p_multiplier, p_days, p_start, p_end, coalesce(p_active, true), (select auth.uid()))
    returning * into v_w;
  else
    select * into v_old from public.surge_windows where id = p_id for update;
    if not found then raise exception 'busy-hour window not found' using errcode = 'P0002'; end if;
    update public.surge_windows set label = btrim(p_label), geofence_id = v_geo, multiplier = p_multiplier, days = p_days,
           start_local = p_start, end_local = p_end, is_active = coalesce(p_active, true)
     where id = p_id returning * into v_w;
  end if;
  perform public.write_audit(case when p_id is null then 'surge.create' else 'surge.update' end,
    'surge_windows', v_w.id::text, to_jsonb(v_old), to_jsonb(v_w));
  return v_w;
end;
$$;

-- Quote: scale the rule by the busy-hour multiplier (copy of 0008 with the surge lines).
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
  v_mult    numeric(3,2);
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
  -- Busy hours: the quoted price (and so the upfront price) includes the multiplier.
  v_mult := public.current_surge(v_pickup, now());
  v_rule := public._apply_surge(v_rule, v_mult);

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
    subtotal_minor, discount_minor, total_minor, coupon_id, breakdown, expires_at, surge_multiplier)
  values (
    p_passenger_id, v_cat.id, v_rule.id, p_currency,
    v_pickup, left(btrim(p_pickup_address), 300), p_pickup_qls_ref, v_dropoff, left(btrim(p_dropoff_address), 300), p_dropoff_qls_ref, v_stops,
    p_distance_m, p_duration_s, p_route_source, p_route_polyline, p_route_steps,
    (v_fare->>'gross_minor')::bigint, (v_fare->>'discount_minor')::bigint, (v_fare->>'total_minor')::bigint,
    v_coupon.coupon_id, v_fare || jsonb_build_object('surge_multiplier', v_mult),
    now() + make_interval(secs => public.config_int('fare.estimate_ttl_seconds')), v_mult)
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

-- Completion: bill with the booking's multiplier (copy of 0029 with one added line).
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
  v_fees      bigint := 0;
  v_fee       record;
  v_fee_driver uuid;
  v_fee_bps   integer;
begin
  if v_b.status = 'COMPLETED' then return v_b; end if;
  if v_b.status <> 'IN_PROGRESS' then raise exception 'trip not in progress' using errcode = '55000'; end if;

  select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
  v_rule := public._apply_surge(v_rule, v_b.surge_multiplier);   -- busy-hour price quoted at booking
  select * into v_trip from public.trips where booking_id = p_booking_id for update;
  select dl.location into v_end from public.driver_locations dl where dl.driver_id = v_uid;
  select round(extensions.st_distance(dl.location, v_b.dropoff))::integer into v_end_dist
    from public.driver_locations dl
   where dl.driver_id = v_uid
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));
  v_near := v_end_dist is not null and v_end_dist <= coalesce(public.config_int('trip.dropoff_radius_m'), 500);

  select round(coalesce(extensions.st_length(extensions.st_makeline(tl.location::extensions.geometry order by tl.recorded_at)::extensions.geography), 0))::integer
    into v_tracked
    from public.trip_locations tl
   where tl.trip_id = v_trip.id and tl.accuracy_m <= public.config_int('gps.billing_accuracy_m');
  v_straight := round(coalesce(extensions.st_distance(coalesce(v_trip.start_location, v_b.pickup), v_end), 0)
                      * public.config_numeric('fare.road_factor'))::integer;
  v_cap := round(v_b.estimated_distance_m * public.config_numeric('fare.max_distance_ratio'))::integer;
  v_duration := greatest(0, extract(epoch from now() - v_trip.started_at))::integer;
  v_bill_dur := v_duration;

  if v_near and coalesce(public.config_bool('fare.upfront_pricing'), true)
     and v_tracked <= v_b.estimated_distance_m * coalesce(public.config_numeric('fare.upfront_tolerance'), 1.25) then
    v_billed := v_b.estimated_distance_m;
    v_bill_dur := v_b.estimated_duration_s;
    v_source := 'upfront';
  elsif v_near and v_tracked >= v_b.estimated_distance_m * public.config_numeric('fare.min_track_coverage') then
    v_billed := least(v_tracked, v_cap);
    v_source := 'gps_track';
  elsif v_near then
    v_billed := v_b.estimated_distance_m;
    v_source := 'estimate';
  else
    v_billed := least(greatest(v_tracked, v_straight), v_cap);
    v_source := case when v_tracked >= v_straight then 'gps_track' else 'straight_line' end;
  end if;
  select count(*) into v_stops from public.booking_stops where booking_id = p_booking_id and kind = 'stop';

  if v_b.agreed_fare_minor is not null then
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

  -- Unpaid cancellation / no-show fees from earlier rides (same currency) are collected with this fare.
  for v_fee in
    select p.id, p.booking_id, p.amount_minor from public.payments p
     where p.payer_id = v_b.passenger_id and p.currency = v_b.currency and p.status = 'pending'
       and p.idempotency_key like 'cancel-fee:%' and p.created_at <= v_b.created_at
     order by p.created_at
     for update
  loop
    v_fees := v_fees + v_fee.amount_minor;
    update public.payments set status = 'succeeded', confirmed_at = now(),
           collected_by_driver_id = case when v_b.payment_method = 'cash' then v_uid end
     where id = v_fee.id;
    insert into public.payment_transactions(payment_id, kind, provider_status, payload)
    values (v_fee.id, 'manual', 'carried_over', jsonb_build_object('collected_with_booking', p_booking_id));
    -- The driver who drove to the pickup and was cancelled on gets the fee, minus commission.
    select ba.driver_id into v_fee_driver from public.booking_assignments ba
     where ba.booking_id = v_fee.booking_id and ba.release_reason in ('booking_cancelled', 'passenger_no_show')
     order by ba.released_at desc limit 1;
    if v_fee_driver is not null then
      select fr.commission_bps into v_fee_bps from public.bookings ob join public.fare_rules fr on fr.id = ob.fare_rule_id
       where ob.id = v_fee.booking_id;
      insert into public.driver_wallet_entries(driver_id, currency, kind, amount_minor, reference, booking_id, note)
      select v_fee_driver, v_b.currency, 'cancellation_fee',
             v_fee.amount_minor - round(v_fee.amount_minor::numeric * coalesce(v_fee_bps, 0) / 10000)::bigint,
             'cancel-fee:' || v_fee.booking_id, v_fee.booking_id, 'Cancellation fee collected'
       where v_fee.amount_minor - round(v_fee.amount_minor::numeric * coalesce(v_fee_bps, 0) / 10000)::bigint <> 0
      on conflict (reference) do nothing;
    end if;
  end loop;
  v_final := v_final + v_fees;

  update public.trips set ended_at = now(), end_location = v_end, tracked_distance_m = v_tracked,
         billed_distance_m = v_billed, duration_s = v_duration, distance_source = v_source
   where id = v_trip.id;

  update public.bookings set completed_at = now(), final_fare_minor = v_final where id = p_booking_id;
  update public.booking_stops set arrived_at = coalesce(arrived_at, now()) where booking_id = p_booking_id and kind = 'dropoff';

  insert into public.fare_breakdowns(booking_id, kind, currency, base_minor, distance_minor, time_minor, stops_minor,
    waiting_minor, booking_fee_minor, minimum_adjustment_minor, rounding_minor, discount_minor, cancellation_minor, total_minor,
    commission_minor, driver_net_minor, distance_m, duration_s, waiting_s)
  values (p_booking_id, 'final', v_b.currency,
    coalesce((v_fare->>'base_minor')::bigint, 0), coalesce((v_fare->>'distance_minor')::bigint, 0),
    coalesce((v_fare->>'time_minor')::bigint, 0), coalesce((v_fare->>'stops_minor')::bigint, 0),
    coalesce((v_fare->>'waiting_minor')::bigint, 0), coalesce((v_fare->>'booking_fee_minor')::bigint, 0),
    coalesce((v_fare->>'minimum_adjustment_minor')::bigint, 0), coalesce((v_fare->>'rounding_minor')::bigint, 0),
    (v_fare->>'discount_minor')::bigint, v_fees, v_final, v_comm, (v_fare->>'driver_net_minor')::bigint,
    v_billed, v_duration, v_trip.waiting_s);

  insert into public.platform_commissions(booking_id, driver_id, currency, fare_minor, rate_bps, amount_minor)
  values (p_booking_id, v_uid, v_b.currency, (v_fare->>'gross_minor')::bigint, v_rule.commission_bps, v_comm);
  insert into public.driver_earnings(driver_id, booking_id, currency, gross_minor, commission_minor, net_minor, payment_method)
  values (v_uid, p_booking_id, v_b.currency, (v_fare->>'gross_minor')::bigint, v_comm,
          (v_fare->>'gross_minor')::bigint - v_comm, v_b.payment_method);

  insert into public.payments(booking_id, payer_id, method, provider, status, amount_minor, currency, idempotency_key,
                              collected_by_driver_id)
  values (p_booking_id, v_b.passenger_id, v_b.payment_method, v_b.payment_method::text, 'pending', v_final, v_b.currency,
          'fare:' || p_booking_id, case when v_b.payment_method = 'cash' then v_uid end)
  on conflict (idempotency_key) do nothing;
  if v_b.payment_method = 'cash' then
    -- Expected cash includes any carried fee, so the collecting driver owes it on to the platform.
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
                       'tracked_distance_m', v_tracked, 'distance_to_dropoff_m', v_end_dist, 'carried_fees_minor', v_fees));
end;
$$;

revoke execute on function
  public.current_surge(extensions.geography, timestamptz),
  public._apply_surge(public.fare_rules, numeric),
  public.tg_booking_surge(),
  public.admin_upsert_surge_window(uuid, text, text, numeric, smallint[], time, time, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_upsert_surge_window(uuid, text, text, numeric, smallint[], time, time, boolean) to authenticated;
