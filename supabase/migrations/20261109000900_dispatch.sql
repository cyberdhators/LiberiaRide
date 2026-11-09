-- =====================================================================
-- LiberiaRide · 0009 · Dispatch engine, soft allocation, bidding
-- See docs/DISPATCH_ENGINE.md
--
-- Lock order (always, to avoid deadlocks): bookings row → drivers row → offers/bids.
-- Exclusivity is guaranteed twice: row locks serialise competing accepts, and
-- partial unique indexes (one active assignment per booking / per driver)
-- make a double assignment impossible even if a code path were wrong.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Eligible drivers for a booking, nearest first.
-- ---------------------------------------------------------------------
create or replace function public.find_eligible_drivers(
  p_booking_id uuid, p_radius_m integer, p_limit integer)
returns table (driver_id uuid, vehicle_id uuid, distance_m integer, idle_seconds integer, acceptance_rate numeric)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select d.id,
         v.id,
         round(extensions.st_distance(dl.location, b.pickup))::integer,
         extract(epoch from now() - coalesce(
           (select max(ba.released_at) from public.booking_assignments ba where ba.driver_id = d.id),
           d.went_online_at, now()))::integer,
         case when d.acceptance_offers = 0 then 1.0
              else d.acceptance_accepts::numeric / d.acceptance_offers end
  from public.bookings b
  join public.driver_locations dl
    on extensions.st_dwithin(dl.location, b.pickup, p_radius_m)
  join public.drivers d on d.id = dl.driver_id
  join public.profiles p on p.id = d.id
  join public.vehicles v on v.id = d.current_vehicle_id
  where b.id = p_booking_id
    and d.status = 'approved'
    and d.is_online
    and not p.is_suspended
    and v.status = 'approved' and v.is_active
    and v.category_id = b.category_id
    -- live location only
    and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'))
    -- not the passenger themself
    and d.id <> b.passenger_id
    -- free: no active ride, no pending offer anywhere, not soft-reserved by another booking
    and not exists (select 1 from public.booking_assignments ba where ba.driver_id = d.id and ba.released_at is null)
    and not exists (select 1 from public.booking_offers o where o.driver_id = d.id and o.status = 'pending')
    and not exists (select 1 from public.bookings rb where rb.reserved_driver_id = d.id
                    and rb.reserved_until > now() and rb.id <> b.id)
    -- never re-offer this booking to a driver who already saw it
    and not exists (select 1 from public.booking_offers o2 where o2.booking_id = b.id and o2.driver_id = d.id)
  order by extensions.st_distance(dl.location, b.pickup)
  limit p_limit;
$$;

-- Internal: create one offer row for a driver.
create or replace function public._make_offer(
  p_b public.bookings, p_driver_id uuid, p_distance_m integer, p_rank smallint, p_timeout_s integer)
returns public.booking_offers
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_offer public.booking_offers;
  v_cat_code text;
begin
  select code into v_cat_code from public.vehicle_categories where id = p_b.category_id;
  insert into public.booking_offers(
    booking_id, driver_id, strategy, dispatch_round, rank, pickup, pickup_address, dropoff_address,
    category_code, currency, fare_minor, trip_distance_m, trip_duration_s, pickup_distance_m,
    bidding_enabled, expires_at)
  values (
    p_b.id, p_driver_id, p_b.allocation_strategy, p_b.dispatch_round + 1, p_rank, p_b.pickup, p_b.pickup_address,
    case when public.config_bool('dispatch.show_destination_before_accept') then p_b.dropoff_address end,
    v_cat_code, p_b.currency,
    coalesce(p_b.passenger_offer_minor, p_b.estimated_fare_minor),
    p_b.estimated_distance_m, p_b.estimated_duration_s, p_distance_m,
    p_b.bidding_enabled, now() + make_interval(secs => p_timeout_s))
  returning * into v_offer;

  update public.drivers set acceptance_offers = acceptance_offers + 1 where id = p_driver_id;
  return v_offer;
