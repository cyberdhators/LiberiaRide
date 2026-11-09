-- =====================================================================
-- LiberiaRide · 0013 · Realtime (private Broadcast channels)
--
-- Topics (all PRIVATE — clients must join with { config: { private: true } }):
--   user:<uid>        notifications for one user
--   driver:<uid>      offers / bid updates for one driver
--   booking:<id>      status, driver location, chat for passenger + assigned driver
--   admin:ops         booking & safety events for staff
--   admin:fleet       driver positions for staff
--
-- Database triggers publish with realtime.send(). Authorization is enforced by
-- RLS on realtime.messages using public.realtime_can_read(topic).
-- Durable state lives in tables; Realtime is notification transport only.
-- =====================================================================

create or replace function public.realtime_can_read(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_kind text := split_part(p_topic, ':', 1);
  v_id   text := split_part(p_topic, ':', 2);
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.profiles where id = v_uid and is_suspended) then return false; end if;

  case v_kind
    when 'user' then
      return v_id = v_uid::text;
    when 'driver' then
      return v_id = v_uid::text and public.has_role('driver');
    when 'booking' then
      if v_id !~ '^[0-9a-f-]{36}$' then return false; end if;
      return exists (select 1 from public.bookings b where b.id = v_id::uuid
                     and (b.passenger_id = v_uid or b.driver_id = v_uid))
             or public.is_staff();
    when 'admin' then
      return v_id in ('ops', 'fleet') and public.is_staff();
    else
      return false;
  end case;
end;
$$;
grant execute on function public.realtime_can_read(text) to authenticated;

-- Receive: only authorised subscribers. Send: clients cannot publish (no insert policy),
-- except presence on their own booking channel is not needed and therefore not allowed.
-- realtime.messages has RLS enabled by Supabase; we only add our policy.
drop policy if exists liberia_ride_receive on realtime.messages;
create policy liberia_ride_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.realtime_can_read((select realtime.topic())));

-- Publish helper. Logs durable events (except high-frequency positions) and never
-- lets a Realtime failure roll back the business transaction.
create or replace function public.publish(p_topic text, p_event text, p_payload jsonb, p_persist boolean default true)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_persist then
    insert into public.realtime_events(topic, event, payload) values (p_topic, p_event, p_payload);
  end if;
  begin
    perform realtime.send(p_payload, p_event, p_topic, true);
  exception when others then
    raise warning 'realtime.send failed for %: %', p_topic, sqlerrm;
  end;
end;
$$;

-- bookings → booking:<id>, admin:ops
create or replace function public.tg_publish_booking()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_payload jsonb;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.driver_id is not distinct from old.driver_id
     and new.reserved_driver_id is not distinct from old.reserved_driver_id
     and new.payment_status is not distinct from old.payment_status
     and new.final_fare_minor is not distinct from old.final_fare_minor then
    return null;
  end if;
  v_payload := jsonb_build_object(
    'booking_id', new.id, 'code', new.code, 'status', new.status,
    'previous_status', case when tg_op = 'UPDATE' then old.status end,
    'driver_id', new.driver_id, 'reserved', new.reserved_driver_id is not null,
    'payment_status', new.payment_status, 'final_fare_minor', new.final_fare_minor,
    'updated_at', new.updated_at);
  perform public.publish('booking:' || new.id, 'booking_status', v_payload);
  perform public.publish('admin:ops', 'booking_status', v_payload, false);
  return null;
end;
$$;
create trigger bookings_publish after insert or update on public.bookings
  for each row execute function public.tg_publish_booking();

-- booking_offers → driver:<uid> (driver-facing fields only; no passenger identity)
create or replace function public.tg_publish_offer()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.expires_at is not distinct from old.expires_at then
    return null;
  end if;
  perform public.publish('driver:' || new.driver_id, 'offer', jsonb_build_object(
    'offer_id', new.id, 'booking_id', new.booking_id, 'status', new.status,
    'pickup_address', new.pickup_address, 'dropoff_address', new.dropoff_address,
    'pickup', jsonb_build_object('lat', extensions.st_y(new.pickup::extensions.geometry), 'lng', extensions.st_x(new.pickup::extensions.geometry)),
    'category', new.category_code, 'currency', new.currency, 'fare_minor', new.fare_minor,
    'trip_distance_m', new.trip_distance_m, 'trip_duration_s', new.trip_duration_s,
    'pickup_distance_m', new.pickup_distance_m, 'bidding_enabled', new.bidding_enabled,
    'expires_at', new.expires_at));
  return null;
