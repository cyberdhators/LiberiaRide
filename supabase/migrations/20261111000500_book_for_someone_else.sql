-- =====================================================================
-- LiberiaRide · 0033 · Book a ride for someone else
--
-- The rider's name and phone live in booking_riders (readable by the passenger and staff),
-- NOT on bookings — the assigned driver can read the bookings row forever.
-- The driver sees the rider through get_booking_view, with the phone only
-- while the ride is active (same rule as the passenger's own phone).
-- Flow: create_booking(confirm => false) → set_booking_rider → confirm_booking
-- (or schedule_booking). The booker shares the ride PIN and trip link.
--
-- Also: bookings.surge_multiplier (set by 0034) and the booking view's new
-- fields for scheduled rides, riders and busy-hour pricing — one copy of the view.
-- =====================================================================

alter table public.bookings add column surge_multiplier numeric(3,2) not null default 1.00
  check (surge_multiplier between 1.00 and 3.00);

create table public.booking_riders (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  phone      text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  created_at timestamptz not null default now()
);
alter table public.booking_riders enable row level security;
grant select on public.booking_riders to authenticated;
create policy booking_riders_passenger on public.booking_riders for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.passenger_id = (select auth.uid())) or public.is_staff());

-- Name + phone of the person riding; null name removes the rider (back to "for me").
-- The app normalises the phone with packages/shared/src/phone.ts; this only accepts E.164.
create or replace function public.set_booking_rider(p_booking_id uuid, p_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or (v_b.passenger_id <> v_uid and not public.has_permission('bookings.create')) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_b.status not in ('PENDING_CONFIRMATION', 'SCHEDULED') then
    raise exception 'the rider can only be changed before a driver is found' using errcode = '55000';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    delete from public.booking_riders where booking_id = p_booking_id;
    return;
  end if;
  if char_length(btrim(p_name)) < 2 then
    raise exception 'enter the rider''s name' using errcode = '22023';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'enter the rider''s phone number' using errcode = '22023';
  end if;
  insert into public.booking_riders(booking_id, name, phone) values (p_booking_id, left(btrim(p_name), 80), p_phone)
  on conflict (booking_id) do update set name = excluded.name, phone = excluded.phone;
end;
$$;

-- Booking view: + scheduled_for, surge_multiplier, rider, booked_by (driver side), booked_by_operator.
create or replace function public.get_booking_view(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid    uuid := public.require_active_user();
  v_b      public.bookings;
  v_active boolean;
  v_driver jsonb;
  v_pass   jsonb;
  v_loc    jsonb;
  v_is_pax boolean;
  v_rider  public.booking_riders;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (v_b.passenger_id = v_uid or v_b.driver_id = v_uid or public.is_staff()) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  v_is_pax := v_b.passenger_id = v_uid;
  v_active := v_b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');
  select * into v_rider from public.booking_riders where booking_id = v_b.id;

  if v_b.driver_id is not null then
    select jsonb_build_object(
             'id', d.id, 'name', split_part(coalesce(p.full_name, 'Driver'), ' ', 1),
             'avatar_path', p.avatar_path, 'rating', d.rating_avg, 'trips', d.completed_trips,
             'phone', case when v_active or public.is_staff() then p.phone end,
             'vehicle', jsonb_build_object('make', v.make, 'model', v.model, 'color', v.color,
                                           'plate', v.plate_number, 'category', vc.code))
      into v_driver
      from public.drivers d join public.profiles p on p.id = d.id
      left join public.vehicles v on v.id = v_b.vehicle_id
      left join public.vehicle_categories vc on vc.id = v.category_id
     where d.id = v_b.driver_id;
    if v_active then
      select jsonb_build_object('lat', extensions.st_y(dl.location::extensions.geometry),
                                'lng', extensions.st_x(dl.location::extensions.geometry),
                                'heading', dl.heading_deg, 'accuracy_m', dl.accuracy_m,
                                'received_at', dl.received_at,
                                'stale', dl.received_at < now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds')))
        into v_loc from public.driver_locations dl where dl.driver_id = v_b.driver_id;
    end if;
  end if;

  if not v_is_pax then
    -- The driver meets the rider, not necessarily the account holder.
    select jsonb_build_object(
             'name', case when v_rider.booking_id is not null then split_part(v_rider.name, ' ', 1)
                          else split_part(coalesce(p.full_name, 'Passenger'), ' ', 1) end,
             'rating', case when v_rider.booking_id is null then pa.rating_avg end,
             'phone', case when v_active or public.is_staff() then coalesce(v_rider.phone, p.phone) end,
             'booked_by', case when v_rider.booking_id is not null then split_part(coalesce(p.full_name, 'Passenger'), ' ', 1) end)
      into v_pass
      from public.profiles p left join public.passengers pa on pa.id = p.id where p.id = v_b.passenger_id;
  end if;

  return jsonb_build_object(
    'id', v_b.id, 'code', v_b.code, 'status', v_b.status, 'channel', v_b.channel,
    'pickup', jsonb_build_object('lat', extensions.st_y(v_b.pickup::extensions.geometry), 'lng', extensions.st_x(v_b.pickup::extensions.geometry), 'address', v_b.pickup_address, 'qls_ref', v_b.pickup_qls_ref),
    'dropoff', jsonb_build_object('lat', extensions.st_y(v_b.dropoff::extensions.geometry), 'lng', extensions.st_x(v_b.dropoff::extensions.geometry), 'address', v_b.dropoff_address, 'qls_ref', v_b.dropoff_qls_ref),
    'stops', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'kind', s.kind, 'address', s.address,
                'lat', extensions.st_y(s.location::extensions.geometry), 'lng', extensions.st_x(s.location::extensions.geometry),
                'arrived_at', s.arrived_at, 'departed_at', s.departed_at) order by s.seq), '[]'::jsonb)
              from public.booking_stops s where s.booking_id = v_b.id),
    'currency', v_b.currency, 'estimated_fare_minor', v_b.estimated_fare_minor, 'agreed_fare_minor', v_b.agreed_fare_minor,
    'final_fare_minor', v_b.final_fare_minor, 'discount_minor', v_b.discount_minor,
    'outstanding_fee_minor', v_b.outstanding_fee_minor,
    'surge_multiplier', v_b.surge_multiplier,
    'scheduled_for', v_b.scheduled_for,
    'booked_by_operator', v_b.created_by is not null,
    'rider', case when v_is_pax and v_rider.booking_id is not null
                  then jsonb_build_object('name', v_rider.name, 'phone', v_rider.phone) end,
    'estimated_distance_m', v_b.estimated_distance_m, 'estimated_duration_s', v_b.estimated_duration_s,
    'payment_method', v_b.payment_method, 'payment_status', v_b.payment_status,
    'bidding_enabled', v_b.bidding_enabled, 'passenger_offer_minor', v_b.passenger_offer_minor,
    'route_polyline', v_b.route_polyline,
    'share_token', case when v_is_pax then v_b.share_token end,
    'driver', v_driver, 'driver_location', v_loc, 'passenger', v_pass,
    'reserved', v_b.reserved_driver_id is not null and v_b.reserved_until > now(),
    'search_expires_at', v_b.search_expires_at,
    'created_at', v_b.created_at, 'assigned_at', v_b.assigned_at, 'arrived_at', v_b.arrived_at,
    'started_at', v_b.started_at, 'completed_at', v_b.completed_at, 'cancelled_at', v_b.cancelled_at,
    'cancel_reason', v_b.cancel_reason, 'cancellation_fee_minor', v_b.cancellation_fee_minor,
    'final_breakdown', (select to_jsonb(fb) - 'id' - 'booking_id' - 'fare_estimate_id'
                          - case when v_is_pax then array['commission_minor', 'driver_net_minor'] else array[]::text[] end
                          from public.fare_breakdowns fb where fb.booking_id = v_b.id and fb.kind = 'final' limit 1)
  );
end;
$$;

revoke execute on function public.set_booking_rider(uuid, text, text) from public, anon;
grant execute on function public.set_booking_rider(uuid, text, text) to authenticated;