end;
$$;

-- ---------------------------------------------------------------------
-- One dispatch round. Safe to call repeatedly (cron + event-driven).
-- Returns number of offers created.
-- ---------------------------------------------------------------------
create or replace function public.dispatch_booking(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b         public.bookings;
  v_radius    integer;
  v_timeout   integer;
  v_count     integer := 0;
  v_rank      smallint := 0;
  v_cand      record;
  v_batch     integer;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then return 0; end if;

  -- Only search when nobody currently holds an offer.
  if v_b.status = 'DRIVER_OFFERED' then
    if exists (select 1 from public.booking_offers where booking_id = p_booking_id and status = 'pending') then
      return 0;
    end if;
    v_b := public._transition_booking(p_booking_id, 'SEARCHING_DRIVER', 'system', '{"reason":"offers_exhausted"}');
  end if;
  if v_b.status <> 'SEARCHING_DRIVER' or v_b.allocation_strategy = 'manual' then
    return 0;
  end if;

  if v_b.search_expires_at is not null and v_b.search_expires_at < now() then
    perform public._transition_booking(p_booking_id, 'EXPIRED', 'system', '{"reason":"no_driver_found"}');
    return 0;
  end if;

  -- Radius widens each round up to the configured maximum.
  v_radius := least(
    public.config_int('dispatch.radius_m') + v_b.dispatch_round * public.config_int('dispatch.radius_step_m'),
    public.config_int('dispatch.max_radius_m'));
  v_timeout := public.config_int('dispatch.offer_timeout_seconds');
  v_batch := case when v_b.allocation_strategy = 'broadcast' then public.config_int('dispatch.broadcast_size') else 1 end;

  if v_b.allocation_strategy = 'sequential' then
    -- Fair queue: closest within an ETA band, then longest idle, then best acceptance rate.
    for v_cand in
      select * from public.find_eligible_drivers(p_booking_id, v_radius, 25)
      order by (distance_m / 500), idle_seconds desc, acceptance_rate desc
      limit 1
    loop
      v_rank := v_rank + 1;
      perform public._make_offer(v_b, v_cand.driver_id, v_cand.distance_m, v_rank, v_timeout);
      v_count := v_count + 1;
    end loop;
  else
    -- nearest / soft / broadcast: pure proximity.
    for v_cand in select * from public.find_eligible_drivers(p_booking_id, v_radius, v_batch) loop
      v_rank := v_rank + 1;
      perform public._make_offer(v_b, v_cand.driver_id, v_cand.distance_m, v_rank,
        case when v_b.bidding_enabled then public.config_int('bidding.window_seconds') else v_timeout end);
      v_count := v_count + 1;
    end loop;
  end if;

  if v_count > 0 then
    update public.bookings set
      dispatch_round = dispatch_round + 1,
      -- Soft allocation: provisionally reserve the booking for the offered driver.
      reserved_driver_id = case when allocation_strategy = 'soft'
        then (select driver_id from public.booking_offers where booking_id = p_booking_id and status = 'pending' limit 1) end,
      reserved_until = case when allocation_strategy = 'soft' then now() + make_interval(secs => v_timeout) end
    where id = p_booking_id;
    perform public._transition_booking(p_booking_id, 'DRIVER_OFFERED', 'system',
      jsonb_build_object('round', v_b.dispatch_round + 1, 'offers', v_count, 'radius_m', v_radius,
                         'strategy', v_b.allocation_strategy));
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Assignment (shared by offer accept, bid accept, admin manual assign)
-- Caller must hold the booking row lock.
-- ---------------------------------------------------------------------
create or replace function public._assign_driver(
  p_booking_id uuid, p_driver_id uuid, p_method public.allocation_strategy,
  p_offer_id uuid, p_bid_id uuid, p_agreed_fare_minor bigint, p_actor_role text)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b       public.bookings;
  v_vehicle uuid;
begin
  select current_vehicle_id into v_vehicle from public.drivers where id = p_driver_id for update;

  -- Partial unique indexes reject a second active assignment for booking or driver.
  insert into public.booking_assignments(booking_id, driver_id, vehicle_id, offer_id, bid_id, method, assigned_by)
  values (p_booking_id, p_driver_id, v_vehicle, p_offer_id, p_bid_id, p_method, (select auth.uid()));

  update public.bookings set
    driver_id = p_driver_id, vehicle_id = v_vehicle, assigned_at = now(),
    agreed_fare_minor = coalesce(p_agreed_fare_minor, agreed_fare_minor),
    reserved_driver_id = null, reserved_until = null
  where id = p_booking_id;

  -- Everyone else loses their offer / bid.
  update public.booking_offers set status = 'cancelled', responded_at = now(), response_reason = 'assigned_elsewhere'
   where booking_id = p_booking_id and status = 'pending' and id is distinct from p_offer_id;
  update public.booking_bids set status = 'rejected', responded_at = now()
   where booking_id = p_booking_id and status = 'open' and id is distinct from p_bid_id;

  insert into public.chat_conversations(booking_id, passenger_id, driver_id)
  select id, passenger_id, p_driver_id from public.bookings where id = p_booking_id
  on conflict (booking_id) do update set driver_id = excluded.driver_id, closed_at = null;

  v_b := public._transition_booking(p_booking_id, 'DRIVER_ASSIGNED', p_actor_role,
    jsonb_build_object('driver_id', p_driver_id, 'method', p_method, 'offer_id', p_offer_id, 'bid_id', p_bid_id));

  insert into public.notifications(user_id, kind, title, body, data)
  values (v_b.passenger_id, 'booking.driver_assigned', 'Driver on the way',
          'Your driver has accepted the ride.', jsonb_build_object('booking_id', p_booking_id));
  return v_b;
end;
$$;

-- ---------------------------------------------------------------------
-- Driver accepts an offer. Exactly one driver can win.
-- ---------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid   uuid := public.require_active_user();
  v_offer public.booking_offers;
  v_b     public.bookings;
begin
  -- Read without lock to learn the booking id, then lock in canonical order.
  select * into v_offer from public.booking_offers where id = p_offer_id and driver_id = v_uid;
  if not found then raise exception 'offer not found' using errcode = 'P0002'; end if;

  select * into v_b from public.bookings where id = v_offer.booking_id for update;
  select * into v_offer from public.booking_offers where id = p_offer_id for update;

  if v_offer.status <> 'pending' then
    raise exception 'offer is no longer available (%)', v_offer.status using errcode = '55000';
  end if;
  if v_offer.expires_at <= now() then
    update public.booking_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    raise exception 'offer expired' using errcode = '55000';
  end if;
  if v_b.status not in ('DRIVER_OFFERED', 'SEARCHING_DRIVER') then
    update public.booking_offers set status = 'cancelled', responded_at = now() where id = p_offer_id;
    raise exception 'booking is no longer available' using errcode = '55000';
  end if;
  if not exists (select 1 from public.drivers d join public.vehicles v on v.id = d.current_vehicle_id
                  where d.id = v_uid and d.status = 'approved' and v.status = 'approved') then
    raise exception 'driver is not eligible' using errcode = '42501';
  end if;

  update public.booking_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update public.drivers set acceptance_accepts = acceptance_accepts + 1 where id = v_uid;

  -- In bidding mode, accepting the offer = accepting the passenger's price.
  return public._assign_driver(v_b.id, v_uid, v_offer.strategy, p_offer_id, null,
    case when v_b.bidding_enabled then v_b.passenger_offer_minor end, 'driver');
end;
$$;

create or replace function public.reject_offer(p_offer_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid   uuid := public.require_active_user();
  v_offer public.booking_offers;
begin
  select * into v_offer from public.booking_offers where id = p_offer_id and driver_id = v_uid;
  if not found then raise exception 'offer not found' using errcode = 'P0002'; end if;

  perform 1 from public.bookings where id = v_offer.booking_id for update;
  update public.booking_offers
     set status = 'rejected', responded_at = now(), response_reason = left(p_reason, 200)
   where id = p_offer_id and status = 'pending';
  if not found then return; end if;

  update public.bookings set reserved_driver_id = null, reserved_until = null
   where id = v_offer.booking_id and reserved_driver_id = v_uid;
  update public.booking_bids set status = 'withdrawn', responded_at = now()
   where offer_id = p_offer_id and status = 'open';

  -- Immediately move to the next driver.
  perform public.dispatch_booking(v_offer.booking_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Bidding
-- ---------------------------------------------------------------------
-- Driver counters the passenger's price (driver must hold a pending bidding offer).
create or replace function public.driver_counter_bid(p_offer_id uuid, p_amount_minor bigint)
returns public.booking_bids
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid   uuid := public.require_active_user();
  v_offer public.booking_offers;
  v_b     public.bookings;
  v_rule  public.fare_rules;
  v_bid   public.booking_bids;
  v_exp   timestamptz;
begin
  select * into v_offer from public.booking_offers where id = p_offer_id and driver_id = v_uid;
  if not found then raise exception 'offer not found' using errcode = 'P0002'; end if;
  select * into v_b from public.bookings where id = v_offer.booking_id for update;
  select * into v_offer from public.booking_offers where id = p_offer_id for update;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    raise exception 'offer is no longer available' using errcode = '55000';
  end if;
  if not v_b.bidding_enabled then
    raise exception 'bidding is not enabled for this booking' using errcode = '22023';
  end if;
  select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
  if p_amount_minor < round(v_b.estimated_fare_minor::numeric * v_rule.bid_min_pct / 100)
     or p_amount_minor > round(v_b.estimated_fare_minor::numeric * v_rule.bid_max_pct / 100) then
    raise exception 'counter-offer outside allowed range' using errcode = '22023';
  end if;

  v_exp := least(v_b.search_expires_at, now() + make_interval(secs => public.config_int('bidding.counter_ttl_seconds')));
  -- Replace any previous open counter from this driver.
  update public.booking_bids set status = 'withdrawn', responded_at = now()
   where booking_id = v_b.id and driver_id = v_uid and status = 'open';
  insert into public.booking_bids(booking_id, party, driver_id, offer_id, parent_bid_id, amount_minor, currency, status, expires_at)
  values (v_b.id, 'driver', v_uid, p_offer_id,
          (select id from public.booking_bids where booking_id = v_b.id and party = 'passenger' order by created_at desc limit 1),
          p_amount_minor, v_b.currency, 'open', v_exp)
  returning * into v_bid;

  -- Keep the driver's offer alive while the passenger considers the counter.
  update public.booking_offers set expires_at = greatest(expires_at, v_exp) where id = p_offer_id;
  return v_bid;
end;
$$;

-- Passenger accepts a driver's counter-offer → atomic assignment at that price.
create or replace function public.passenger_accept_bid(p_bid_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_bid public.booking_bids;
  v_b   public.bookings;
begin
  select * into v_bid from public.booking_bids where id = p_bid_id;
  if not found then raise exception 'bid not found' using errcode = 'P0002'; end if;
  select * into v_b from public.bookings where id = v_bid.booking_id and passenger_id = v_uid for update;
  if not found then raise exception 'bid not found' using errcode = 'P0002'; end if;
  select * into v_bid from public.booking_bids where id = p_bid_id for update;

  if v_bid.party <> 'driver' or v_bid.status <> 'open' or v_bid.expires_at <= now() then
    raise exception 'bid is no longer available' using errcode = '55000';
  end if;
  if v_b.status not in ('DRIVER_OFFERED', 'SEARCHING_DRIVER') then
    raise exception 'booking is no longer open for bids' using errcode = '55000';
  end if;

  update public.booking_bids set status = 'accepted', responded_at = now() where id = p_bid_id;
  update public.booking_offers set status = 'accepted', responded_at = now()
   where id = v_bid.offer_id and status = 'pending';
  update public.drivers set acceptance_accepts = acceptance_accepts + 1 where id = v_bid.driver_id;

  return public._assign_driver(v_b.id, v_bid.driver_id, 'broadcast', v_bid.offer_id, p_bid_id, v_bid.amount_minor, 'passenger');
end;
$$;

create or replace function public.passenger_reject_bid(p_bid_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
begin
  update public.booking_bids bb set status = 'rejected', responded_at = now()
   from public.bookings b
   where bb.id = p_bid_id and b.id = bb.booking_id and b.passenger_id = v_uid
     and bb.party = 'driver' and bb.status = 'open';
end;
$$;

-- ---------------------------------------------------------------------
-- Maintenance: expire offers/bids/bookings and re-dispatch. Run by pg_cron.
-- ---------------------------------------------------------------------
create or replace function public.run_dispatch_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_expired_offers integer := 0;
  v_expired_bookings integer := 0;
  v_dispatched integer := 0;
  r record;
begin
  -- 1. Expire stale offers and bids.
  with x as (
    update public.booking_offers set status = 'expired', responded_at = now()
     where status = 'pending' and expires_at <= now()
    returning booking_id, driver_id)
  select count(*) into v_expired_offers from x;

  update public.booking_bids set status = 'expired', responded_at = now()
   where status = 'open' and expires_at <= now();

  update public.bookings set reserved_driver_id = null, reserved_until = null
   where reserved_until is not null and reserved_until <= now();

  -- 2. Abandoned confirmations.
  for r in select id from public.bookings
            where status in ('FARE_ESTIMATED', 'PENDING_CONFIRMATION')
              and created_at < now() - make_interval(secs => public.config_int('booking.confirmation_ttl_seconds'))
            for update skip locked loop
    perform public._transition_booking(r.id, 'EXPIRED', 'system', '{"reason":"not_confirmed"}');
    v_expired_bookings := v_expired_bookings + 1;
  end loop;

  -- 3. Searching bookings: expire or run another dispatch round.
  for r in select id, search_expires_at from public.bookings
            where status in ('SEARCHING_DRIVER', 'DRIVER_OFFERED') and allocation_strategy <> 'manual'
            order by created_at
            for update skip locked loop
    if r.search_expires_at < now() then
      update public.booking_offers set status = 'cancelled', responded_at = now()
       where booking_id = r.id and status = 'pending';
      perform public._transition_booking(r.id, 'EXPIRED', 'system', '{"reason":"no_driver_found"}');
      insert into public.notifications(user_id, kind, title, body, data)
      select passenger_id, 'booking.expired', 'No driver available',
             'We could not find a driver nearby. Please try again.', jsonb_build_object('booking_id', id)
        from public.bookings where id = r.id;
      v_expired_bookings := v_expired_bookings + 1;
    else
      v_dispatched := v_dispatched + public.dispatch_booking(r.id);
    end if;
  end loop;

  -- 4. Drivers whose location went stale are taken offline (they cannot be dispatched anyway).
  update public.drivers d set is_online = false
   where d.is_online
     and not exists (select 1 from public.booking_assignments ba where ba.driver_id = d.id and ba.released_at is null)
     and not exists (select 1 from public.driver_locations dl where dl.driver_id = d.id
                      and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.auto_offline_seconds')));

  return jsonb_build_object('expired_offers', v_expired_offers, 'expired_bookings', v_expired_bookings, 'offers_created', v_dispatched);
end;
$$;
