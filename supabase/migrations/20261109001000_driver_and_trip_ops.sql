-- =====================================================================
-- LiberiaRide · 0010 · Driver onboarding, GPS, trip lifecycle, ratings, safety
-- =====================================================================

-- ---------------------------------------------------------------------
-- Driver onboarding
-- ---------------------------------------------------------------------
create or replace function public.register_driver(
  p_full_name text, p_licence_number text, p_licence_expiry date,
  p_date_of_birth date default null, p_address_text text default null)
returns public.drivers
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_d   public.drivers;
begin
  if p_licence_expiry is not null and p_licence_expiry < current_date then
    raise exception 'driver licence has expired' using errcode = '22023';
  end if;
  if p_date_of_birth is not null and p_date_of_birth > current_date - interval '18 years' then
    raise exception 'drivers must be at least 18' using errcode = '22023';
  end if;

  update public.profiles set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name) where id = v_uid;

  insert into public.drivers(id, licence_number, licence_expiry, date_of_birth, address_text)
  values (v_uid, upper(btrim(p_licence_number)), p_licence_expiry, p_date_of_birth, left(p_address_text, 300))
  on conflict (id) do update
    set licence_number = excluded.licence_number, licence_expiry = excluded.licence_expiry,
        date_of_birth = excluded.date_of_birth, address_text = excluded.address_text,
        -- Re-submission after rejection goes back to review; approved/suspended drivers keep status.
        status = case when public.drivers.status = 'rejected' then 'pending'::public.driver_status else public.drivers.status end
  returning * into v_d;

  insert into public.user_roles(user_id, role) values (v_uid, 'driver') on conflict do nothing;
  return v_d;
end;
$$;

create or replace function public.register_vehicle(
  p_category_code text, p_make text, p_model text, p_year smallint, p_color text,
  p_plate_number text, p_registration_number text default null)
returns public.vehicles
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_cat uuid;
  v_v   public.vehicles;
begin
  if not exists (select 1 from public.drivers where id = v_uid) then
    raise exception 'register as a driver first' using errcode = '42501';
  end if;
  select id into v_cat from public.vehicle_categories where code = p_category_code and is_active;
  if v_cat is null then raise exception 'unknown vehicle category' using errcode = '22023'; end if;

  insert into public.vehicles(driver_id, category_id, make, model, year, color, plate_number, registration_number)
  values (v_uid, v_cat, btrim(p_make), btrim(p_model), p_year, btrim(p_color), upper(btrim(p_plate_number)), p_registration_number)
  returning * into v_v;

  update public.drivers set current_vehicle_id = coalesce(current_vehicle_id, v_v.id) where id = v_uid;
  return v_v;
end;
$$;

-- The browser uploads to storage first (path "<uid>/<uuid>.<ext>"), then records it here.
create or replace function public.submit_driver_document(
  p_doc_type public.document_type, p_storage_path text, p_mime_type text,
  p_vehicle_id uuid default null, p_document_number text default null, p_expires_at date default null)
returns public.driver_documents
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_doc public.driver_documents;
begin
  if not exists (select 1 from public.drivers where id = v_uid) then
    raise exception 'register as a driver first' using errcode = '42501';
  end if;
  if p_storage_path not like v_uid::text || '/%' then
    raise exception 'invalid storage path' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'driver-documents' and name = p_storage_path) then
    raise exception 'uploaded file not found' using errcode = 'P0002';
  end if;
  if p_vehicle_id is not null and not exists (select 1 from public.vehicles where id = p_vehicle_id and driver_id = v_uid) then
    raise exception 'vehicle not found' using errcode = 'P0002';
  end if;

  insert into public.driver_documents(driver_id, vehicle_id, doc_type, storage_path, mime_type, document_number, expires_at)
  values (v_uid, p_vehicle_id, p_doc_type, p_storage_path, p_mime_type, left(p_document_number, 60), p_expires_at)
  returning * into v_doc;
  return v_doc;