end;
$$;
create trigger booking_offers_publish after insert or update on public.booking_offers
  for each row execute function public.tg_publish_offer();

-- booking_bids → booking:<id> (passenger) and driver:<uid> (the bidding driver)
create or replace function public.tg_publish_bid()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_payload jsonb;
  v_driver  jsonb;
begin
  if new.driver_id is not null then
    select jsonb_build_object('name', split_part(coalesce(p.full_name, 'Driver'), ' ', 1), 'rating', d.rating_avg,
             'vehicle', v.color || ' ' || v.make || ' ' || v.model)
      into v_driver
      from public.drivers d join public.profiles p on p.id = d.id left join public.vehicles v on v.id = d.current_vehicle_id
     where d.id = new.driver_id;
  end if;
  v_payload := jsonb_build_object('bid_id', new.id, 'booking_id', new.booking_id, 'party', new.party,
    'amount_minor', new.amount_minor, 'currency', new.currency, 'status', new.status,
    'expires_at', new.expires_at, 'driver', v_driver);
  perform public.publish('booking:' || new.booking_id, 'bid', v_payload);
  if new.driver_id is not null then
    perform public.publish('driver:' || new.driver_id, 'bid', v_payload - 'driver', false);
  end if;
  return null;
end;
$$;
create trigger booking_bids_publish after insert or update on public.booking_bids
  for each row execute function public.tg_publish_bid();

-- driver_locations → booking:<id> while serving a ride; admin:fleet always (not persisted)
create or replace function public.tg_publish_driver_location()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_booking uuid;
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'driver_id', new.driver_id,
    'lat', extensions.st_y(new.location::extensions.geometry), 'lng', extensions.st_x(new.location::extensions.geometry),
    'heading', new.heading_deg, 'speed_mps', new.speed_mps, 'accuracy_m', new.accuracy_m,
    'received_at', new.received_at);
  select id into v_booking from public.bookings
   where driver_id = new.driver_id and status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');
  if v_booking is not null then
    perform public.publish('booking:' || v_booking, 'driver_location', v_payload - 'driver_id', false);
  end if;
  perform public.publish('admin:fleet', 'driver_location', v_payload, false);
  return null;
end;
$$;
create trigger driver_locations_publish after insert or update on public.driver_locations
  for each row execute function public.tg_publish_driver_location();

create or replace function public.tg_publish_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.publish('user:' || new.user_id, 'notification',
    jsonb_build_object('id', new.id, 'kind', new.kind, 'title', new.title, 'body', new.body,
                       'data', new.data, 'created_at', new.created_at), false);
  return null;
end;
$$;
create trigger notifications_publish after insert on public.notifications
  for each row execute function public.tg_publish_notification();

create or replace function public.tg_publish_chat()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_booking uuid;
begin
  select booking_id into v_booking from public.chat_conversations where id = new.conversation_id;
  perform public.publish('booking:' || v_booking, 'chat',
    jsonb_build_object('id', new.id, 'sender_id', new.sender_id, 'body', new.body, 'created_at', new.created_at), false);
  return null;
end;
$$;
create trigger chat_messages_publish after insert on public.chat_messages
  for each row execute function public.tg_publish_chat();

create or replace function public.tg_publish_incident()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.publish('admin:ops', case when new.kind = 'sos' then 'sos' else 'incident' end,
    jsonb_build_object('incident_id', new.id, 'booking_id', new.booking_id, 'kind', new.kind,
      'severity', new.severity, 'status', new.status, 'reporter_role', new.reporter_role,
      'lat', case when new.location is not null then extensions.st_y(new.location::extensions.geometry) end,
      'lng', case when new.location is not null then extensions.st_x(new.location::extensions.geometry) end,
      'created_at', new.created_at));
  return null;
end;
$$;
create trigger safety_incidents_publish after insert or update of status on public.safety_incidents
  for each row execute function public.tg_publish_incident();
