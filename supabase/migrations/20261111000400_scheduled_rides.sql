-- =====================================================================
-- LiberiaRide · 0032 · Scheduled rides
--
-- create_booking(confirm => false) → schedule_booking(booking, at) moves the
-- priced booking to SCHEDULED (price locked at booking time, upfront). A cron
-- job releases it to normal dispatch `scheduling.lead_seconds` before pickup.
-- If the passenger is on another ride at release time the booking waits and
-- retries; 10 minutes after the pickup time it expires with a notification.
-- =====================================================================

alter table public.bookings add column scheduled_for timestamptz;
alter table public.bookings add column created_by uuid references public.profiles(id) on delete set null;
create index bookings_scheduled_idx on public.bookings(scheduled_for) where status = 'SCHEDULED';

-- Operators who book on a caller's behalf (call-centre bookings, scheduling for them).
insert into public.permissions(code, description) values ('bookings.create', 'Create bookings on behalf of a passenger')
on conflict (code) do nothing;
insert into public.role_permissions(role, permission)
select r::public.app_role, 'bookings.create' from unnest(array['support_agent', 'admin', 'super_admin']) r
on conflict do nothing;

insert into public.configuration_settings(key, value, description, is_public) values
  ('scheduling.lead_seconds',       '900',  'Start finding a driver this long before a scheduled pickup', true),
  ('scheduling.min_ahead_seconds',  '1800', 'A ride can be scheduled no sooner than this from now', true),
  ('scheduling.max_ahead_days',     '7',    'A ride can be scheduled at most this many days ahead', true),
  ('scheduling.max_per_passenger',  '3',    'Upcoming scheduled rides allowed per passenger', true)
on conflict (key) do nothing;

