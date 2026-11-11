-- =====================================================================
-- LiberiaRide · Referrals test (migration 0035)
-- One DO block that ends by raising TEST_RESULT, so everything rolls back.
-- =====================================================================
do $test$
declare
  pa   uuid := gen_random_uuid();   -- referrer
  pb   uuid := gen_random_uuid();   -- referred, rewarded
  pc   uuid := gen_random_uuid();   -- referred after the referrer hit the cap
  d1   uuid := gen_random_uuid();
  v_car uuid := (select id from public.vehicle_categories where code = 'car');
  v_code_a text;
  v_est  public.fare_estimates;
  v_b    public.bookings;
  v_offer uuid;
  v_pin  text;
  v_coupon text;
  j      jsonb;
  who    uuid;
  r      jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@ref.invalid', '', '{}', '{"full_name":"Ref Tester"}', now(), now()
    from unnest(array[pa, pb, pc, d1]) u;
  insert into public.drivers(id, status, licence_number, is_online, went_online_at) values (d1, 'approved', 'REF-' || left(d1::text, 8), true, now());
  insert into public.vehicles(driver_id, category_id, make, model, color, plate_number, status)
  values (d1, v_car, 'Toyota', 'Corolla', 'Silver', 'RF1-' || left(d1::text, 6), 'approved');
  update public.drivers d set current_vehicle_id = v.id from public.vehicles v where v.driver_id = d.id and d.id = d1;
  insert into public.driver_locations(driver_id, location, accuracy_m, recorded_at, received_at)
  values (d1, public.make_point(6.3010, -10.7990), 10, now(), now());
  update public.configuration_settings set value = '"soft"' where key = 'dispatch.default_strategy';

  select referral_code into v_code_a from public.passengers where id = pa;
  r := r || jsonb_build_object('t01_code_generated', v_code_a ~ '^[A-Z2-9]{6}$');

  -- Applying codes.
  perform set_config('request.jwt.claims', json_build_object('sub', pb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.apply_referral_code('ZZZZZZ');
    failures := failures || 't02_bad_code_accepted';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t02_bad_code', true); end;
  begin
    perform public.apply_referral_code((select referral_code from public.passengers where id = pb));
    failures := failures || 't02_own_code_accepted';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t02_own_code', true); end;
  j := public.apply_referral_code(lower(v_code_a));
  r := r || jsonb_build_object('t02_applied', j->>'referrer' = 'Ref');
  begin
    perform public.apply_referral_code(v_code_a);
    failures := failures || 't02_applied_twice';
  exception when object_not_in_prerequisite_state then r := r || jsonb_build_object('t02_once_only', true); end;
  r := r || jsonb_build_object('t02_card', (public.my_referral()->>'can_apply')::boolean = false and public.my_referral()->>'referred_by' = 'Ref');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.apply_referral_code(v_code_a);
  reset role;

  -- B and C each take a first trip. Before C's, the referrer's monthly cap is 1 (already earned 1).
  foreach who in array array[pb, pc] loop
    if who = pc then update public.configuration_settings set value = '1' where key = 'referral.max_rewards_per_month'; end if;
    update public.driver_locations set location = public.make_point(6.3006, -10.7986), received_at = now() where driver_id = d1;
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction');
    v_b := public.create_booking(v_est.id, 'cash', 'ref_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
    reset role;
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
    perform public.driver_complete_trip(v_b.id);
    reset role;
  end loop;

  r := r || jsonb_build_object(
    't03_both_rewarded', (select referred_coupon_id is not null and referrer_coupon_id is not null from public.referral_rewards where referred_id = pb),
    't03_notified', (select count(*) from public.notifications where kind = 'referral.reward' and user_id in (pa, pb)) = 2,
    't04_cap_referred_still_rewarded', (select referred_coupon_id is not null from public.referral_rewards where referred_id = pc),
    't04_cap_referrer_skipped', (select referrer_coupon_id is null from public.referral_rewards where referred_id = pc));

  -- B's coupon works once, for 20 % off.
  select c.code into v_coupon from public.coupons c join public.referral_rewards rr on rr.referred_coupon_id = c.id where rr.referred_id = pb;
  perform set_config('request.jwt.claims', json_build_object('sub', pb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_est := public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction', '[]', null, null, v_coupon);
  r := r || jsonb_build_object('t05_coupon_discount', v_est.discount_minor = round(v_est.subtotal_minor * 0.2),
                               't05_listed_unused', (select bool_and(not (c->>'used')::boolean) from jsonb_array_elements(public.my_referral()->'coupons') c));
  v_b := public.create_booking(v_est.id, 'cash', 'ref_used_' || replace(gen_random_uuid()::text, '-', ''), true, null, null);
  r := r || jsonb_build_object('t05_listed_used', (select bool_and((c->>'used')::boolean) from jsonb_array_elements(public.my_referral()->'coupons') c));
  begin
    perform public.create_fare_estimate('car', 'USD', 6.3002, -10.7983, 'Capitol Hill', 6.2394, -10.7066, 'ELWA Junction', '[]', null, null, v_coupon);
    failures := failures || 't05_coupon_reused';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t05_single_use', sqlerrm); end;
  perform public.passenger_cancel_booking(v_b.id, 'test');
  begin
    perform public.apply_referral_code(v_code_a);
    failures := failures || 't06_applied_after_trip';
  exception when object_not_in_prerequisite_state then r := r || jsonb_build_object('t06_not_after_trip', true); end;
  reset role;

  -- The referrer's card.
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.my_referral();
  r := r || jsonb_build_object('t07_referrer_card', (j->>'friends_rewarded')::int = 2 and jsonb_array_length(j->'coupons') = 1);
  reset role;
  r := r || jsonb_build_object('t08_one_reward_per_rider', (select count(*) from public.referral_rewards where referred_id in (pb, pc)) = 2);

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
