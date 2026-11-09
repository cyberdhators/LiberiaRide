-- Fleet management.
--  * Admin creates a fleet for an existing user, who becomes its fleet operator.
--  * Drivers join with the fleet's join code (driver consent) and can leave at any time.
--  * The operator sees their drivers, removes drivers and rotates the join code.
--  * Membership history is kept in fleet_drivers; drivers.fleet_id is the current fleet.

alter table public.fleets add column join_code text;
update public.fleets set join_code = upper(encode(extensions.gen_random_bytes(4), 'hex')) where join_code is null;
alter table public.fleets alter column join_code set default upper(encode(extensions.gen_random_bytes(4), 'hex'));
alter table public.fleets alter column join_code set not null;
create unique index fleets_join_code_uq on public.fleets(join_code);

-- Internal: move a driver to a fleet (or none) and keep membership history. Caller authorises.
create or replace function public._set_driver_fleet(p_driver_id uuid, p_fleet_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old uuid;
begin
  select fleet_id into v_old from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'driver not found' using errcode = 'P0002'; end if;
  if v_old is not distinct from p_fleet_id then return v_old; end if;
  if v_old is not null then
    update public.fleet_drivers set left_at = now() where fleet_id = v_old and driver_id = p_driver_id and left_at is null;
  end if;
  update public.drivers set fleet_id = p_fleet_id where id = p_driver_id;
  if p_fleet_id is not null then
    insert into public.fleet_drivers(fleet_id, driver_id) values (p_fleet_id, p_driver_id)
    on conflict (fleet_id, driver_id) do update set joined_at = now(), left_at = null;
  end if;
  return v_old;
end;
$$;

create or replace function public.admin_create_fleet(p_owner_id uuid, p_name text, p_phone text default null)
returns public.fleets
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_owner public.profiles;
  v_f     public.fleets;
begin
  perform public.require_permission('roles.manage');
  select * into v_owner from public.profiles where id = p_owner_id;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if v_owner.is_suspended then raise exception 'reinstate the account first' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(p_name)), 0) < 2 then raise exception 'enter a fleet name' using errcode = '22023'; end if;

  insert into public.fleets(name, owner_id, phone)
  values (btrim(p_name), p_owner_id, coalesce(nullif(btrim(p_phone), ''), v_owner.phone))
  returning * into v_f;
  insert into public.user_roles(user_id, role, granted_by) values (p_owner_id, 'fleet_operator', (select auth.uid()))
  on conflict do nothing;
  insert into public.notifications(user_id, kind, title, body, data)
  values (p_owner_id, 'fleet.created', 'Your fleet is ready',
          'Share join code ' || v_f.join_code || ' with your drivers.', jsonb_build_object('fleet_id', v_f.id));
  perform public.write_audit('fleet.create', 'fleets', v_f.id::text, null,
    jsonb_build_object('name', v_f.name, 'owner_id', p_owner_id));
  return v_f;
end;
$$;

