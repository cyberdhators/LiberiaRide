-- =====================================================================
-- LiberiaRide · Ride categories & geofences admin test
-- One DO block that ends by raising TEST_RESULT (everything rolls back).
-- =====================================================================
do $test$
declare
  adm uuid := gen_random_uuid();
  pax uuid := gen_random_uuid();
  r jsonb := '{}'::jsonb;
  failures text[] := '{}';
  j jsonb;
  ria jsonb := '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-10.375,6.225],[-10.345,6.225],[-10.345,6.250],[-10.375,6.250],[-10.375,6.225]]]}}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@areas.invalid', '', '{}', '{}', now(), now()
    from unnest(array[adm, pax]) u;
  insert into public.user_roles(user_id, role) values (adm, 'admin');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_upsert_category('bus', 'Bus', 'Shared minibus', 14::smallint, 50::smallint, true); failures := failures || 't1_unpriced_activated';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t1_unpriced_blocked', true); end;
  perform public.admin_upsert_category('bus', 'Bus', 'Shared minibus', 14::smallint, 50::smallint, false);
  r := r || jsonb_build_object('t1_inactive_created', exists (select 1 from public.vehicle_categories where code = 'bus' and not is_active));
  perform public.admin_upsert_category('car', 'Car', 'Standard 4-seat car', 4::smallint, 20::smallint, true);
  begin perform public.admin_upsert_geofence('greater_monrovia', 'Greater Monrovia', 'service_area', null, false); failures := failures || 't2_last_area_off';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t2_last_area_kept', true); end;
  begin perform public.admin_upsert_geofence('x_bad', 'Bad', 'airport', '{"type":"Polygon","coordinates":[[1,2]]}'::jsonb, true); failures := failures || 't3_bad_geojson';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t3_bad_geojson_rejected', true); end;
  begin perform public.admin_upsert_geofence('x_far', 'Far', 'airport', '{"type":"Polygon","coordinates":[[[2,48],[3,48],[3,49],[2,48]]]}'::jsonb, true); failures := failures || 't3_outside_liberia';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t3_outside_rejected', true); end;
  j := public.admin_upsert_geofence('ria_airport', 'Roberts International Airport', 'airport', ria, true);
  r := r || jsonb_build_object('t4_airport_km2', j->'area_km2');
  perform public.admin_upsert_geofence('greater_monrovia', 'Greater Monrovia (renamed)', 'service_area', null, true);
  r := r || jsonb_build_object('t5_rename_keeps_shape', (select name = 'Greater Monrovia (renamed)' and not extensions.st_isempty(area::extensions.geometry) from public.geofences where code = 'greater_monrovia'));
  j := public.admin_geofences();
  r := r || jsonb_build_object('t6_list_has_geojson', jsonb_array_length(j) >= 2 and (j->0->'geojson'->>'type') = 'MultiPolygon');
  reset role;
  r := r || jsonb_build_object('t7_audited', (select count(*) from public.audit_logs where actor_id = adm and action in ('category.create','category.update','geofence.create','geofence.update')) = 4);

  perform set_config('request.jwt.claims', json_build_object('sub', pax, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_upsert_category('car', 'Hacked', null, 4::smallint, 1::smallint, true); failures := failures || 't8_passenger_edit';
  exception when insufficient_privilege then r := r || jsonb_build_object('t8_passenger_denied', true); end;
  begin perform public.admin_geofences(); failures := failures || 't8_passenger_read';
  exception when insufficient_privilege then r := r || jsonb_build_object('t8_passenger_read_denied', true); end;
  reset role;

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
