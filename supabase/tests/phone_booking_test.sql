-- =====================================================================
-- LiberiaRide · Call-centre booking test (migration 0036)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- =====================================================================
do $test$
declare
  ops  uuid := gen_random_uuid();
  pax  uuid := gen_random_uuid();
  pax2 uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_est public.fare_estimates;
  v_b   public.bookings;
  v_b2  public.bookings;
  v_offer uuid;
  j     jsonb;
  idem  text := 'cc_' || replace(gen_random_uuid()::text, '-', '');
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, phone, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ops,   'authenticated', 'authenticated', 'ops@cc.invalid', null, '', '{}', '{"full_name":"Call Agent"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', pax,   'authenticated', 'authenticated', null, '231770004444', '', '{}', '{"full_name":"Caller One"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', pax2,  'authenticated', 'authenticated', null, '231770005555', '', '{}', '{"full_name":"Caller Two"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', other, 'authenticated', 'authenticated', 'other@cc.invalid', null, '', '{}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', d1,    'authenticated', 'authenticated', 'd1@cc.invalid', null, '', '{}', '{"full_name":"Driver Doe"}', now(), now());
  insert into public.user_roles(user_id, role) values (ops, 'support_agent');
  insert into public.drivers(id, status, licence_number, is_online, went_online_at) values (d1, 'approved', 'CC-' || left(d1::text, 8), true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'CC1-' || left(d1::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id = d1;
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now());
  update public.configuration_settings set value = '"soft"' where key = 'dispatch.default_strategy';

  -- The server prices the trip for the caller (service role in the app; owner here).
  v_est := public.create_fare_estimate_for(pax, 'car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');

  -- Not everyone may book for others.
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_create_booking_for(pax, v_est.id, 'cash', idem, null, null);
    failures := failures || 't01_passenger_booked_for_other';
  exception when insufficient_privilege then r := r || jsonb_build_object('t01_permission_required', true); end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_b := public.admin_create_booking_for(pax, v_est.id, 'cash', idem, 'Caller at the blue gate', null);
  v_b2 := public.admin_create_booking_for(pax, v_est.id, 'cash', idem, 'Caller at the blue gate', null);
  r := r || jsonb_build_object('t02_booked', v_b.channel = 'admin' and v_b.status in ('SEARCHING_DRIVER', 'DRIVER_OFFERED')
                                             and v_b.passenger_id = pax and v_b.passenger_note = 'Caller at the blue gate',
                               't02_idempotent', v_b2.id = v_b.id);
  begin
    perform public.admin_create_booking_for(ops, v_est.id, 'cash', 'cc_self_' || idem, null, null);
    failures := failures || 't02_booked_for_self';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t02_not_for_self', true); end;
  reset role;
  r := r || jsonb_build_object('t02_created_by_operator', (select created_by = ops from public.bookings where id = v_b.id),
                               't02_audited', exists (select 1 from public.audit_logs where actor_id = ops and action = 'booking.create_for'));

  -- No PIN for a caller without the app: the driver starts at the pickup.
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  j := public.get_booking_view(v_b.id);
  r := r || jsonb_build_object('t03_driver_gets_caller_phone', j #>> '{passenger,phone}' = '+231770004444');
  perform public.driver_mark_arrived(v_b.id);
  j := public.driver_start_trip(v_b.id, null);
  r := r || jsonb_build_object('t03_started_without_pin', (j->>'ok')::boolean and j->>'status' = 'IN_PROGRESS');
  reset role;

  -- Scheduling for a caller.
  v_est := public.create_fare_estimate_for(pax2, 'car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_b := public.admin_create_booking_for(pax2, v_est.id, 'cash', 'cc2_' || idem, null, now() + interval '3 hours');
  reset role;
  r := r || jsonb_build_object('t04_scheduled_for_caller', v_b.status = 'SCHEDULED' and (select created_by = ops from public.bookings where id = v_b.id));

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
