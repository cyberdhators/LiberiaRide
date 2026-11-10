-- =====================================================================
-- LiberiaRide · Push alerts & offline track test (migration 0028)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back
-- (including any pg_net request queued by the outbox trigger).
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  d2   uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_est public.fare_estimates;
  v_b   public.bookings;
  v_offer uuid;
  v_pin text;
  v_ep  text := 'https://fcm.googleapis.com/fcm/send/test-' || replace(gen_random_uuid()::text, '-', '');
  n     integer;
  j     jsonb;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
  fn    text;
begin
  -- Privileges: dispatcher RPCs are service-role only.
  foreach fn in array array['public.push_claim_batch(integer)', 'public.push_vapid()', 'public.push_check_key(text)',
                            'public.push_set_vapid(jsonb, text)', 'public.push_report(jsonb)', 'public._push_kick()',
                            'public._push_enqueue(uuid, text, text, text, jsonb, boolean, integer)'] loop
    if has_function_privilege('authenticated', fn, 'execute') or has_function_privilege('anon', fn, 'execute') then
      failures := failures || ('t00_api_can_execute ' || fn);
    end if;
  end loop;
  r := r || jsonb_build_object('t00_service_role_claims', has_function_privilege('service_role', 'public.push_claim_batch(integer)', 'execute'),
                               't00_user_subscribes', has_function_privilege('authenticated', 'public.push_subscribe(text, text, text, text)', 'execute'),
                               't00_anon_cannot_subscribe', not has_function_privilege('anon', 'public.push_subscribe(text, text, text, text)', 'execute'),
                               't00_wrong_key_refused', not public.push_check_key(repeat('x', 64)));

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@push.invalid', '', '{}', '{"full_name":"Push Test"}', now(), now()
    from unnest(array[pax, d1, d2]) u;
  insert into public.drivers(id, status, licence_number, licence_expiry, is_online, went_online_at)
  values (d1, 'approved', 'PUSH-' || left(d1::text, 8), current_date + 365, true, now()),
         (d2, 'approved', 'PUSH-' || left(d2::text, 8), current_date + 365, true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'PS1-' || left(d1::text, 6), 'approved'),
         (d2, v_car, 'Toyota', 'Yaris', 'White', 'PS2-' || left(d2::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id in (d1, d2);
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now()),
         (d2, public.make_point(6.3100, -10.8000), 10, now(), now());
  update public.configuration_settings set value = '"broadcast"' where key = 'dispatch.default_strategy';

  -- ---------- Subscriptions ----------
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.push_subscribe('https://evil.example.com/collect', 'BPfakefakefakefakefakefakefakefake', 'fakeauthsecret', null);
    failures := failures || 't01_arbitrary_host_accepted';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t01_arbitrary_host_refused', true); end;
  perform public.push_subscribe(v_ep, 'BPfakefakefakefakefakefakefakefake', 'fakeauthsecret', 'test-agent');
  select count(*) into n from public.push_subscriptions;
  r := r || jsonb_build_object('t01_owner_sees_own', n = 1);
  begin
    perform p256dh from public.push_subscriptions limit 1;
    failures := failures || 't01_keys_readable';
  exception when insufficient_privilege then r := r || jsonb_build_object('t01_keys_not_readable', true); end;
  begin
    perform 1 from public.push_outbox limit 1;
    failures := failures || 't01_outbox_readable';
  exception when insufficient_privilege then r := r || jsonb_build_object('t01_outbox_not_readable', true); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.push_subscriptions;
  r := r || jsonb_build_object('t01_other_user_sees_none', n = 0);
  reset role;

  -- ---------- Offer → push only to the subscribed driver ----------
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'push_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  reset role;
  r := r || jsonb_build_object('t02_offers', (select count(*) from public.booking_offers where booking_id = v_b.id and status = 'pending'),
    't02_d1_offer_push', (select count(*) = 1 and bool_and(urgent) and bool_and(ttl_seconds between 1 and 60) and bool_and(title = 'New ride request')
                            from public.push_outbox where user_id = d1 and kind = 'offer'),
    't02_unsubscribed_d2_none', not exists (select 1 from public.push_outbox where user_id = d2));

  -- The service worker's fetch: own rows once, then nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.push_take_recent();
  r := r || jsonb_build_object('t03_take_recent_first', n = 1);
  select count(*) into n from public.push_take_recent();
  r := r || jsonb_build_object('t03_take_recent_again_empty', n = 0);
  reset role;

  -- Dispatcher claims undelivered rows joined with the device; 410 removes the device.
  update public.push_outbox set dispatched_at = null where user_id = d1;
  select jsonb_agg(to_jsonb(c)) into j from public.push_claim_batch(50) c;
  r := r || jsonb_build_object('t04_claimed', jsonb_array_length(j) = 1 and j->0->>'endpoint' = v_ep and (j->0->>'urgent')::boolean);
  r := r || jsonb_build_object('t04_claim_marks_dispatched', not exists (select 1 from public.push_outbox where user_id = d1 and dispatched_at is null));
  select count(*) into n from public.push_claim_batch(50);
  r := r || jsonb_build_object('t04_second_claim_empty', n = 0);

  -- ---------- Driver accepts; passenger subscribes; arrival → passenger push ----------
  select id into v_offer from public.booking_offers where booking_id = v_b.id and driver_id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.push_subscribe(v_ep || 'p', 'BPfakefakefakefakefakefakefakefake', 'fakeauthsecret', null);
  reset role;
  update public.driver_locations set location = public.make_point(6.3006, -10.7986), received_at = now() where driver_id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.driver_mark_arrived(v_b.id);
  reset role;
  r := r || jsonb_build_object('t05_arrival_push', exists (select 1 from public.push_outbox where user_id = pax and kind = 'booking.driver_arrived'
                                                            and body like '%PS1-%' and urgent));
  insert into public.notifications(user_id, kind, title, body, data) values (pax, 'test.kind', 'Hello', 'World', '{}');
  r := r || jsonb_build_object('t05_notification_push', exists (select 1 from public.push_outbox where user_id = pax and kind = 'test.kind'));

  -- ---------- Offline track upload ----------
  select pin into v_pin from public.booking_start_pins where booking_id = v_b.id;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.driver_upload_track(v_b.id, '[{"lat":6.3,"lng":-10.79,"accuracy_m":10,"recorded_at":"2020-01-01T00:00:00Z"}]');
  r := r || jsonb_build_object('t06_not_in_progress', j->>'reason' = 'trip_not_in_progress');
  perform public.driver_start_trip(v_b.id, v_pin);
  j := public.driver_upload_track(v_b.id, jsonb_build_array(
    jsonb_build_object('lat', 6.3006, 'lng', -10.7986, 'accuracy_m', 8, 'speed_mps', 9, 'recorded_at', now()),
    jsonb_build_object('lat', 6.3000, 'lng', -10.7980, 'accuracy_m', 8, 'speed_mps', 9, 'recorded_at', now() + interval '10 seconds'),
    jsonb_build_object('lat', 6.2994, 'lng', -10.7974, 'accuracy_m', 8, 'speed_mps', 9, 'recorded_at', now() + interval '20 seconds'),
    jsonb_build_object('lat', 6.2994, 'lng', -10.7974, 'accuracy_m', 8, 'recorded_at', now() + interval '20 seconds'),      -- duplicate
    jsonb_build_object('lat', 6.2500, 'lng', -10.7000, 'accuracy_m', 8, 'recorded_at', now() + interval '25 seconds'),      -- 12 km in 5 s
    jsonb_build_object('lat', 6.3000, 'lng', -10.7980, 'accuracy_m', 99999, 'recorded_at', now() + interval '15 seconds'),  -- inaccurate
    jsonb_build_object('lat', 6.3000, 'lng', -10.7980, 'accuracy_m', 8, 'recorded_at', now() - interval '1 hour'),          -- before start
    jsonb_build_object('lat', 'x', 'lng', -10.7980, 'accuracy_m', 8, 'recorded_at', now() + interval '5 seconds')));         -- garbage
  r := r || jsonb_build_object('t06_upload', j, 't06_upload_counts', (j->>'accepted')::int = 3 and (j->>'rejected')::int = 5);
  begin
    perform public.driver_upload_track(v_b.id, (select jsonb_agg(jsonb_build_object('lat', 6.3, 'lng', -10.79, 'accuracy_m', 5, 'recorded_at', now()))
                                                  from generate_series(1, 301)));
    failures := failures || 't06_oversized_batch';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t06_batch_limit', true); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.driver_upload_track(v_b.id, '[]');
    failures := failures || 't06_other_driver_uploaded';
  exception when others then r := r || jsonb_build_object('t06_other_driver_blocked', sqlerrm); end;
  reset role;
  r := r || jsonb_build_object('t06_points_stored', (select count(*) from public.trip_locations tl join public.trips t on t.id = tl.trip_id
                                                       where t.booking_id = v_b.id) = 3);

  -- ---------- Dead device cleanup ----------
  perform public.push_report(jsonb_build_array(jsonb_build_object('subscription_id', (select id from public.push_subscriptions where endpoint = v_ep), 'status', 410)));
  r := r || jsonb_build_object('t07_gone_device_removed', not exists (select 1 from public.push_subscriptions where endpoint = v_ep));

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