create or replace function public.admin_set_fleet_active(p_fleet_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('roles.manage');
  update public.fleets set is_active = p_active where id = p_fleet_id;
  if not found then raise exception 'fleet not found' using errcode = 'P0002'; end if;
  perform public.write_audit(case when p_active then 'fleet.activate' else 'fleet.deactivate' end, 'fleets', p_fleet_id::text,
    null, jsonb_build_object('is_active', p_active));
end;
$$;

-- Operator override by staff (e.g. a driver who cannot use the join code).
create or replace function public.admin_set_driver_fleet(p_driver_id uuid, p_fleet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old uuid;
begin
  perform public.require_permission('drivers.review');
  if p_fleet_id is not null and not exists (select 1 from public.fleets where id = p_fleet_id) then
    raise exception 'fleet not found' using errcode = 'P0002';
  end if;
  v_old := public._set_driver_fleet(p_driver_id, p_fleet_id);
  perform public.write_audit('driver.set_fleet', 'drivers', p_driver_id::text,
    jsonb_build_object('fleet_id', v_old), jsonb_build_object('fleet_id', p_fleet_id));
end;
$$;

create or replace function public.driver_join_fleet(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_f   public.fleets;
begin
  if not exists (select 1 from public.drivers where id = v_uid) then
    raise exception 'register as a driver first' using errcode = '42501';
  end if;
  select * into v_f from public.fleets where join_code = upper(btrim(p_code)) and is_active;
  if not found then raise exception 'that fleet code is not valid' using errcode = 'P0002'; end if;
  perform public._set_driver_fleet(v_uid, v_f.id);
  insert into public.notifications(user_id, kind, title, body, data)
  select v_f.owner_id, 'fleet.driver_joined', 'Driver joined your fleet',
         coalesce(p.full_name, 'A driver') || ' joined ' || v_f.name || '.', jsonb_build_object('fleet_id', v_f.id, 'driver_id', v_uid)
    from public.profiles p where p.id = v_uid;
  perform public.write_audit('fleet.join', 'fleets', v_f.id::text, null, jsonb_build_object('driver_id', v_uid));
  return jsonb_build_object('fleet_id', v_f.id, 'name', v_f.name);
end;
$$;

create or replace function public.driver_leave_fleet()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_old uuid;
begin
  v_old := public._set_driver_fleet(v_uid, null);
  if v_old is null then return; end if;
  insert into public.notifications(user_id, kind, title, body, data)
  select f.owner_id, 'fleet.driver_left', 'Driver left your fleet',
         coalesce(p.full_name, 'A driver') || ' left ' || f.name || '.', jsonb_build_object('fleet_id', f.id, 'driver_id', v_uid)
    from public.fleets f, public.profiles p where f.id = v_old and p.id = v_uid;
  perform public.write_audit('fleet.leave', 'fleets', v_old::text, null, jsonb_build_object('driver_id', v_uid));
end;
$$;

create or replace function public.fleet_remove_driver(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_old uuid;
begin
  if not (public.has_role('fleet_operator') and public.is_fleet_operator_of_driver(p_driver_id)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_old := public._set_driver_fleet(p_driver_id, null);
  insert into public.notifications(user_id, kind, title, body, data)
  select p_driver_id, 'driver.fleet_removed', 'Removed from fleet', 'You are no longer part of ' || f.name || '.',
         jsonb_build_object('fleet_id', f.id)
    from public.fleets f where f.id = v_old;
  perform public.write_audit('fleet.remove_driver', 'fleets', v_old::text, null, jsonb_build_object('driver_id', p_driver_id));
end;
$$;

create or replace function public.fleet_regenerate_code(p_fleet_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := public.require_active_user();
  v_code text;
begin
  if not public.has_role('fleet_operator') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.fleets set join_code = upper(encode(extensions.gen_random_bytes(4), 'hex'))
   where id = p_fleet_id and owner_id = v_uid
  returning join_code into v_code;
  if v_code is null then raise exception 'fleet not found' using errcode = 'P0002'; end if;
  perform public.write_audit('fleet.rotate_code', 'fleets', p_fleet_id::text, null, null);
  return v_code;
end;
$$;

-- Operator console read model: the caller's fleets with drivers and 7-day earnings (minor units as strings).
create or replace function public.fleet_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
begin
  if not public.has_role('fleet_operator') then raise exception 'permission denied' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', f.id, 'name', f.name, 'join_code', f.join_code, 'is_active', f.is_active,
             'drivers', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'driver_id', d.id, 'name', p.full_name, 'phone', p.phone, 'status', d.status,
                        'online', d.is_online, 'completed_trips', d.completed_trips, 'rating', d.rating_avg,
                        'received_at', dl.received_at, 'plate', v.plate_number,
                        'trips_7d', (select count(*) from public.driver_earnings e
                                      where e.driver_id = d.id and e.created_at > now() - interval '7 days'),
                        'net_7d', (select coalesce(jsonb_object_agg(t.currency, t.net::text), '{}'::jsonb)
                                     from (select e.currency, sum(e.net_minor) net from public.driver_earnings e
                                            where e.driver_id = d.id and e.created_at > now() - interval '7 days'
                                            group by e.currency) t)
                      ) order by p.full_name), '[]'::jsonb)
                 from public.drivers d
                 join public.profiles p on p.id = d.id
                 left join public.driver_locations dl on dl.driver_id = d.id
                 left join public.vehicles v on v.id = d.current_vehicle_id
                where d.fleet_id = f.id)
           ) order by f.created_at), '[]'::jsonb)
      from public.fleets f
     where f.owner_id = v_uid
  );
end;
$$;

revoke execute on function public._set_driver_fleet(uuid, uuid) from public, anon, authenticated;
revoke execute on function
  public.admin_create_fleet(uuid, text, text), public.admin_set_fleet_active(uuid, boolean),
  public.admin_set_driver_fleet(uuid, uuid), public.driver_join_fleet(text), public.driver_leave_fleet(),
  public.fleet_remove_driver(uuid), public.fleet_regenerate_code(uuid), public.fleet_overview()
  from public, anon;
grant execute on function
  public.admin_create_fleet(uuid, text, text), public.admin_set_fleet_active(uuid, boolean),
  public.admin_set_driver_fleet(uuid, uuid), public.driver_join_fleet(text), public.driver_leave_fleet(),
  public.fleet_remove_driver(uuid), public.fleet_regenerate_code(uuid), public.fleet_overview()
  to authenticated;
