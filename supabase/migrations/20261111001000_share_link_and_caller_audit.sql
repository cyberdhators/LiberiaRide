-- =====================================================================
-- LiberiaRide · 0038 · Trip link before a driver is found; caller-account audit
--
-- 1. get_shared_trip also answers for SCHEDULED / SEARCHING_DRIVER /
--    DRIVER_OFFERED bookings (no driver yet), so the link sent to someone a
--    ride was booked for shows the pickup time instead of "no longer active".
-- 2. admin_log_caller_account: the call-centre route records, as the
--    operator, that it found or created a caller's account (bookings.create).
-- =====================================================================

create or replace function public.get_shared_trip(p_share_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where share_token = p_share_token
     and status in ('SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_OFFERED',
                    'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED')
     and (completed_at is null or completed_at > now() - interval '1 hour');
  if not found then return null; end if;
  return jsonb_build_object(
    'code', v_b.code, 'status', v_b.status, 'scheduled_for', v_b.scheduled_for,
    'pickup_address', v_b.pickup_address, 'dropoff_address', v_b.dropoff_address,
    'driver', (select jsonb_build_object('name', split_part(coalesce(p.full_name, 'Driver'), ' ', 1),
                 'vehicle', v.color || ' ' || v.make || ' ' || v.model, 'plate', v.plate_number)
                 from public.profiles p left join public.vehicles v on v.id = v_b.vehicle_id where p.id = v_b.driver_id),
    'driver_location', case when v_b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS') then
        (select jsonb_build_object('lat', extensions.st_y(dl.location::extensions.geometry), 'lng', extensions.st_x(dl.location::extensions.geometry),
                'received_at', dl.received_at) from public.driver_locations dl where dl.driver_id = v_b.driver_id) end,
    'started_at', v_b.started_at, 'completed_at', v_b.completed_at);
end;
$$;

create or replace function public.admin_log_caller_account(p_passenger_id uuid, p_created boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('bookings.create');
  perform public.write_audit(case when p_created then 'caller.create' else 'caller.lookup' end,
    'profiles', p_passenger_id::text, null,
    (select jsonb_build_object('phone', phone, 'full_name', full_name) from public.profiles where id = p_passenger_id));
end;
$$;

revoke execute on function public.admin_log_caller_account(uuid, boolean) from public, anon;
grant execute on function public.admin_log_caller_account(uuid, boolean) to authenticated;
