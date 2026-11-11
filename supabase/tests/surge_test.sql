-- =====================================================================
-- LiberiaRide · Busy-hour pricing test (migration 0034)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  adm  uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_mon extensions.geography := public.make_point(6.3002, -10.7983);
  v_base public.fare_estimates;
  v_est  public.fare_estimates;
  v_b    public.bookings;
  v_w    public.surge_windows;
  v_far  uuid;
  v_offer uuid;
  v_pin  text;
  v_now  time := (now() at time zone 'Africa/Monrovia')::time;
  v_day  timestamptz := date_trunc('week', now()) + interval '2 days';   -- a Wednesday 00:00 UTC (= Monrovia)
  r      jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@surge.invalid', '', '{}', '{}', now(), now()
    from unnest(array[pax, d1, adm]) u;
  insert into public.user_roles(user_id, role) values (adm, 'admin');
  insert into public.drivers(id, status, licence_number, is_online, went_online_at) values (d1, 'approved', 'SRG-' || left(d1::text, 8), true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'SG1-' || left(d1::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id = d1;
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now());
  update public.configuration_settings set value = '"soft"' where key = 'dispatch.default_strategy';
  delete from public.surge_windows;   -- isolate from any windows configured on this project (rolled back)

  -- Baseline price, no busy hours.
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_base := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  reset role;
  r := r || jsonb_build_object('t01_no_surge', v_base.surge_multiplier = 1.00);

  -- Only fares staff create windows; bounds enforced.
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_upsert_surge_window(null, 'Rush', null, 1.3, array[0,1,2,3,4,5,6]::smallint[], '00:00', '23:59', true);
    failures := failures || 't02_passenger_created_window';
  exception when insufficient_privilege then r := r || jsonb_build_object('t02_staff_only', true); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_upsert_surge_window(null, 'Crazy', null, 4.0, array[1]::smallint[], '07:00', '09:00', true);
    failures := failures || 't02_multiplier_4_accepted';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t02_cap_enforced', true); end;
  -- A window covering "now" everywhere, every day.
  v_w := public.admin_upsert_surge_window(null, 'Test rush', null, 1.30, array[0,1,2,3,4,5,6]::smallint[],
                                          v_now - interval '1 minute', v_now + interval '2 hours', true);
  reset role;
  r := r || jsonb_build_object('t02_audited', exists (select 1 from public.audit_logs where actor_id = adm and action = 'surge.create'));

  -- Quoted with the multiplier; the booking keeps it.
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  r := r || jsonb_build_object('t03_quoted_surge', v_est.surge_multiplier = 1.30,
                               't03_price_up', v_est.total_minor > v_base.total_minor
                                               and v_est.total_minor <= round(v_base.total_minor * 1.3) + 25);
  v_b := public.create_booking(v_est.id, 'cash', 'srg_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  r := r || jsonb_build_object('t03_booking_keeps_it', v_b.surge_multiplier = 1.30,
                               't03_in_view', (public.get_booking_view(v_b.id)->>'surge_multiplier')::numeric = 1.30);
  reset role;

  -- Window switched off mid-ride: the passenger still pays exactly what was quoted.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_upsert_surge_window(v_w.id, v_w.label, null, v_w.multiplier, v_w.days, v_w.start_local, v_w.end_local, false);
  reset role;
  r := r || jsonb_build_object('t04_off_now', public.current_surge(v_mon, now()) = 1.00);
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  select pin into v_pin from public.booking_start_pins where booking_id = v_b.id;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  perform public.driver_mark_arrived(v_b.id);
  perform public.driver_start_trip(v_b.id, v_pin);
  reset role;
  update public.driver_locations set location = public.make_point(6.2396, -10.7068), received_at = now() where driver_id = d1;
  set local role authenticated;
  v_b := public.driver_complete_trip(v_b.id);
  reset role;
  r := r || jsonb_build_object('t04_upfront_surged_price', v_b.final_fare_minor = v_est.total_minor);

  -- Zones: a window for a far-away zone does not apply in Monrovia.
  insert into public.geofences(code, name, kind, area)
  values ('srg_test_far', 'Far zone', 'pricing_zone',
          extensions.st_multi(extensions.st_geomfromtext('POLYGON((-10.10 5.85, -10.00 5.85, -10.00 5.95, -10.10 5.95, -10.10 5.85))', 4326))::extensions.geography)
  returning id into v_far;
  insert into public.surge_windows(label, geofence_id, multiplier, days, start_local, end_local)
  values ('Far rush', v_far, 2.00, array[0,1,2,3,4,5,6]::smallint[], '00:00', '23:59');
  r := r || jsonb_build_object('t05_other_zone_ignored', public.current_surge(v_mon, now()) = 1.00,
                               't05_zone_applies_there', public.current_surge(public.make_point(5.90, -10.05), date_trunc('day', now()) + interval '12 hours') = 2.00);

  -- Overnight window (Wed 22:00 → Thu 02:00) and highest-of-overlapping.
  insert into public.surge_windows(label, multiplier, days, start_local, end_local) values
    ('Late night', 1.50, array[3]::smallint[], '22:00', '02:00'),
    ('Late night peak', 1.80, array[3]::smallint[], '23:00', '23:30');
  r := r || jsonb_build_object(
    't06_wed_2230', public.current_surge(v_mon, v_day + interval '22 hours 30 minutes') = 1.50,
    't06_peak_starts_2300', public.current_surge(v_mon, v_day + interval '23 hours') = 1.80,
    't06_overlap_max', public.current_surge(v_mon, v_day + interval '23 hours 10 minutes') = 1.80,
    't06_thu_0100', public.current_surge(v_mon, v_day + interval '25 hours') = 1.50,
    't06_thu_0300', public.current_surge(v_mon, v_day + interval '27 hours') = 1.00,
    't06_tue_0100', public.current_surge(v_mon, v_day - interval '23 hours') = 1.00);

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
