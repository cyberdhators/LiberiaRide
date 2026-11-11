-- =====================================================================
-- LiberiaRide · Fee waiver, wallet adjustment, fee commission test (migration 0030)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  drv  uuid := gen_random_uuid();
  adm  uuid := gen_random_uuid();
  v_est public.fare_estimates;
  v_b   public.bookings;
  v_pay uuid;
  v_p   public.payments;
  v_e   public.driver_wallet_entries;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@finops.invalid', '', '{}', '{}', now(), now()
    from unnest(array[pax, drv, adm]) u;
  insert into public.user_roles(user_id, role) values (adm, 'admin');
  insert into public.drivers(id, status, licence_number) values (drv, 'approved', 'FIN-' || left(drv::text, 8));

  -- A passenger with an unpaid fee and a ride already showing it.
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'fin_' || replace(gen_random_uuid()::text, '-', ''), false, null, null);
  reset role;
  insert into public.payments(booking_id, payer_id, method, provider, status, amount_minor, currency, idempotency_key)
  values (v_b.id, pax, 'cash', 'cash', 'pending', 100, 'USD', 'cancel-fee:' || v_b.id) returning id into v_pay;
  update public.bookings set outstanding_fee_minor = 100 where id = v_b.id;

  -- Only finance staff can waive, with a reason.
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_waive_fee(v_pay, 'driver says so');
    failures := failures || 't01_non_staff_waived';
  exception when insufficient_privilege then r := r || jsonb_build_object('t01_non_staff_blocked', true); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_waive_fee(v_pay, ' ');
    failures := failures || 't01_no_reason_waived';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t01_reason_required', true); end;
  v_p := public.admin_waive_fee(v_pay, 'Passenger was at the pickup; driver went to wrong gate');
  r := r || jsonb_build_object('t02_cancelled', v_p.status = 'cancelled' and v_p.failure_reason like 'waived:%');
  begin
    perform public.admin_waive_fee(v_pay, 'again');
    failures := failures || 't02_waived_twice';
  exception when object_not_in_prerequisite_state then r := r || jsonb_build_object('t02_only_once', true); end;
  reset role;
  r := r || jsonb_build_object(
    't02_removed_from_active_ride', (select outstanding_fee_minor = 0 from public.bookings where id = v_b.id),
    't02_passenger_notified', exists (select 1 from public.notifications where user_id = pax and kind = 'booking.fee_waived'),
    't02_audited', exists (select 1 from public.audit_logs where actor_id = adm and action = 'fee.waive'));
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('t02_not_carried_any_more', public.my_outstanding_fees() = '{}'::jsonb);
  reset role;

  -- Signed wallet adjustment.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_wallet_adjustment(drv, 'USD', 0, 'nothing');
    failures := failures || 't03_zero_adjustment';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t03_zero_refused', true); end;
  v_e := public.admin_wallet_adjustment(drv, 'USD', -250, 'Reverse duplicate top-up R-77');
  reset role;
  r := r || jsonb_build_object('t03_debit_recorded', v_e.kind = 'adjustment' and v_e.amount_minor = -250,
                               't03_balance', public.driver_balance(drv, 'USD') = -250,
                               't03_audited', exists (select 1 from public.audit_logs where actor_id = adm and action = 'wallet.adjust'),
                               't03_driver_notified', exists (select 1 from public.notifications where user_id = drv and kind = 'driver.wallet_adjustment'));
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_wallet_adjustment(drv, 'USD', 10000, 'pay myself');
    failures := failures || 't03_driver_adjusted_self';
  exception when insufficient_privilege then r := r || jsonb_build_object('t03_driver_cannot_adjust', true); end;
  reset role;

  -- Collected fee: the platform's share is recorded as commission against the cancelled booking.
  insert into public.driver_wallet_entries(driver_id, currency, kind, amount_minor, reference, booking_id)
  values (drv, 'USD', 'cancellation_fee', 85, 'cancel-fee:' || v_b.id, v_b.id);
  r := r || jsonb_build_object('t04_fee_commission', (select amount_minor = 15 and fare_minor = 100 and driver_id = drv
                                                        from public.platform_commissions where booking_id = v_b.id));

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
