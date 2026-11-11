-- =====================================================================
-- LiberiaRide · Scheduled rides test (migrations 0031–0032)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  pax2 uuid := gen_random_uuid();
  ops  uuid := gen_random_uuid();
  b    uuid[] := '{}';
  v_est public.fare_estimates;
  v_b   public.bookings;
  i     integer;
  n     integer;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@sched.invalid', '', '{}', '{}', now(), now()
    from unnest(array[pax, pax2, ops]) u;
  insert into public.user_roles(user_id, role) values (ops, 'support_agent');

  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- Four priced, unconfirmed bookings in a row (each one is scheduled before the next is created).
  for i in 1..4 loop
    v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
    v_b := public.create_booking(v_est.id, 'cash', 'sch_' || i || '_' || replace(gen_random_uuid()::text, '-', ''), false, null, null);
    b := b || v_b.id;
    if i = 1 then
      begin
        perform public.schedule_booking(v_b.id, now() + interval '5 minutes');
        failures := failures || 't01_too_soon_accepted';
      exception when invalid_parameter_value then r := r || jsonb_build_object('t01_too_soon', sqlerrm); end;
      begin
        perform public.schedule_booking(v_b.id, now() + interval '30 days');
        failures := failures || 't01_too_far_accepted';
      exception when invalid_parameter_value then r := r || jsonb_build_object('t01_too_far', sqlerrm); end;
    end if;
    if i < 4 then
      v_b := public.schedule_booking(v_b.id, now() + make_interval(hours => i + 1) + interval '17 seconds');
      if i = 1 then
        r := r || jsonb_build_object('t02_scheduled', v_b.status = 'SCHEDULED' and extract(second from v_b.scheduled_for) = 0);
        r := r || jsonb_build_object('t02_idempotent', (public.schedule_booking(v_b.id, v_b.scheduled_for)).id = v_b.id);
      end if;
    else
      begin
        perform public.schedule_booking(v_b.id, now() + interval '6 hours');
        failures := failures || 't03_fourth_scheduled';
      exception when object_not_in_prerequisite_state then r := r || jsonb_build_object('t03_max_three', sqlerrm); end;
    end if;
  end loop;
  select count(*) into n from public.my_scheduled_rides();
  r := r || jsonb_build_object('t03_upcoming_list', n = 3);
  perform public.passenger_cancel_booking(b[4], 'changed my mind');

  -- A scheduled ride is not "active": the passenger can still book now.
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'sch_now_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  r := r || jsonb_build_object('t04_can_ride_now', v_b.status in ('SEARCHING_DRIVER', 'DRIVER_OFFERED'));
  perform public.passenger_cancel_booking(v_b.id, 'test');

  -- Cancelling a scheduled ride costs nothing.
  v_b := public.passenger_cancel_booking(b[3], 'plans changed');
  r := r || jsonb_build_object('t05_cancel_free', v_b.status = 'CANCELLED' and v_b.cancellation_fee_minor = 0
                                and not exists (select 1 from public.payments where booking_id = b[3]));
  reset role;

  -- Another passenger cannot touch it; an operator with bookings.create can.
  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.schedule_booking(b[1], now() + interval '5 hours');
    failures := failures || 't06_foreign_schedule';
  exception when no_data_found then r := r || jsonb_build_object('t06_foreign_blocked', true); end;
  select count(*) into n from public.my_scheduled_rides();
  r := r || jsonb_build_object('t06_foreign_list_empty', n = 0);
  reset role;
  r := r || jsonb_build_object('t06_operator_may_schedule', exists (
    select 1 from public.role_permissions where role = 'support_agent' and permission = 'bookings.create'));

  -- Release: due → dispatch, with its own search window and a notification.
  update public.bookings set scheduled_for = now() + interval '5 minutes' where id = b[1];
  n := public.release_scheduled_bookings();
  select * into v_b from public.bookings where id = b[1];
  r := r || jsonb_build_object('t07_released', n = 1 and v_b.status in ('SEARCHING_DRIVER', 'DRIVER_OFFERED'),
    't07_search_window', v_b.search_expires_at = v_b.scheduled_for + interval '10 minutes',
    't07_notified', exists (select 1 from public.notifications where user_id = pax and kind = 'booking.scheduled_released'));

  -- Passenger busy with b[1]: b[2] waits, then expires 10 min after its time.
  update public.bookings set scheduled_for = now() + interval '1 minute' where id = b[2];
  n := public.release_scheduled_bookings();
  r := r || jsonb_build_object('t08_waits_while_busy', n = 0 and (select status from public.bookings where id = b[2]) = 'SCHEDULED');
  update public.bookings set scheduled_for = now() - interval '20 minutes' where id = b[2];
  perform public.release_scheduled_bookings();
  r := r || jsonb_build_object('t08_expires_late', (select status from public.bookings where id = b[2]) = 'EXPIRED',
    't08_told', exists (select 1 from public.notifications where user_id = pax and title = 'Scheduled ride not started'));

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
