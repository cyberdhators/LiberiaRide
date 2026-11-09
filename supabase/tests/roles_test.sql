-- =====================================================================
-- LiberiaRide · Role management test (admin_set_role)
--
-- Same pattern as lifecycle_test.sql: one DO block that ends by raising
-- TEST_RESULT, so everything is rolled back. Requires that no super admin
-- exists yet (uses bootstrap_super_admin) — run on the development project.
-- =====================================================================
do $test$
declare
  sup   uuid := gen_random_uuid();
  adm   uuid := gen_random_uuid();
  agent uuid := gen_random_uuid();
  usr   uuid := gen_random_uuid();
  n     integer;
  r     jsonb := '{}'::jsonb;
  failures text[] := '{}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', u::text || '@roles.invalid', '', '{}', '{}', now(), now()
    from unnest(array[sup, adm, agent, usr]) u;
  perform public.bootstrap_super_admin(sup);

  -- 1. super admin makes an administrator
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_role(adm, 'admin', true);
  reset role;
  r := r || jsonb_build_object('t1_super_grants_admin', exists (select 1 from public.user_roles where user_id = adm and role = 'admin'));

  -- 2. administrator makes a support agent
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_role(agent, 'support_agent', true);
  -- 3. administrator cannot grant admin, revoke a super admin's admin role, or grant driver
  begin perform public.admin_set_role(usr, 'admin', true); failures := failures || 't3_admin_granted_admin';
  exception when insufficient_privilege then r := r || jsonb_build_object('t3_admin_cannot_grant_admin', true); end;
  begin perform public.admin_set_role(sup, 'admin', false); failures := failures || 't3_admin_revoked_super';
  exception when insufficient_privilege then r := r || jsonb_build_object('t3_admin_cannot_revoke_admin', true); end;
  begin perform public.admin_set_role(usr, 'driver', true); failures := failures || 't3_driver_granted';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t3_driver_not_managed', true); end;
  reset role;
  r := r || jsonb_build_object('t2_admin_grants_agent', exists (select 1 from public.user_roles where user_id = agent and role = 'support_agent'));

  -- 4. support agent has no roles.manage
  perform set_config('request.jwt.claims', json_build_object('sub', agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_set_role(usr, 'support_agent', true); failures := failures || 't4_agent_granted';
  exception when others then r := r || jsonb_build_object('t4_agent_denied', true); end;
  reset role;

  -- 5. super admin cannot remove own super_admin; cannot grant to a suspended account
  update public.profiles set is_suspended = true, suspended_reason = 'test' where id = usr;
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_set_role(sup, 'super_admin', false); failures := failures || 't5_self_revoked';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t5_cannot_revoke_self', true); end;
  begin perform public.admin_set_role(usr, 'support_agent', true); failures := failures || 't5_suspended_granted';
  exception when invalid_parameter_value then r := r || jsonb_build_object('t5_suspended_blocked', true); end;
  -- 6. revoke works and is audited
  perform public.admin_set_role(agent, 'support_agent', false);
  reset role;
  r := r || jsonb_build_object('t6_revoked', not exists (select 1 from public.user_roles where user_id = agent and role = 'support_agent'));
  select count(*) into n from public.audit_logs where action in ('role.grant', 'role.revoke') and entity_id in (adm::text, agent::text);
  r := r || jsonb_build_object('t6_audited', n = 3);

  -- 7. anon cannot call it at all
  set local role anon;
  begin perform public.admin_set_role(usr, 'admin', true); failures := failures || 't7_anon_called';
  exception when insufficient_privilege then r := r || jsonb_build_object('t7_anon_denied', true); end;
  reset role;

  r := r || jsonb_build_object('FAILURES', to_jsonb(failures));
  raise exception 'TEST_RESULT %', r::text;
end
$test$;
