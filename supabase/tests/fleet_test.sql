-- =====================================================================
-- LiberiaRide · Fleet management test
-- One DO block that ends by raising TEST_RESULT (everything rolls back).
-- Requires that no super admin exists yet (uses bootstrap_super_admin).
-- =====================================================================
do $test$
declare
  sup  uuid := gen_random_uuid();
  op   uuid := gen_random_uuid();
  drv  uuid := gen_random_uuid();
  drv2 uuid := gen_random_uuid();
  out_ uuid := gen_random_uuid();
  v_f   public.fleets;
  v_old text;
  j     jsonb;
  n     integer;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@fleet.invalid', '', '{}', '{"full_name":"Fleet Test"}', now(), now()
    from unnest(array[sup, op, drv, drv2, out_]) u;
  perform public.bootstrap_super_admin(sup);
  foreach j in array array[to_jsonb(drv), to_jsonb(drv2)] loop
    perform set_config('request.jwt.claims', json_build_object('sub', j #>> '{}', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.register_driver('Fleet Driver', 'FLT-' || left(gen_random_uuid()::text, 8), current_date + 365, date '1990-01-01', 'Sinkor');
    reset role;
  end loop;

  -- 1. admin creates fleet → owner becomes fleet operator
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_f := public.admin_create_fleet(op, 'Sinkor Keke Co');
  reset role;
  r := r || jsonb_build_object('t1_operator_role', exists (select 1 from public.user_roles where user_id = op and role = 'fleet_operator'),
                               't1_code_format', v_f.join_code ~ '^[0-9A-F]{8}$');

  -- 2. driver joins with code (lower-case, spaces ok); wrong code rejected
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.driver_join_fleet('NOPE0000'); failures := failures || 't2_bad_code_accepted';
  exception when no_data_found then r := r || jsonb_build_object('t2_bad_code_rejected', true); end;
  perform public.driver_join_fleet('  ' || lower(v_f.join_code) || ' ');
  reset role;
  r := r || jsonb_build_object('t2_joined', (select fleet_id from public.drivers where id = drv) = v_f.id,
    't2_owner_notified', exists (select 1 from public.notifications where user_id = op and kind = 'fleet.driver_joined'));

  -- 3. operator sees the driver (RPC + RLS), cannot remove a driver outside the fleet
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.fleet_overview();
  r := r || jsonb_build_object('t3_overview', jsonb_array_length(j) = 1 and jsonb_array_length(j -> 0 -> 'drivers') = 1);
  select count(*) into n from public.drivers where id in (drv, drv2);
  r := r || jsonb_build_object('t3_rls_only_own_drivers', n = 1);
  begin perform public.fleet_remove_driver(drv2); failures := failures || 't3_removed_outsider';
  exception when insufficient_privilege then r := r || jsonb_build_object('t3_cannot_remove_outsider', true); end;
  -- 4. rotating the code invalidates the old one
  v_old := v_f.join_code;
  perform public.fleet_regenerate_code(v_f.id);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.driver_join_fleet(v_old); failures := failures || 't4_old_code_accepted';
  exception when no_data_found then r := r || jsonb_build_object('t4_old_code_rejected', true); end;
  reset role;

  -- 5. outsider (no fleet role, not a driver)
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.fleet_overview(); failures := failures || 't5_outsider_overview';
  exception when insufficient_privilege then r := r || jsonb_build_object('t5_outsider_overview_denied', true); end;
  begin perform public.driver_join_fleet(v_old); failures := failures || 't5_outsider_joined';
  exception when insufficient_privilege then r := r || jsonb_build_object('t5_non_driver_cannot_join', true); end;
  reset role;

  -- 6. driver leaves (history kept); operator loses visibility
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.driver_leave_fleet();
  reset role;
  r := r || jsonb_build_object('t6_left', (select fleet_id from public.drivers where id = drv) is null,
    't6_history', (select left_at is not null from public.fleet_drivers where driver_id = drv and fleet_id = v_f.id));
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.drivers where id = drv;
  reset role;
  r := r || jsonb_build_object('t6_rls_hidden_after_leave', n = 0);

  -- 7. rejoin with the new code, operator removes → driver notified
  select join_code into v_old from public.fleets where id = v_f.id;
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.driver_join_fleet(v_old);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.fleet_remove_driver(drv);
  reset role;
  r := r || jsonb_build_object('t7_removed', (select fleet_id from public.drivers where id = drv) is null,
    't7_driver_notified', exists (select 1 from public.notifications where user_id = drv and kind = 'driver.fleet_removed'),
    't7_audited', (select count(*) from public.audit_logs where entity_type = 'fleets' and entity_id = v_f.id::text) >= 6);

  -- 8. anon cannot call anything
  set local role anon;
  begin perform public.driver_join_fleet(v_old); failures := failures || 't8_anon_called';
  exception when insufficient_privilege then r := r || jsonb_build_object('t8_anon_denied', true); end;
  reset role;

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
