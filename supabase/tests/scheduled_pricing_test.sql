-- =====================================================================
-- LiberiaRide · Scheduled rides are priced for the pickup time (migration 0041)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- Expect: quoted_surged, offpeak_pickup_normal_price, peak_pickup_surged all true; radius 12000.
-- =====================================================================
do $test$
declare
  pax uuid := gen_random_uuid();
  v_now time := (now() at time zone 'Africa/Monrovia')::time;
  v_est public.fare_estimates; v_b public.bookings; v_base bigint; v_w uuid; r jsonb := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', pax, 'authenticated', 'authenticated', pax::text || '@sp.invalid', '', '{}', '{}', now(), now());
  update public.surge_windows set is_active = false;
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_base := v_est.total_minor;
  reset role;
  -- Busy hours right now only: booked in rush hour, picked up off-peak → normal price.
  insert into public.surge_windows(label, multiplier, days, start_local, end_local)
  values ('rush now', 1.50, array[0,1,2,3,4,5,6]::smallint[], v_now - interval '1 minute', v_now + interval '20 minutes') returning id into v_w;
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'sp1_' || replace(gen_random_uuid()::text, '-', ''), false, null, null);
  r := r || jsonb_build_object('quoted_surged', v_b.surge_multiplier = 1.50 and v_b.estimated_fare_minor > v_base);
  v_b := public.schedule_booking(v_b.id, now() + interval '3 hours');
  r := r || jsonb_build_object('offpeak_pickup_normal_price', v_b.surge_multiplier = 1.00 and v_b.estimated_fare_minor = v_base);
  reset role;
  -- Busy hours at the pickup time only: booked off-peak, picked up in the window → busy-hour price.
  update public.surge_windows set is_active = false where id = v_w;
  insert into public.surge_windows(label, multiplier, days, start_local, end_local)
  values ('rush later', 1.50, array[0,1,2,3,4,5,6]::smallint[], v_now + interval '2 hours 50 minutes', v_now + interval '3 hours 30 minutes');
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'sp2_' || replace(gen_random_uuid()::text, '-', ''), false, null, null);
  v_b := public.schedule_booking(v_b.id, now() + interval '3 hours');
  r := r || jsonb_build_object('peak_pickup_surged', v_b.surge_multiplier = 1.50 and v_b.estimated_fare_minor > v_base);
  reset role;
  r := r || jsonb_build_object('radius', public.config_int('dispatch.max_radius_m'));
  raise exception 'TEST_RESULT %', r;
end $test$;
