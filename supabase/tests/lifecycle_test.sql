-- =====================================================================
-- LiberiaRide · Database lifecycle & security test
--
-- Runs entirely inside one DO block and ENDS BY RAISING an exception that
-- carries the JSON results, so every change is rolled back. Safe to run on
-- the development project.  Run: supabase/tests/run.md
--
-- Impersonation: request.jwt.claims + SET LOCAL ROLE authenticated, exactly
-- how PostgREST executes client calls, so RLS and EXECUTE grants apply.
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  pax2 uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  d2   uuid := gen_random_uuid();
  adm  uuid := gen_random_uuid();
  v_est   public.fare_estimates;
  v_b     public.bookings;
  v_b2    public.bookings;
  v_offer uuid;
  v_veh   uuid;
  v_doc   uuid;
  n       integer;
  j       jsonb;
  r       jsonb := '{}'::jsonb;
  failures text[] := '{}';
  idem    text := 'bk_test_' || replace(gen_random_uuid()::text, '-', '');

  procedure_name text;
begin
  -- ---------- helpers (inline) ----------
  -- as(uid):  set claims + role authenticated
  -- as_owner: reset role
  -- ---------------------------------------

  -- 0. Users (auth trigger creates profile + passenger role)
  insert into auth.users (instance_id, id, aud, role, email, phone, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', pax,  'authenticated', 'authenticated', null, '231770000001', '', '{}', '{"full_name":"Test Passenger"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', pax2, 'authenticated', 'authenticated', null, '231770000002', '', '{}', '{"full_name":"Other Passenger"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', d1,   'authenticated', 'authenticated', null, '231880000001', '', '{}', '{"full_name":"Driver One"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', d2,   'authenticated', 'authenticated', null, '231880000002', '', '{}', '{"full_name":"Driver Two"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', adm,  'authenticated', 'authenticated', 'ops@test.invalid', null, '', '{}', '{"full_name":"Ops Admin"}', now(), now());

  select count(*) into n from public.profiles where id in (pax, pax2, d1, d2, adm);
  r := r || jsonb_build_object('t00_profiles_created', n = 5);
  select phone into j from (select to_jsonb(phone) phone from public.profiles where id = pax) x;
  r := r || jsonb_build_object('t00_phone_normalised', j = '"+231770000001"'::jsonb);
  -- bootstrap_super_admin is a no-op once a real super admin exists; grant directly (rolled back).
  insert into public.user_roles(user_id, role) values (adm, 'admin'), (adm, 'super_admin') on conflict do nothing;

  -- 1. Driver onboarding (as each driver)
  foreach procedure_name in array array['d1', 'd2'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case procedure_name when 'd1' then d1 else d2 end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.register_driver('Driver ' || procedure_name, 'LIC-' || procedure_name || '-' || left(gen_random_uuid()::text, 6), current_date + 365, date '1990-01-01', 'Sinkor');
    perform public.register_vehicle('car', 'Toyota', 'Corolla', 2015::smallint, 'Silver', 'TST-' || procedure_name || left(gen_random_uuid()::text, 4), null);
    reset role;
  end loop;

  -- uploaded files (storage rows created directly by the owner for the test)
  insert into storage.objects (bucket_id, name, owner) values
    ('driver-documents', d1 || '/lic.jpg', d1), ('driver-documents', d1 || '/reg.jpg', d1),
    ('driver-documents', d2 || '/lic.jpg', d2), ('driver-documents', d2 || '/reg.jpg', d2);

  foreach procedure_name in array array['d1', 'd2'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case procedure_name when 'd1' then d1 else d2 end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.submit_driver_document('driver_licence', (case procedure_name when 'd1' then d1 else d2 end) || '/lic.jpg', 'image/jpeg', null, 'L1', current_date + 365);
    perform public.submit_driver_document('vehicle_registration', (case procedure_name when 'd1' then d1 else d2 end) || '/reg.jpg', 'image/jpeg', null, 'R1', current_date + 365);
    reset role;
  end loop;

  -- 1b. A pending driver cannot go online
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.driver_set_online(true);
    failures := failures || 't01_pending_driver_went_online';
  exception when others then
    r := r || jsonb_build_object('t01_pending_driver_blocked', sqlerrm);
  end;
  -- 1c. A driver cannot approve themself
  begin
    perform public.admin_review_driver(d1, 'approved', null);
    failures := failures || 't01_driver_self_approved';
  exception when others then
    r := r || jsonb_build_object('t01_self_approval_blocked', sqlerrm);
  end;
  -- 1d. Direct table write is impossible (no UPDATE privilege)
  begin
    update public.drivers set status = 'approved' where id = d1;
    failures := failures || 't01_direct_status_update';
  exception when others then
    r := r || jsonb_build_object('t01_direct_update_blocked', sqlerrm);
  end;
  reset role;

  -- 2. Admin approves documents, vehicles, drivers (audited)
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for v_doc in select id from public.driver_documents where driver_id in (d1, d2) loop
    perform public.admin_review_document(v_doc, 'approved', null);
  end loop;
  for v_veh in select id from public.vehicles where driver_id in (d1, d2) loop
    perform public.admin_review_vehicle(v_veh, 'approved', null);
  end loop;
  perform public.admin_review_driver(d1, 'approved', 'ok');
  perform public.admin_review_driver(d2, 'approved', 'ok');
  reset role;
  select count(*) into n from public.audit_logs where actor_id = adm;
  r := r || jsonb_build_object('t02_admin_actions_audited', n >= 8);

  -- 3. Drivers share GPS and go online. d1 ≈ 120 m from pickup, d2 ≈ 1.1 km.
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.driver_update_location(6.3010, -10.7990, 10, 90, 0, now());
  r := r || jsonb_build_object('t03_gps_accepted', (j->>'accepted')::boolean);
  j := public.driver_update_location(6.3011, -10.7991, 10, 90, 0, now());
  r := r || jsonb_build_object('t03_gps_throttled', j->>'reason' = 'throttled');
  perform public.driver_set_online(true);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.driver_update_location(6.3100, -10.8000, 400, null, null, now());
  r := r || jsonb_build_object('t03_low_accuracy_rejected', j->>'reason' = 'low_accuracy');
  perform public.driver_update_location(6.3100, -10.8000, 12, null, null, now());
  perform public.driver_set_online(true);
  reset role;

  -- 4. Passenger: estimate → booking (idempotent) → dispatch (soft)
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill, Monrovia',
                                       6.2394, -10.7066, 'ELWA Junction, Paynesville');
  r := r || jsonb_build_object('t04_estimate_total_minor', v_est.total_minor, 't04_estimate_distance_m', v_est.distance_m,
                               't04_route_source', v_est.route_source);
  begin
    perform public.create_fare_estimate('car', 'USD', 7.5, -9.0, 'Far away', 7.6, -9.1, 'Further');
    failures := failures || 't04_outside_service_area_accepted';
  exception when others then
    r := r || jsonb_build_object('t04_outside_service_area_blocked', sqlerrm);
  end;

  v_b := public.create_booking(v_est.id, 'cash', idem, true, null, null);
  r := r || jsonb_build_object('t04_booking_status_after_confirm', v_b.status, 't04_strategy', v_b.allocation_strategy);
  v_b2 := public.create_booking(v_est.id, 'cash', idem, true, null, null);
  r := r || jsonb_build_object('t04_idempotent_same_booking', v_b2.id = v_b.id);
  select count(*) into n from public.bookings where passenger_id = pax;
  r := r || jsonb_build_object('t04_single_booking_row', n = 1);
  begin
    update public.bookings set status = 'COMPLETED' where id = v_b.id;
    failures := failures || 't04_client_status_write';
  exception when others then
    r := r || jsonb_build_object('t04_client_status_write_blocked', sqlerrm);
  end;
  reset role;

  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  r := r || jsonb_build_object('t05_nearest_driver_offered', (select driver_id = d1 from public.booking_offers where id = v_offer));
  r := r || jsonb_build_object('t05_soft_reserved', (select reserved_driver_id = d1 from public.bookings where id = v_b.id));

  -- 5. RLS: d2 must not see the offer, the booking, or the passenger
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.booking_offers where id = v_offer;
  r := r || jsonb_build_object('t05_other_driver_sees_offer', n);
  select count(*) into n from public.bookings where id = v_b.id;
  r := r || jsonb_build_object('t05_other_driver_sees_booking', n);
  select count(*) into n from public.profiles where id = pax;
  r := r || jsonb_build_object('t05_other_driver_sees_passenger_profile', n);
  begin
    perform public.accept_offer(v_offer);
    failures := failures || 't05_other_driver_accepted_foreign_offer';
  exception when others then
    r := r || jsonb_build_object('t05_foreign_accept_blocked', sqlerrm);
  end;
  reset role;

  -- d1 (offered driver) sees the offer but NOT the booking row yet
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.booking_offers where id = v_offer;
  r := r || jsonb_build_object('t05_offered_driver_sees_offer', n);
  select count(*) into n from public.bookings where id = v_b.id;
  r := r || jsonb_build_object('t05_offered_driver_sees_booking_before_accept', n);

  -- 6. Accept (atomic) + double-accept rejected
  v_b := public.accept_offer(v_offer);
  r := r || jsonb_build_object('t06_status_after_accept', v_b.status);
  begin
    perform public.accept_offer(v_offer);
    failures := failures || 't06_double_accept';
  exception when others then
    r := r || jsonb_build_object('t06_double_accept_blocked', sqlerrm);
  end;
  select count(*) into n from public.bookings where id = v_b.id;
  r := r || jsonb_build_object('t06_assigned_driver_sees_booking', n);
  reset role;

  -- 6b. Uniqueness guard: a second active assignment is impossible even for the owner
  begin
    insert into public.booking_assignments(booking_id, driver_id, method) values (v_b.id, d2, 'manual');
    failures := failures || 't06_second_assignment_inserted';
  exception when unique_violation then
    r := r || jsonb_build_object('t06_second_assignment_unique_violation', true);
  end;

  -- 7. Passenger view (driver contact visible while active) and other passenger isolation
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_booking_view(v_b.id);
  r := r || jsonb_build_object('t07_view_driver_name', j #>> '{driver,name}', 't07_view_driver_phone_visible', (j #>> '{driver,phone}') is not null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bookings where id = v_b.id;
  r := r || jsonb_build_object('t07_other_passenger_sees_booking', n);
  begin
    perform public.get_booking_view(v_b.id);
    failures := failures || 't07_other_passenger_view';
  exception when others then
    r := r || jsonb_build_object('t07_other_passenger_view_blocked', sqlerrm);
  end;
  r := r || jsonb_build_object('t07_other_passenger_realtime_allowed', public.realtime_can_read('booking:' || v_b.id));
  reset role;

  -- 8. Trip: arriving → arrived → start → complete → cash → rating
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('t08_driver_realtime_booking', public.realtime_can_read('booking:' || v_b.id));
  perform public.driver_mark_arriving(v_b.id);
  perform public.driver_mark_arrived(v_b.id);
  reset role;
  select to_jsonb(pin) into j from public.booking_start_pins where booking_id = v_b.id;
  set local role authenticated;
  r := r || jsonb_build_object('t08_start_with_pin', public.driver_start_trip(v_b.id, j #>> '{}') ->> 'ok');
  v_b := public.driver_complete_trip(v_b.id);
  -- The driver ends the trip at the pickup (far from the destination) with no GPS track:
  -- billed on the distance actually driven (≈ 0 → minimum fare), never the full estimate.
  r := r || jsonb_build_object('t08_status_final', v_b.status, 't08_final_fare_minor', v_b.final_fare_minor,
                               't08_final_not_above_estimate', v_b.final_fare_minor <= v_est.total_minor,
                               't08_not_billed_from_estimate', (select distance_source in ('gps_track', 'straight_line') and billed_distance_m < v_est.distance_m
                                                                 from public.trips where booking_id = v_b.id));
  perform public.driver_confirm_cash_collected(v_b.id, v_b.final_fare_minor);
  reset role;

  select jsonb_build_object('gross', gross_minor, 'commission', commission_minor, 'net', net_minor) into j
    from public.driver_earnings where booking_id = v_b.id;
  r := r || jsonb_build_object('t08_earnings', j);
  r := r || jsonb_build_object('t08_payment_status', (select status from public.payments where booking_id = v_b.id and idempotency_key = 'fare:' || v_b.id));
  r := r || jsonb_build_object('t08_cash_reconciled', (select status from public.cash_reconciliation where booking_id = v_b.id));
  r := r || jsonb_build_object('t08_event_trail', (select jsonb_agg(to_status order by id) from public.booking_events where booking_id = v_b.id));

  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rate_booking(v_b.id, 5::smallint, array['clean_car'], 'Great');
  begin
    perform public.rate_booking(v_b.id, 1::smallint, '{}', null);
    failures := failures || 't08_double_rating';
  exception when unique_violation then
    r := r || jsonb_build_object('t08_double_rating_blocked', true);
  end;
  reset role;
  r := r || jsonb_build_object('t08_driver_rating', (select rating_avg from public.drivers where id = d1));

  -- 9. Anonymous role cannot read anything sensitive
  set local role anon;
  begin
    select count(*) into n from public.bookings;
    failures := failures || 't09_anon_read_bookings';
  exception when insufficient_privilege then
    r := r || jsonb_build_object('t09_anon_bookings_denied', true);
  end;
  select count(*) into n from public.vehicle_categories;
  r := r || jsonb_build_object('t09_anon_categories_visible', n);
  reset role;

  -- 10. Admin stats
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.admin_dashboard_stats();
  r := r || jsonb_build_object('t10_stats_completed', j->'rides_completed', 't10_stats_drivers_online', j->'drivers_online');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_dashboard_stats();
    failures := failures || 't10_passenger_read_stats';
  exception when others then
    r := r || jsonb_build_object('t10_passenger_stats_denied', true);
  end;
  reset role;

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
