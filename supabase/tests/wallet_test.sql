-- =====================================================================
-- LiberiaRide · Driver wallet, debt limit & fee carry-over test (migration 0029)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- Drivers are set up directly as the owner (see trust_test.sql).
-- =====================================================================
do $test$
declare
  pax  uuid := gen_random_uuid();
  pax2 uuid := gen_random_uuid();
  d1   uuid := gen_random_uuid();
  d2   uuid := gen_random_uuid();
  adm  uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_est public.fare_estimates;
  v_b   public.bookings;
  v_offer uuid;
  v_pin text;
  v_comm bigint;
  v_fee  bigint;
  v_bal  bigint;
  v_q    bigint;
  n     integer;
  j     jsonb;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
  v_set public.driver_settlements;
  v_e1  public.driver_wallet_entries;
  v_e2  public.driver_wallet_entries;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@wallet.invalid', '', '{}', '{"full_name":"Wallet Test"}', now(), now()
    from unnest(array[pax, pax2, d1, d2, adm]) u;
  insert into public.user_roles(user_id, role) values (adm, 'admin');
  insert into public.drivers(id, status, licence_number, licence_expiry, is_online, went_online_at)
  values (d1, 'approved', 'WAL-' || left(d1::text, 8), current_date + 365, true, now()),
         (d2, 'approved', 'WAL-' || left(d2::text, 8), current_date + 365, true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'WL1-' || left(d1::text, 6), 'approved'),
         (d2, v_car, 'Toyota', 'Yaris', 'White', 'WL2-' || left(d2::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id in (d1, d2);
  insert into public.driver_documents(driver_id, doc_type, storage_path, mime_type, status, expires_at)
  select d, t, d::text || '/' || t::text || '.jpg', 'image/jpeg', 'approved', current_date + 365
    from unnest(array[d1, d2]) d, unnest(array['driver_licence', 'vehicle_registration']::public.document_type[]) t;
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now()),
         (d2, public.make_point(6.3100, -10.8000), 10, now(), now());
  update public.configuration_settings set value = '"soft"' where key = 'dispatch.default_strategy';
  update public.configuration_settings set value = '10' where key = 'wallet.max_debt_minor_usd';

  -- ---------- Trip 1 (cash, d1): the commission becomes debt ----------
  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'wal_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  reset role;
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending' and driver_id = d1;
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
  select commission_minor into v_comm from public.driver_earnings where booking_id = v_b.id;
  r := r || jsonb_build_object('t01_balance_is_minus_commission', public.driver_balance(d1, 'USD') = -v_comm,
                               't01_over_limit', public.driver_over_debt_limit(d1));

  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.driver_wallet();
  r := r || jsonb_build_object('t01_wallet_blocked', (j->>'blocked')::boolean,
                               't01_wallet_usd', (select (b->>'balance_minor')::bigint = -v_comm from jsonb_array_elements(j->'balances') b where b->>'currency' = 'USD'));
  begin
    perform public.driver_set_online(true);
    failures := failures || 't02_online_over_limit';
  exception when insufficient_privilege then r := r || jsonb_build_object('t02_online_blocked', sqlerrm); end;
  reset role;

  -- ---------- Over-limit driver gets no offers ----------
  update public.driver_locations set location = public.make_point(6.3004, -10.7985), received_at = now() where driver_id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'wal_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  reset role;
  r := r || jsonb_build_object('t03_offer_skips_debtor', (select driver_id = d2 from public.booking_offers where booking_id = v_b.id and status = 'pending'));

  -- ---------- No-show fee on d2, carried to pax2's next ride ----------
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  update public.driver_locations set location = public.make_point(6.3004, -10.7985), received_at = now() where driver_id = d2;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  perform public.driver_mark_arrived(v_b.id);
  reset role;
  update public.bookings set arrived_at = now() - interval '10 minutes' where id = v_b.id;
  set local role authenticated;
  perform public.driver_cancel_booking(v_b.id, 'passenger_no_show');
  reset role;
  select amount_minor into v_fee from public.payments where idempotency_key = 'cancel-fee:' || v_b.id and status = 'pending';
  r := r || jsonb_build_object('t04_fee_pending', v_fee = 100);

  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('t04_my_outstanding', public.my_outstanding_fees() = jsonb_build_object('USD', v_fee));
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
  v_b := public.create_booking(v_est.id, 'cash', 'wal_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  r := r || jsonb_build_object('t05_snapshot_on_booking', v_b.outstanding_fee_minor = v_fee,
                               't05_shown_in_view', (public.get_booking_view(v_b.id)->>'outstanding_fee_minor')::bigint = v_fee);
  reset role;
  select id into v_offer from public.booking_offers where booking_id = v_b.id and status = 'pending';
  r := r || jsonb_build_object('t05_offered_to_d2', (select driver_id = d2 from public.booking_offers where id = v_offer));
  select pin into v_pin from public.booking_start_pins where booking_id = v_b.id;
  select public.driver_balance(d2, 'USD') into v_bal;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_offer(v_offer);
  perform public.driver_mark_arrived(v_b.id);
  perform public.driver_start_trip(v_b.id, v_pin);
  reset role;
  update public.driver_locations set location = public.make_point(6.2396, -10.7068), received_at = now() where driver_id = d2;
  set local role authenticated;
  v_b := public.driver_complete_trip(v_b.id);
  reset role;
  select commission_minor into v_comm from public.driver_earnings where booking_id = v_b.id;
  r := r || jsonb_build_object(
    't06_fare_includes_fee', v_b.final_fare_minor = v_est.total_minor + v_fee,
    't06_breakdown_line', (select cancellation_minor = v_fee and total_minor = v_b.final_fare_minor from public.fare_breakdowns where booking_id = v_b.id and kind = 'final'),
    't06_old_fee_paid', not exists (select 1 from public.payments where payer_id = pax2 and idempotency_key like 'cancel-fee:%' and status = 'pending'),
    't06_cancelled_on_driver_credited', (select amount_minor = 85 and kind = 'cancellation_fee' from public.driver_wallet_entries where driver_id = d2),
    -- d2 holds trip cash incl. the fee, keeps the trip net and is credited 85 of the fee.
    't06_d2_balance', public.driver_balance(d2, 'USD') = v_bal - v_comm - v_fee + 85);
  perform set_config('request.jwt.claims', json_build_object('sub', pax2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('t06_nothing_outstanding', public.my_outstanding_fees() = '{}'::jsonb);
  reset role;

  -- ---------- Top-up (finance staff only, idempotent) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_record_driver_topup(d1, 'USD', 500, 'cash', 'R-001', null);
    failures := failures || 't07_driver_topped_up_self';
  exception when insufficient_privilege then r := r || jsonb_build_object('t07_driver_cannot_topup', true); end;
  begin
    perform * from public.admin_driver_balances();
    failures := failures || 't07_driver_read_all_balances';
  exception when insufficient_privilege then r := r || jsonb_build_object('t07_balances_staff_only', true); end;
  reset role;
  select public.driver_balance(d1, 'USD') into v_bal;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_e1 := public.admin_record_driver_topup(d1, 'USD', 500, 'cash', 'R-001', 'Paid at office');
  v_e2 := public.admin_record_driver_topup(d1, 'USD', 500, 'cash', 'R-001', 'Paid at office');
  r := r || jsonb_build_object('t07_idempotent', v_e1.id = v_e2.id);
  begin
    perform public.admin_record_driver_topup(d1, 'USD', 900, 'cash', 'R-001', null);
    failures := failures || 't07_reference_reused';
  exception when unique_violation then r := r || jsonb_build_object('t07_reference_reuse_blocked', true); end;
  select count(*) into n from public.admin_driver_balances() b where b.driver_id in (d1, d2);
  r := r || jsonb_build_object('t07_admin_sees_balances', n = 2);
  reset role;
  r := r || jsonb_build_object('t07_balance_up', public.driver_balance(d1, 'USD') = v_bal + 500,
                               't07_unblocked', not public.driver_over_debt_limit(d1),
                               't07_audited', exists (select 1 from public.audit_logs where actor_id = adm and action = 'wallet.topup'),
                               't07_driver_notified', exists (select 1 from public.notifications where user_id = d1 and kind = 'driver.wallet_topup'));
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('t07_back_online', (public.driver_set_online(true)).is_online);
  reset role;

  -- ---------- Settlement agrees with the wallet ----------
  select public.driver_balance(d2, 'USD') into v_bal;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_set := public.admin_create_settlement(d2, 'USD');
  reset role;
  r := r || jsonb_build_object('t08_settlement_equals_balance', v_set.net_payable_minor = v_bal,
                               't08_includes_fee_credit', v_set.adjustments_minor = 85,
                               't08_balance_unchanged_while_pending', public.driver_balance(d2, 'USD') = v_bal);
  set local role authenticated;
  perform public.admin_mark_settlement_paid(v_set.id, 'PAY-1');
  reset role;
  r := r || jsonb_build_object('t08_paid_clears_balance', public.driver_balance(d2, 'USD') = 0);

  -- ---------- Push kick (0028 review): only when queued, once per transaction ----------
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth_secret) values
    (d1, 'https://fcm.googleapis.com/fcm/send/wallet-test-' || d1, 'BPfakefakefakefakefakefakefakefake', 'fakeauthsecret');
  select count(*) into v_q from net.http_request_queue;
  insert into public.notifications(user_id, kind, title, body, data) values (pax, 'x.test', 'No device', null, '{}');
  r := r || jsonb_build_object('t09_no_kick_without_device', (select count(*) from net.http_request_queue) = v_q);
  insert into public.notifications(user_id, kind, title, body, data) values (d1, 'x.test', 'One', null, '{}'), (d1, 'x.test', 'Two', null, '{}');
  r := r || jsonb_build_object('t09_queued_two', (select count(*) from public.push_outbox where user_id = d1 and kind = 'x.test') = 2,
                               't09_kicked_once', (select count(*) from net.http_request_queue) - v_q
                                                          = case when public.config_text('push.dispatch_url') = '' then 0 else 1 end);

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