-- State machine: PENDING_CONFIRMATION → SCHEDULED → SEARCHING_DRIVER | CANCELLED | EXPIRED.
-- Mirrors packages/shared/src/booking-state.ts (parity test).
create or replace function public.booking_transition_allowed(p_from public.booking_status, p_to public.booking_status)
returns boolean
language sql
immutable
parallel safe
set search_path = public, extensions, pg_temp
as $$
  select case p_from
    when 'DRAFT'                then p_to in ('FARE_ESTIMATED', 'CANCELLED')
    when 'FARE_ESTIMATED'       then p_to in ('PENDING_CONFIRMATION', 'CANCELLED', 'EXPIRED')
    when 'PENDING_CONFIRMATION' then p_to in ('SEARCHING_DRIVER', 'SCHEDULED', 'CANCELLED', 'EXPIRED')
    when 'SCHEDULED'            then p_to in ('SEARCHING_DRIVER', 'CANCELLED', 'EXPIRED')
    when 'SEARCHING_DRIVER'     then p_to in ('DRIVER_OFFERED', 'DRIVER_ASSIGNED', 'CANCELLED', 'EXPIRED', 'FAILED')
    when 'DRIVER_OFFERED'       then p_to in ('DRIVER_ASSIGNED', 'SEARCHING_DRIVER', 'CANCELLED', 'EXPIRED', 'FAILED')
    when 'DRIVER_ASSIGNED'      then p_to in ('DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'SEARCHING_DRIVER', 'CANCELLED', 'FAILED')
    when 'DRIVER_ARRIVING'      then p_to in ('DRIVER_ARRIVED', 'SEARCHING_DRIVER', 'CANCELLED', 'FAILED')
    when 'DRIVER_ARRIVED'       then p_to in ('IN_PROGRESS', 'SEARCHING_DRIVER', 'CANCELLED', 'FAILED')
    when 'IN_PROGRESS'          then p_to in ('COMPLETED', 'FAILED')
    else false   -- COMPLETED, CANCELLED, EXPIRED, FAILED are terminal
  end;
$$;

-- Passenger (or an operator booking for them) schedules a priced, unconfirmed booking.
create or replace function public.schedule_booking(p_booking_id uuid, p_at timestamptz)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
  v_n   integer;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or (v_b.passenger_id <> v_uid and not public.has_permission('bookings.create')) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_b.status = 'SCHEDULED' and v_b.scheduled_for = p_at then return v_b; end if;   -- idempotent
  if v_b.status <> 'PENDING_CONFIRMATION' then
    raise exception 'only a new booking can be scheduled' using errcode = '55000';
  end if;
  if p_at is null or p_at < now() + make_interval(secs => public.config_int('scheduling.min_ahead_seconds')) then
    raise exception 'pick a time at least % minutes from now', public.config_int('scheduling.min_ahead_seconds') / 60
      using errcode = '22023';
  end if;
  if p_at > now() + make_interval(days => public.config_int('scheduling.max_ahead_days')) then
    raise exception 'rides can be scheduled up to % days ahead', public.config_int('scheduling.max_ahead_days') using errcode = '22023';
  end if;
  select count(*) into v_n from public.bookings where passenger_id = v_b.passenger_id and status = 'SCHEDULED';
  if v_n >= public.config_int('scheduling.max_per_passenger') then
    raise exception 'you already have % upcoming rides', v_n using errcode = '55000';
  end if;

  update public.bookings set scheduled_for = date_trunc('minute', p_at) where id = p_booking_id;
  return public._transition_booking(p_booking_id, 'SCHEDULED',
    case when v_b.passenger_id = v_uid then 'passenger' else 'admin' end,
    jsonb_build_object('scheduled_for', date_trunc('minute', p_at)));
end;
$$;

-- Cron: hand due scheduled bookings to dispatch.
create or replace function public.release_scheduled_bookings()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in select id, passenger_id, scheduled_for from public.bookings
            where status = 'SCHEDULED'
              and scheduled_for <= now() + make_interval(secs => public.config_int('scheduling.lead_seconds'))
            order by scheduled_for
            for update skip locked loop
    begin
      update public.bookings
         set confirmed_at = now(),
             search_expires_at = greatest(scheduled_for, now()) + interval '10 minutes'
       where id = r.id;
      perform public._transition_booking(r.id, 'SEARCHING_DRIVER', 'system', '{"reason":"scheduled_release"}');
      insert into public.notifications(user_id, kind, title, body, data)
      values (r.passenger_id, 'booking.scheduled_released', 'Finding your driver',
              'Your scheduled ride at ' || to_char(r.scheduled_for at time zone 'Africa/Monrovia', 'HH24:MI') || ' is now looking for a driver.',
              jsonb_build_object('booking_id', r.id));
      perform public.dispatch_booking(r.id);
      v_count := v_count + 1;
    exception when unique_violation then
      -- The passenger is on another ride (one active ride per passenger). Retry next tick; give up 10 min after pickup time.
      if r.scheduled_for < now() - interval '10 minutes' then
        perform public._transition_booking(r.id, 'EXPIRED', 'system', '{"reason":"passenger_on_another_ride"}');
        insert into public.notifications(user_id, kind, title, body, data)
        values (r.passenger_id, 'booking.expired', 'Scheduled ride not started',
                'Your scheduled ride could not start because you were on another ride.', jsonb_build_object('booking_id', r.id));
      end if;
    end;
  end loop;
  return v_count;
end;
$$;
select cron.schedule('liberia-ride-scheduled', '30 seconds', $$select public.release_scheduled_bookings()$$);

-- Upcoming rides for the passenger home screen.
create or replace function public.my_scheduled_rides()
returns table (id uuid, code text, scheduled_for timestamptz, pickup_address text, dropoff_address text,
               currency public.currency_code, estimated_fare_minor bigint, category text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select b.id, b.code, b.scheduled_for, b.pickup_address, b.dropoff_address, b.currency, b.estimated_fare_minor, vc.name
    from public.bookings b join public.vehicle_categories vc on vc.id = b.category_id
   where b.passenger_id = (select auth.uid()) and b.status = 'SCHEDULED'
   order by b.scheduled_for;
$$;

revoke execute on function
  public.schedule_booking(uuid, timestamptz),
  public.release_scheduled_bookings(),
  public.my_scheduled_rides()
  from public, anon, authenticated;
grant execute on function public.schedule_booking(uuid, timestamptz), public.my_scheduled_rides() to authenticated;