end;
$$;

-- ---------------------------------------------------------------------
-- Duty status
-- ---------------------------------------------------------------------
create or replace function public.driver_set_online(p_online boolean)
returns public.drivers
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_d   public.drivers;
  v_missing text[];
begin
  select * into v_d from public.drivers where id = v_uid for update;
  if not found then raise exception 'not a driver' using errcode = '42501'; end if;

  if p_online then
    if v_d.status <> 'approved' then
      raise exception 'driver account is %', v_d.status using errcode = '42501';
    end if;
    if not exists (select 1 from public.vehicles where id = v_d.current_vehicle_id and status = 'approved' and is_active) then
      raise exception 'no approved vehicle selected' using errcode = '42501';
    end if;
    select array_agg(t) into v_missing
      from unnest(array['driver_licence', 'vehicle_registration']::public.document_type[]) t
     where not exists (select 1 from public.driver_documents dd
                        where dd.driver_id = v_uid and dd.doc_type = t and dd.status = 'approved'
                          and (dd.expires_at is null or dd.expires_at >= current_date));
    if v_missing is not null then
      raise exception 'documents missing or expired: %', array_to_string(v_missing, ', ') using errcode = '42501';
    end if;
    if not exists (select 1 from public.driver_locations
                    where driver_id = v_uid
                      and received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'))) then
      raise exception 'share your live location before going online' using errcode = '55000';
    end if;
    update public.drivers set is_online = true, went_online_at = now() where id = v_uid returning * into v_d;
  else
    update public.drivers set is_online = false where id = v_uid returning * into v_d;
    -- Pending offers cannot be honoured any more → release them and re-dispatch.
    perform public.reject_offer(o.id, 'driver_went_offline')
       from public.booking_offers o where o.driver_id = v_uid and o.status = 'pending';
  end if;
  return v_d;
end;
$$;

-- ---------------------------------------------------------------------
-- GPS ingestion
-- Accepted only for approved drivers who are online or serving a ride.
-- ---------------------------------------------------------------------
create or replace function public.driver_update_location(
  p_lat double precision, p_lng double precision, p_accuracy_m real,
  p_heading_deg real default null, p_speed_mps real default null,
  p_recorded_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid      uuid := public.require_active_user();
  v_d        public.drivers;
  v_point    extensions.geography := public.make_point(p_lat, p_lng);
  v_rec      timestamptz := coalesce(p_recorded_at, now());
  v_prev     public.driver_locations;
  v_booking  public.bookings;
  v_trip_id  uuid;
  v_jump_mps double precision;
begin
  select * into v_d from public.drivers where id = v_uid;
  if not found or v_d.status <> 'approved' then
    return jsonb_build_object('accepted', false, 'reason', 'not_approved');
  end if;

  -- An offline driver's fix is accepted as the pre-flight position needed to go online;
  -- it does not make them dispatchable (dispatch requires is_online).
  select b.* into v_booking from public.bookings b
   where b.driver_id = v_uid and b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');

  if v_rec < now() - interval '2 minutes' then
    return jsonb_build_object('accepted', false, 'reason', 'stale_fix');
  end if;
  if v_rec > now() + interval '30 seconds' then
    v_rec := now();   -- device clock ahead; trust server time
  end if;
  if p_accuracy_m is null or p_accuracy_m > public.config_int('gps.max_accuracy_m') then
    return jsonb_build_object('accepted', false, 'reason', 'low_accuracy');
  end if;

  select * into v_prev from public.driver_locations where driver_id = v_uid for update;
  if found then
    if v_prev.received_at > now() - make_interval(secs => public.config_int('gps.min_interval_seconds')) then
      return jsonb_build_object('accepted', false, 'reason', 'throttled');
    end if;
    v_jump_mps := extensions.st_distance(v_prev.location, v_point)
                  / greatest(extract(epoch from (now() - v_prev.received_at)), 1);
    if v_jump_mps > 70 then   -- > 250 km/h: GPS glitch or spoofing
      return jsonb_build_object('accepted', false, 'reason', 'implausible_jump');
    end if;
  end if;

  insert into public.driver_locations(driver_id, location, accuracy_m, heading_deg, speed_mps, recorded_at, received_at)
  values (v_uid, v_point, p_accuracy_m,
          case when p_heading_deg >= 0 and p_heading_deg < 360 then p_heading_deg end,
          case when p_speed_mps >= 0 then p_speed_mps end, v_rec, now())
  on conflict (driver_id) do update set
    location = excluded.location, accuracy_m = excluded.accuracy_m, heading_deg = excluded.heading_deg,
    speed_mps = excluded.speed_mps, recorded_at = excluded.recorded_at, received_at = excluded.received_at;

  insert into public.location_history(driver_id, booking_id, location, accuracy_m, speed_mps, recorded_at)
  values (v_uid, v_booking.id, v_point, p_accuracy_m, p_speed_mps, v_rec);

  if v_booking.status = 'IN_PROGRESS' then
    select id into v_trip_id from public.trips where booking_id = v_booking.id;
    insert into public.trip_locations(trip_id, location, accuracy_m, speed_mps, recorded_at)
    values (v_trip_id, v_point, p_accuracy_m, p_speed_mps, v_rec);
  end if;

  return jsonb_build_object(
    'accepted', true,
    'received_at', now(),
    'fresh_for_seconds', public.config_int('dispatch.location_fresh_seconds'),
    'booking_id', v_booking.id);
end;
$$;

-- ---------------------------------------------------------------------
-- Trip lifecycle (driver)
-- ---------------------------------------------------------------------
create or replace function public._lock_driver_booking(p_booking_id uuid, p_driver_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id and driver_id = p_driver_id for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  return v_b;
end;
$$;

create or replace function public.driver_mark_arriving(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
begin
  if v_b.status = 'DRIVER_ARRIVING' then return v_b; end if;
  return public._transition_booking(p_booking_id, 'DRIVER_ARRIVING', 'driver');
end;
$$;

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
  if v_dist is not null and v_dist > public.config_int('trip.arrival_radius_m') then
    raise exception 'you are % m from the pickup point', v_dist using errcode = '55000';
  end if;
  update public.bookings set arrived_at = now() where id = p_booking_id;
  return public._transition_booking(p_booking_id, 'DRIVER_ARRIVED', 'driver',
    jsonb_build_object('distance_to_pickup_m', v_dist, 'location_fresh', v_dist is not null));
end;
$$;

create or replace function public.driver_start_trip(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_loc extensions.geography;
begin
  if v_b.status = 'IN_PROGRESS' then return v_b; end if;
  select location into v_loc from public.driver_locations where driver_id = v_uid;
  insert into public.trips(booking_id, driver_id, vehicle_id, start_location, waiting_s)
  values (p_booking_id, v_uid, v_b.vehicle_id, v_loc,
          greatest(0, extract(epoch from now() - coalesce(v_b.arrived_at, now())))::integer);
  update public.bookings set started_at = now() where id = p_booking_id;
  update public.booking_stops set departed_at = now() where booking_id = p_booking_id and kind = 'pickup';
  return public._transition_booking(p_booking_id, 'IN_PROGRESS', 'driver');
end;
$$;

create or replace function public.driver_record_stop(p_booking_id uuid, p_stop_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := public.require_active_user();
  v_b    public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_trip uuid;
begin
  if v_b.status <> 'IN_PROGRESS' then raise exception 'trip not in progress' using errcode = '55000'; end if;
  if p_event not in ('arrived', 'departed') then raise exception 'invalid stop event' using errcode = '22023'; end if;
  select id into v_trip from public.trips where booking_id = p_booking_id;

  update public.booking_stops
     set arrived_at  = case when p_event = 'arrived'  then coalesce(arrived_at, now())  else arrived_at end,
         departed_at = case when p_event = 'departed' then coalesce(departed_at, now()) else departed_at end
   where id = p_stop_id and booking_id = p_booking_id and kind = 'stop';
  if not found then raise exception 'stop not found' using errcode = 'P0002'; end if;

  insert into public.trip_waypoints(trip_id, stop_id, kind, location)
  select v_trip, p_stop_id, p_event, location from public.driver_locations where driver_id = v_uid;
end;
$$;

-- Complete: compute the final fare server-side, book earnings, commission and payment.
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
  v_billed    integer;
  v_source    text;
  v_duration  integer;
  v_stops     integer;
  v_fare      jsonb;
  v_final     bigint;
  v_comm      bigint;
  v_end       extensions.geography;
begin
  if v_b.status = 'COMPLETED' then return v_b; end if;
  if v_b.status <> 'IN_PROGRESS' then raise exception 'trip not in progress' using errcode = '55000'; end if;

  select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
  select * into v_trip from public.trips where booking_id = p_booking_id for update;
  select location into v_end from public.driver_locations where driver_id = v_uid;

  -- GPS track length from good-quality fixes.
  select round(coalesce(extensions.st_length(extensions.st_makeline(tl.location::extensions.geometry order by tl.recorded_at)::extensions.geography), 0))::integer
    into v_tracked
    from public.trip_locations tl
   where tl.trip_id = v_trip.id and tl.accuracy_m <= public.config_int('gps.billing_accuracy_m');

  -- Use the GPS track when it plausibly covers the route; otherwise bill the estimate.
  -- Cap inflation from GPS drift at fare.max_distance_ratio × estimate.
  if v_tracked >= v_b.estimated_distance_m * public.config_numeric('fare.min_track_coverage') then
    v_billed := least(v_tracked, round(v_b.estimated_distance_m * public.config_numeric('fare.max_distance_ratio'))::integer);
    v_source := 'gps_track';
  else
    v_billed := v_b.estimated_distance_m;
    v_source := 'estimate';
  end if;
  v_duration := greatest(0, extract(epoch from now() - v_trip.started_at))::integer;
  select count(*) into v_stops from public.booking_stops where booking_id = p_booking_id and kind = 'stop';

  if v_b.agreed_fare_minor is not null then
    -- Bid-agreed rides are fixed price.
    v_final := greatest(v_b.agreed_fare_minor - v_b.discount_minor, 0);
    v_comm  := round(v_b.agreed_fare_minor::numeric * v_rule.commission_bps / 10000);
    v_fare  := jsonb_build_object('gross_minor', v_b.agreed_fare_minor, 'discount_minor', least(v_b.discount_minor, v_b.agreed_fare_minor),
                                  'total_minor', v_final, 'commission_minor', v_comm,
                                  'driver_net_minor', v_b.agreed_fare_minor - v_comm, 'fixed_price', true);
  else
    v_fare  := public.compute_fare(v_rule, v_billed, v_duration, v_stops, v_trip.waiting_s, v_b.discount_minor);
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
    jsonb_build_object('final_fare_minor', v_final, 'billed_distance_m', v_billed, 'distance_source', v_source));
end;
$$;

-- Driver confirms the cash they actually received.
create or replace function public.driver_confirm_cash_collected(p_booking_id uuid, p_amount_minor bigint)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_p   public.payments;
begin
  if p_amount_minor is null or p_amount_minor < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;
  select p.* into v_p from public.payments p
    join public.bookings b on b.id = p.booking_id
   where p.booking_id = p_booking_id and p.idempotency_key = 'fare:' || p_booking_id
     and b.driver_id = v_uid and p.method = 'cash'
   for update of p;
  if not found then raise exception 'cash payment not found' using errcode = 'P0002'; end if;
  if v_p.status = 'succeeded' then return v_p; end if;

  update public.payments set status = 'succeeded', confirmed_at = now() where id = v_p.id returning * into v_p;
  insert into public.payment_transactions(payment_id, kind, provider_status, payload)
  values (v_p.id, 'manual', 'cash_collected', jsonb_build_object('collected_minor', p_amount_minor, 'by', v_uid));
  update public.cash_reconciliation
     set collected_minor = p_amount_minor,
         status = case when p_amount_minor = expected_minor then 'matched'::public.reconciliation_status
                       else 'variance'::public.reconciliation_status end
   where booking_id = p_booking_id;

  -- Bypass the status guard: payment_status is not a booking state.
  update public.bookings set payment_status = 'succeeded' where id = p_booking_id;
  return v_p;
end;
$$;

-- Driver cancels an assigned ride. Passenger no-show (after waiting) cancels with a fee;
-- otherwise the ride goes back to dispatch without this driver.
create or replace function public.driver_cancel_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := public.require_active_user();
  v_b    public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_rule public.fare_rules;
begin
  if v_b.status not in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED') then
    raise exception 'cannot cancel in status %', v_b.status using errcode = '55000';
  end if;
  select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;

  if v_b.status = 'DRIVER_ARRIVED' and p_reason = 'passenger_no_show'
     and v_b.arrived_at < now() - make_interval(mins => public.config_int('trip.no_show_wait_minutes')) then
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
-- Ratings
-- ---------------------------------------------------------------------
create or replace function public.rate_booking(
  p_booking_id uuid, p_score smallint, p_tags text[] default '{}', p_comment text default null)
returns public.ratings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
  v_r   public.ratings;
  v_dir text;
  v_ratee uuid;
begin
  select * into v_b from public.bookings where id = p_booking_id and status = 'COMPLETED'
     and (passenger_id = v_uid or driver_id = v_uid);
  if not found then raise exception 'completed booking not found' using errcode = 'P0002'; end if;
  if v_b.completed_at < now() - interval '7 days' then
    raise exception 'rating window has closed' using errcode = '55000';
  end if;
  if v_b.passenger_id = v_uid then v_dir := 'passenger_to_driver'; v_ratee := v_b.driver_id;
  else v_dir := 'driver_to_passenger'; v_ratee := v_b.passenger_id; end if;

  insert into public.ratings(booking_id, rater_id, ratee_id, direction, score, tags, comment)
  values (p_booking_id, v_uid, v_ratee, v_dir, p_score, coalesce(p_tags[1:5], '{}'), left(p_comment, 500))
  returning * into v_r;

  if v_dir = 'passenger_to_driver' then
    update public.drivers d set
      rating_count = d.rating_count + 1,
      rating_avg = round(((coalesce(d.rating_avg, 0) * d.rating_count) + p_score)::numeric / (d.rating_count + 1), 2)
    where d.id = v_ratee;
  else
    update public.passengers p set
      rating_count = p.rating_count + 1,
      rating_avg = round(((coalesce(p.rating_avg, 0) * p.rating_count) + p_score)::numeric / (p.rating_count + 1), 2)
    where p.id = v_ratee;
  end if;
  return v_r;
end;
$$;

-- ---------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------
create or replace function public.raise_sos(
  p_booking_id uuid, p_lat double precision default null, p_lng double precision default null, p_note text default null)
returns public.safety_incidents
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := public.require_active_user();
  v_b    public.bookings;
  v_role text;
  v_inc  public.safety_incidents;
begin
  if p_booking_id is not null then
    select * into v_b from public.bookings where id = p_booking_id and (passenger_id = v_uid or driver_id = v_uid);
    if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  end if;
  v_role := case when v_b.driver_id = v_uid then 'driver' else 'passenger' end;

  insert into public.safety_incidents(booking_id, reporter_id, reporter_role, kind, severity, location, description)
  values (p_booking_id, v_uid, v_role, 'sos', 5,
          case when p_lat is not null and p_lng is not null then public.make_point(p_lat, p_lng) end,
          left(p_note, 2000))
  returning * into v_inc;
  return v_inc;
end;
$$;

create or replace function public.report_incident(
  p_booking_id uuid, p_kind public.incident_kind, p_description text, p_severity smallint default 3)
returns public.safety_incidents
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
  v_inc public.safety_incidents;
begin
  if p_booking_id is not null then
    select * into v_b from public.bookings where id = p_booking_id and (passenger_id = v_uid or driver_id = v_uid);
    if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.safety_incidents(booking_id, reporter_id, reporter_role, kind, severity, description)
  values (p_booking_id, v_uid, case when v_b.driver_id = v_uid then 'driver' else 'passenger' end,
          p_kind, least(greatest(p_severity, 1), 4), left(p_description, 2000))
  returning * into v_inc;
  return v_inc;
end;
$$;

create or replace function public.file_complaint(
  p_booking_id uuid, p_category text, p_description text)
returns public.complaints
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
  v_c   public.complaints;
begin
  if p_booking_id is not null then
    select * into v_b from public.bookings where id = p_booking_id and (passenger_id = v_uid or driver_id = v_uid);
    if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.complaints(booking_id, complainant_id, against_user_id, category, description)
  values (p_booking_id, v_uid,
          case when v_b.passenger_id = v_uid then v_b.driver_id when v_b.driver_id = v_uid then v_b.passenger_id end,
          p_category, p_description)
  returning * into v_c;
  return v_c;
end;
$$;

-- ---------------------------------------------------------------------
-- Read models (privacy-scoped views of a booking for each party)
-- ---------------------------------------------------------------------
-- Passenger / assigned driver / staff view of one booking, including the counter-party's
-- contact details only while the ride is active.
create or replace function public.get_booking_view(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid    uuid := public.require_active_user();
  v_b      public.bookings;
  v_active boolean;
  v_driver jsonb;
  v_pass   jsonb;
  v_loc    jsonb;
  v_is_pax boolean;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (v_b.passenger_id = v_uid or v_b.driver_id = v_uid or public.is_staff()) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  v_is_pax := v_b.passenger_id = v_uid;
  v_active := v_b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');

  if v_b.driver_id is not null then
    select jsonb_build_object(
             'id', d.id, 'name', split_part(coalesce(p.full_name, 'Driver'), ' ', 1),
             'avatar_path', p.avatar_path, 'rating', d.rating_avg, 'trips', d.completed_trips,
             'phone', case when v_active or public.is_staff() then p.phone end,
             'vehicle', jsonb_build_object('make', v.make, 'model', v.model, 'color', v.color,
                                           'plate', v.plate_number, 'category', vc.code))
      into v_driver
      from public.drivers d join public.profiles p on p.id = d.id
      left join public.vehicles v on v.id = v_b.vehicle_id
      left join public.vehicle_categories vc on vc.id = v.category_id
     where d.id = v_b.driver_id;
    if v_active then
      select jsonb_build_object('lat', extensions.st_y(dl.location::extensions.geometry),
                                'lng', extensions.st_x(dl.location::extensions.geometry),
                                'heading', dl.heading_deg, 'accuracy_m', dl.accuracy_m,
                                'received_at', dl.received_at,
                                'stale', dl.received_at < now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds')))
        into v_loc from public.driver_locations dl where dl.driver_id = v_b.driver_id;
    end if;
  end if;

  if not v_is_pax then
    select jsonb_build_object('name', split_part(coalesce(p.full_name, 'Passenger'), ' ', 1),
                              'rating', pa.rating_avg,
                              'phone', case when v_active or public.is_staff() then p.phone end)
      into v_pass
      from public.profiles p left join public.passengers pa on pa.id = p.id where p.id = v_b.passenger_id;
  end if;

  return jsonb_build_object(
    'id', v_b.id, 'code', v_b.code, 'status', v_b.status, 'channel', v_b.channel,
    'pickup', jsonb_build_object('lat', extensions.st_y(v_b.pickup::extensions.geometry), 'lng', extensions.st_x(v_b.pickup::extensions.geometry), 'address', v_b.pickup_address, 'qls_ref', v_b.pickup_qls_ref),
    'dropoff', jsonb_build_object('lat', extensions.st_y(v_b.dropoff::extensions.geometry), 'lng', extensions.st_x(v_b.dropoff::extensions.geometry), 'address', v_b.dropoff_address, 'qls_ref', v_b.dropoff_qls_ref),
    'stops', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'kind', s.kind, 'address', s.address,
                'lat', extensions.st_y(s.location::extensions.geometry), 'lng', extensions.st_x(s.location::extensions.geometry),
                'arrived_at', s.arrived_at, 'departed_at', s.departed_at) order by s.seq), '[]'::jsonb)
              from public.booking_stops s where s.booking_id = v_b.id),
    'currency', v_b.currency, 'estimated_fare_minor', v_b.estimated_fare_minor, 'agreed_fare_minor', v_b.agreed_fare_minor,
    'final_fare_minor', v_b.final_fare_minor, 'discount_minor', v_b.discount_minor,
    'estimated_distance_m', v_b.estimated_distance_m, 'estimated_duration_s', v_b.estimated_duration_s,
    'payment_method', v_b.payment_method, 'payment_status', v_b.payment_status,
    'bidding_enabled', v_b.bidding_enabled, 'passenger_offer_minor', v_b.passenger_offer_minor,
    'route_polyline', v_b.route_polyline,
    'share_token', case when v_is_pax then v_b.share_token end,
    'driver', v_driver, 'driver_location', v_loc, 'passenger', v_pass,
    'reserved', v_b.reserved_driver_id is not null and v_b.reserved_until > now(),
    'search_expires_at', v_b.search_expires_at,
    'created_at', v_b.created_at, 'assigned_at', v_b.assigned_at, 'arrived_at', v_b.arrived_at,
    'started_at', v_b.started_at, 'completed_at', v_b.completed_at, 'cancelled_at', v_b.cancelled_at,
    'cancel_reason', v_b.cancel_reason, 'cancellation_fee_minor', v_b.cancellation_fee_minor,
    'final_breakdown', (select to_jsonb(fb) - 'id' - 'booking_id' - 'fare_estimate_id'
                          - case when v_is_pax then array['commission_minor', 'driver_net_minor'] else array[]::text[] end
                          from public.fare_breakdowns fb where fb.booking_id = v_b.id and fb.kind = 'final' limit 1)
  );
end;
$$;

-- Public trip-sharing link (anonymous). Shows only what a trusted contact needs.
create or replace function public.get_shared_trip(p_share_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where share_token = p_share_token
     and status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED')
     and (completed_at is null or completed_at > now() - interval '1 hour');
  if not found then return null; end if;
  return jsonb_build_object(
    'code', v_b.code, 'status', v_b.status,
    'pickup_address', v_b.pickup_address, 'dropoff_address', v_b.dropoff_address,
    'driver', (select jsonb_build_object('name', split_part(coalesce(p.full_name, 'Driver'), ' ', 1),
                 'vehicle', v.color || ' ' || v.make || ' ' || v.model, 'plate', v.plate_number)
                 from public.profiles p left join public.vehicles v on v.id = v_b.vehicle_id where p.id = v_b.driver_id),
    'driver_location', case when v_b.status <> 'COMPLETED' then
        (select jsonb_build_object('lat', extensions.st_y(dl.location::extensions.geometry), 'lng', extensions.st_x(dl.location::extensions.geometry),
                'received_at', dl.received_at) from public.driver_locations dl where dl.driver_id = v_b.driver_id) end,
    'started_at', v_b.started_at, 'completed_at', v_b.completed_at);
end;
$$;
