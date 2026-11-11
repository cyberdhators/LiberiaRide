-- =====================================================================
-- LiberiaRide · Book-for-someone-else test (migration 0033)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  pax2 uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_est public.fare_estimates;
  v_b   public.bookings;
  v_offer uuid;
  j     jsonb;
  n     integer;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, phone, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', pax,  'authenticated', 'authenticated', null, '231770001111', '', '{}', '{"full_name":"Booker Kollie"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', pax2, 'authenticated', 'authenticated', null, '231770002222', '', '{}', '{"full_name":"Other Person"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', d1,   'authenticated', 'authenticated', null, '231880003333', '', '{}', '{"full_name":"Driver Doe"}', now(), now());
  insert into public.drivers(id, status, licence_number, is_online, went_online_at) values (d1, 'approved', 'RID-' || left(d1::text, 8), true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'RD1-' || left(d1::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id = d1;
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now());
  update public.configuration_settings set value = '"soft"' where key = 'dispatch.default_strategy';

  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'rid_' || replace(gen_random_uuid()::text, '-', ''), false, null, null);
  begin
    perform public.set_booking_rider(v_b.id, 'Mama Musu', '0770123456');
    failures := failures || 't01_unnormalised_phone';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t01_e164_required', true); end;
  perform public.set_booking_rider(v_b.id, 'Mama Musu Kamara', '+231770123456');
  select count(*) into n from public.booking_riders where booking_id = v_b.id;
  r := r || jsonb_build_object('t01_passenger_reads_rider', n = 1,
                               't01_in_own_view', public.get_booking_view(v_b.id) #>> '{rider,name}' = 'Mama Musu Kamara');
  v_b := public.confirm_booking(v_b.id);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.booking_riders where booking_id = v_b.id;
  r := r || jsonb_build_object('t02_other_passenger_sees_nothing', n = 0);
  reset role;

  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.booking_riders where booking_id = v_b.id;
  r := r || jsonb_build_object('t03_driver_no_table_access', n = 0);
  perform public.accept_offer(v_offer);
  j := public.get_booking_view(v_b.id);
  r := r || jsonb_build_object('t03_driver_sees_rider', j #>> '{passenger,name}' = 'Mama' and j #>> '{passenger,phone}' = '+231770123456'
                                                       and j #>> '{passenger,booked_by}' = 'Booker',
                               't03_no_rider_block_for_driver', j -> 'rider' = 'null'::jsonb);
  select count(*) into n from public.booking_riders where booking_id = v_b.id;
  r := r || jsonb_build_object('t03_still_no_table_access', n = 0);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_booking_rider(v_b.id, 'Someone Else', '+231770999999');
    failures := failures || 't04_changed_after_assignment';
  exception when object_not_in_prerequisite_state then r := r || jsonb_build_object('t04_locked_after_assignment', true); end;
  perform public.passenger_cancel_booking(v_b.id, 'test');
  reset role;

  -- After the ride the driver no longer gets the rider's phone.
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_booking_view(v_b.id);
  r := r || jsonb_build_object('t05_phone_hidden_after', j #>> '{passenger,phone}' is null);
  reset role;

  -- Clearing the rider before confirming books for yourself again.
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'rid2_' || replace(gen_random_uuid()::text, '-', ''), false, null, null);
  perform public.set_booking_rider(v_b.id, 'Mama Musu', '+231770123456');
  perform public.set_booking_rider(v_b.id, null, null);
  r := r || jsonb_build_object('t06_rider_cleared', not exists (select 1 from public.booking_riders where booking_id = v_b.id));
  reset role;

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
