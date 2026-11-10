-- =====================================================================
-- LiberiaRide · Trust & fair billing test (migration 0026)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- Drivers are set up directly as the owner; positions are moved by writing
-- driver_locations (inside one transaction now() is constant, so a second
-- driver_update_location call would always be throttled).
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  pax2 uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  d2   uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_est public.fare_estimates;
  v_b   public.bookings;
  v_pin text;
  v_bad text;
  v_offer uuid;
  i     integer;
  n     integer;
  j     jsonb;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
  d2_before integer;
begin
  r := r || jsonb_build_object('t00_config_keys', (select count(*) from public.configuration_settings where key in
    ('trip.require_start_pin', 'trip.start_pin_max_attempts', 'trip.dropoff_radius_m', 'fare.upfront_pricing', 'fare.upfront_tolerance')) = 5);
  r := r || jsonb_build_object('t00_anon_cannot_start', not has_function_privilege('anon', 'public.driver_start_trip(uuid, text)', 'execute'),
                               't00_user_can_start', has_function_privilege('authenticated', 'public.driver_start_trip(uuid, text)', 'execute'));

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@trust.invalid', '', '{}', '{"full_name":"Trust Test"}', now(), now()
    from unnest(array[pax, pax2, d1, d2]) u;

  -- Approved, online drivers. d1 ≈ 120 m from the pickup, d2 ≈ 1.1 km.
  insert into public.drivers(id, status, licence_number, licence_expiry, is_online, went_online_at)
  values (d1, 'approved', 'TRUST-' || left(d1::text, 8), current_date + 365, true, now()),
         (d2, 'approved', 'TRUST-' || left(d2::text, 8), current_date + 365, true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'TR1-' || left(d1::text, 6), 'approved'),
         (d2, v_car, 'Toyota', 'Yaris', 'White', 'TR2-' || left(d2::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id in (d1, d2);
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now()),
         (d2, public.make_point(6.3100, -10.8000), 10, now(), now());
  update public.configuration_settings set value = '"soft"' where key = 'dispatch.default_strategy';

  -- ---------- Booking 1: PIN, arrival check, upfront price ----------
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'trust_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  select pin into v_pin from public.booking_start_pins where booking_id = v_b.id;
  r := r || jsonb_build_object('t01_passenger_reads_pin', v_pin ~ '^[0-9]{4}$');
  reset role;
  v_bad := case when v_pin = '0000' then '1111' else '0000' end;
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  r := r || jsonb_build_object('t01_offered_to_d1', (select driver_id = d1 from public.booking_offers where id = v_offer));

  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  select count(*) into n from public.booking_start_pins where booking_id = v_b.id;
  r := r || jsonb_build_object('t01_driver_cannot_read_pin', n = 0);
  perform public.driver_mark_arriving(v_b.id);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.booking_start_pins where booking_id = v_b.id;
  r := r || jsonb_build_object('t01_other_passenger_cannot_read_pin', n = 0);
  reset role;

  -- Arrival: stale GPS → blocked; far away → blocked; near → ok.
  update public.driver_locations set received_at = now() - interval '10 minutes' where driver_id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.driver_mark_arrived(v_b.id);
    failures := failures || 't02_arrived_without_fresh_gps';
  exception when others then r := r || jsonb_build_object('t02_stale_gps_blocked', sqlerrm); end;
  reset role;
  update public.driver_locations set location = public.make_point(6.3100, -10.8000), received_at = now() where driver_id = d1;
  set local role authenticated;
  begin
    perform public.driver_mark_arrived(v_b.id);
    failures := failures || 't02_arrived_from_far_away';
  exception when others then r := r || jsonb_build_object('t02_far_blocked', sqlerrm); end;
  reset role;
  update public.driver_locations set location = public.make_point(6.3006, -10.7986), received_at = now() where driver_id = d1;
  set local role authenticated;
  r := r || jsonb_build_object('t02_arrived_near', (public.driver_mark_arrived(v_b.id)).status = 'DRIVER_ARRIVED');

  -- PIN: missing → not counted; wrong → counted and kept; limit → locked.
  j := public.driver_start_trip(v_b.id, null);
  r := r || jsonb_build_object('t03_missing_pin', j->>'reason' = 'pin_required' and (j->>'attempts_left')::int = 5);
  j := public.driver_start_trip(v_b.id, v_bad);
  r := r || jsonb_build_object('t03_wrong_pin', j->>'reason' = 'wrong_pin' and (j->>'attempts_left')::int = 4
                                                and (j->>'ok')::boolean = false);
  for i in 1..4 loop j := public.driver_start_trip(v_b.id, v_bad); end loop;
  r := r || jsonb_build_object('t03_last_attempt', (j->>'attempts_left')::int = 0);
  begin
    perform public.driver_start_trip(v_b.id, v_pin);
    failures := failures || 't03_started_after_lockout';
  exception when others then r := r || jsonb_build_object('t03_locked_out', sqlerrm); end;
  reset role;
  r := r || jsonb_build_object('t03_attempts_persisted', (select failed_attempts from public.booking_start_pins where booking_id = v_b.id) = 5,
                               't03_still_waiting', (select status from public.bookings where id = v_b.id) = 'DRIVER_ARRIVED');
  -- Recovery: the locked-out driver reassigns; the next driver gets a fresh count (same PIN).
  set local role authenticated;
  perform public.driver_cancel_booking(v_b.id, 'driver_unable');
  reset role;
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  r := r || jsonb_build_object('t03_reoffered_to_d2', (select driver_id = d2 from public.booking_offers where id = v_offer));
  update public.driver_locations set location = public.make_point(6.3004, -10.7985), received_at = now() where driver_id = d2;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  reset role;
  r := r || jsonb_build_object('t03_attempts_reset_for_new_driver', (select failed_attempts = 0 and pin = v_pin from public.booking_start_pins where booking_id = v_b.id));
  set local role authenticated;
  perform public.driver_mark_arrived(v_b.id);
  j := public.driver_start_trip(v_b.id, v_pin);
  r := r || jsonb_build_object('t03_correct_pin_starts', (j->>'ok')::boolean and j->>'status' = 'IN_PROGRESS');
  reset role;
  r := r || jsonb_build_object('t03_pin_verified_at', (select verified_at is not null from public.booking_start_pins where booking_id = v_b.id));

  -- Ends at the destination with a sparse track → the quoted price, exactly.
  update public.driver_locations set location = public.make_point(6.2396, -10.7068), received_at = now() where driver_id = d2;
  set local role authenticated;
  v_b := public.driver_complete_trip(v_b.id);
  reset role;
  r := r || jsonb_build_object('t04_upfront_price_charged', v_b.final_fare_minor = v_est.total_minor,
                               't04_source_upfront', (select distance_source = 'upfront' and billed_distance_m = v_est.distance_m
                                                        from public.trips where booking_id = v_b.id));

  -- ---------- Booking 2: driver ends far short of the destination ----------
  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'trust_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  reset role;
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  r := r || jsonb_build_object('t05_offered_to_d1', (select driver_id = d1 from public.booking_offers where id = v_offer));
  select pin into v_pin from public.booking_start_pins where booking_id = v_b.id;
  update public.driver_locations set location = public.make_point(6.3004, -10.7985), received_at = now() where driver_id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  perform public.driver_mark_arrived(v_b.id);
  perform public.driver_start_trip(v_b.id, v_pin);
  reset role;
  update public.driver_locations set location = public.make_point(6.2800, -10.7800), received_at = now() where driver_id = d1;
  set local role authenticated;
  v_b := public.driver_complete_trip(v_b.id);
  reset role;
  r := r || jsonb_build_object('t05_early_end_cheaper', v_b.final_fare_minor < v_est.total_minor,
                               't05_billed_driven_distance', (select distance_source = 'straight_line'
                                                                and billed_distance_m between 3000 and 6000
                                                                from public.trips where booking_id = v_b.id));

  -- ---------- Booking 3 & 4: broadcast acceptance fairness ----------
  update public.configuration_settings set value = '"broadcast"' where key = 'dispatch.default_strategy';
  update public.driver_locations set location = public.make_point(6.3010, -10.7990), received_at = now() where driver_id = d1;
  update public.driver_locations set location = public.make_point(6.3100, -10.8000), received_at = now() where driver_id = d2;
  select acceptance_offers into d2_before from public.drivers where id = d2;
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'trust_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  reset role;
  select count(*) into n from public.booking_offers where booking_id = v_b.id and status = 'pending';
  r := r || jsonb_build_object('t06_broadcast_offers', n);
  r := r || jsonb_build_object('t06_not_counted_when_offered', (select acceptance_offers from public.drivers where id = d2) = d2_before);
  select id into v_offer from public.booking_offers where booking_id = v_b.id and driver_id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  reset role;
  r := r || jsonb_build_object('t06_loser_not_penalised', (select acceptance_offers from public.drivers where id = d2) = d2_before,
                               't06_winner_counted', (select acceptance_offers = 3 and acceptance_accepts = 3 from public.drivers where id = d1));

  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'trust_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  reset role;
  select id into v_offer from public.booking_offers where booking_id = v_b.id and driver_id = d2 and status = 'pending';
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reject_offer(v_offer, 'driver_declined');
  reset role;
  r := r || jsonb_build_object('t06_decline_counted', (select acceptance_offers = d2_before + 1 from public.drivers where id = d2));

  -- ---------- Retention ----------
  update public.trips set ended_at = now() - interval '100 days' where booking_id = (
    select id from public.bookings where passenger_id = pax and status = 'COMPLETED');
  insert into public.trip_locations(trip_id, location, accuracy_m, recorded_at)
  select t.id, public.make_point(6.30, -10.79), 5, now() from public.trips t join public.bookings b on b.id = t.booking_id
   where b.passenger_id in (pax, pax2) and t.ended_at is not null;
  perform public.run_retention();
  r := r || jsonb_build_object('t07_old_track_deleted', not exists (select 1 from public.trip_locations tl join public.trips t on t.id = tl.trip_id
                                 join public.bookings b on b.id = t.booking_id where b.passenger_id = pax),
                               't07_recent_track_kept', exists (select 1 from public.trip_locations tl join public.trips t on t.id = tl.trip_id
                                 join public.bookings b on b.id = t.booking_id where b.passenger_id = pax2));

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
