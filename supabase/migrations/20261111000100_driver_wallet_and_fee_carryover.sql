-- =====================================================================
-- LiberiaRide · 0029 · Driver wallet, debt limit, unpaid-fee carry-over
--
-- Wallet: one balance per driver and currency, computed from the rows that
-- already exist (driver_balance), so settlements and the wallet always agree:
--   + net earnings (fare − commission)          [unsettled]
--   − cash the driver collected (expected)      [unsettled cash_reconciliation]
--   + wallet entries (top-ups, cancellation-fee credits, adjustments) [unsettled]
--   + net of settlements not yet paid
--   > 0: LiberiaRide owes the driver · < 0: the driver owes LiberiaRide.
-- A driver whose debt exceeds the limit (USD or LRD) cannot go online and
-- receives no offers until topped up. Top-ups are recorded by finance staff
-- (cash at the office, MoMo transfer) — self-serve MoMo comes with credentials.
--
-- Settlement fix: cash held is now what the driver actually collected
-- (cash_reconciliation.expected = fare after promotion), not the gross fare,
-- so promotions are funded by the platform as compute_fare intends.
--
-- Carry-over: a passenger's unpaid cancellation / no-show fees (same currency)
-- are shown before booking and collected with the next completed fare. The
-- driver who was cancelled on is credited the fee minus commission.
--
-- Also (review of 0028): kick the push function only when something was
-- actually queued, at most once per transaction.
-- =====================================================================

insert into public.configuration_settings(key, value, description, is_public) values
  ('wallet.max_debt_minor_usd', '2500',   'Driver cannot go online when owing more than this (USD minor units)', true),
  ('wallet.max_debt_minor_lrd', '450000', 'Driver cannot go online when owing more than this (LRD minor units)', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.driver_wallet_entries (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete restrict,
  currency      public.currency_code not null,
  kind          text not null check (kind in ('topup', 'cancellation_fee', 'adjustment')),
  amount_minor  bigint not null check (amount_minor <> 0),          -- + credits the driver, − debits
  method        text check (method in ('cash', 'mtn_momo', 'orange_money', 'bank', 'other')),
  reference     text not null unique check (char_length(reference) between 3 and 120),
  booking_id    uuid references public.bookings(id) on delete set null,
  note          text check (char_length(note) <= 300),
  settlement_id uuid references public.driver_settlements(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index driver_wallet_entries_driver_idx on public.driver_wallet_entries(driver_id, created_at desc);
create index driver_wallet_entries_unsettled_idx on public.driver_wallet_entries(driver_id, currency) where settlement_id is null;
alter table public.driver_wallet_entries enable row level security;
grant select on public.driver_wallet_entries to authenticated;
create policy driver_wallet_entries_read on public.driver_wallet_entries for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff() or public.is_fleet_operator_of_driver(driver_id));

alter table public.driver_settlements add column adjustments_minor bigint not null default 0;
create index cash_reconciliation_unsettled_idx on public.cash_reconciliation(driver_id, currency) where settlement_id is null;

alter table public.bookings add column outstanding_fee_minor bigint not null default 0 check (outstanding_fee_minor >= 0);

-- ---------------------------------------------------------------------
-- Balance
-- ---------------------------------------------------------------------
create or replace function public.driver_balance(p_driver_id uuid, p_currency public.currency_code)
returns bigint
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select sum(net_minor) from public.driver_earnings
                    where driver_id = p_driver_id and currency = p_currency and settlement_id is null), 0)
       - coalesce((select sum(expected_minor) from public.cash_reconciliation
                    where driver_id = p_driver_id and currency = p_currency and settlement_id is null), 0)
       + coalesce((select sum(amount_minor) from public.driver_wallet_entries
                    where driver_id = p_driver_id and currency = p_currency and settlement_id is null), 0)
       + coalesce((select sum(net_payable_minor) from public.driver_settlements
                    where driver_id = p_driver_id and currency = p_currency and status in ('draft', 'pending')), 0);
$$;

create or replace function public.driver_debt_limit(p_currency public.currency_code)
returns bigint
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case p_currency when 'USD' then public.config_int('wallet.max_debt_minor_usd')
                         when 'LRD' then public.config_int('wallet.max_debt_minor_lrd') end::bigint;
$$;

create or replace function public.driver_over_debt_limit(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from unnest(enum_range(null::public.currency_code)) c
                  where public.driver_debt_limit(c) is not null
                    and public.driver_balance(p_driver_id, c) < -public.driver_debt_limit(c));
$$;

-- Driver: own wallet.
create or replace function public.driver_wallet()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
begin
  if not exists (select 1 from public.drivers where id = v_uid) then return null; end if;
  return jsonb_build_object(
    'blocked', public.driver_over_debt_limit(v_uid),
    'balances', (select jsonb_agg(jsonb_build_object('currency', c, 'balance_minor', public.driver_balance(v_uid, c),
                                                     'limit_minor', public.driver_debt_limit(c)) order by c)
                   from unnest(enum_range(null::public.currency_code)) c),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'currency', e.currency,
                                  'amount_minor', e.amount_minor, 'method', e.method, 'note', e.note, 'created_at', e.created_at)
                                  order by e.created_at desc), '[]'::jsonb)
                  from (select * from public.driver_wallet_entries where driver_id = v_uid order by created_at desc limit 20) e));
end;
$$;

-- Finance: every driver with an open balance.
create or replace function public.admin_driver_balances()
returns table (driver_id uuid, name text, phone text, currency public.currency_code, balance_minor bigint,
               limit_minor bigint, over_limit boolean, is_online boolean)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('finance.view');
  return query
  with k as (
    select e.driver_id, e.currency from public.driver_earnings e where e.settlement_id is null
    union select c.driver_id, c.currency from public.cash_reconciliation c where c.settlement_id is null
    union select w.driver_id, w.currency from public.driver_wallet_entries w where w.settlement_id is null
    union select s.driver_id, s.currency from public.driver_settlements s where s.status in ('draft', 'pending')
  ), b as (
    select k.driver_id, k.currency, public.driver_balance(k.driver_id, k.currency) as bal from k
  )
  select b.driver_id, p.full_name, p.phone, b.currency, b.bal, public.driver_debt_limit(b.currency),
         b.bal < -coalesce(public.driver_debt_limit(b.currency), 9223372036854775807), d.is_online
    from b join public.drivers d on d.id = b.driver_id join public.profiles p on p.id = b.driver_id
   where b.bal <> 0
   order by b.bal;
end;
$$;

-- Finance: record money a driver paid in (office cash, MoMo transfer, bank).
-- Idempotent on the receipt reference.
create or replace function public.admin_record_driver_topup(
  p_driver_id uuid, p_currency public.currency_code, p_amount_minor bigint, p_method text, p_reference text, p_note text default null)
returns public.driver_wallet_entries
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ref text := 'topup:' || btrim(coalesce(p_reference, ''));
  v_e   public.driver_wallet_entries;
begin
  perform public.require_permission('finance.manage');
  if char_length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'a receipt or transaction reference is required' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 100000000 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'driver not found' using errcode = 'P0002';
  end if;

  select * into v_e from public.driver_wallet_entries where reference = v_ref;
  if found then
    if v_e.driver_id <> p_driver_id or v_e.amount_minor <> p_amount_minor or v_e.currency <> p_currency then
      raise exception 'that reference was already used for a different top-up' using errcode = '23505';
    end if;
    return v_e;   -- same top-up recorded twice: no double credit
  end if;

  insert into public.driver_wallet_entries(driver_id, currency, kind, amount_minor, method, reference, note, created_by)
  values (p_driver_id, p_currency, 'topup', p_amount_minor, p_method, v_ref, nullif(left(btrim(coalesce(p_note, '')), 300), ''),
          (select auth.uid()))
  returning * into v_e;
  perform public.write_audit('wallet.topup', 'driver_wallet_entries', v_e.id::text, null, to_jsonb(v_e), p_note);
  insert into public.notifications(user_id, kind, title, body, data)
  values (p_driver_id, 'driver.wallet_topup', 'Balance topped up',
          'LiberiaRide recorded your payment of ' || p_currency::text || ' ' || to_char(p_amount_minor / 100.0, 'FM999G999G990D00') || '.',
          jsonb_build_object('entry_id', v_e.id));
  return v_e;
end;
$$;

-- Settlement now uses the same components as driver_balance (incl. wallet entries;
-- cash held = what the driver collected).
create or replace function public.admin_create_settlement(p_driver_id uuid, p_currency public.currency_code)
returns public.driver_settlements
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s public.driver_settlements;
  v_gross bigint; v_comm bigint; v_cash bigint; v_adj bigint;
  v_from timestamptz; v_to timestamptz;
begin
  perform public.require_permission('finance.manage');
  select coalesce(sum(gross_minor), 0), coalesce(sum(commission_minor), 0)
    into v_gross, v_comm
    from public.driver_earnings where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  select coalesce(sum(expected_minor), 0) into v_cash
    from public.cash_reconciliation where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  select coalesce(sum(amount_minor), 0) into v_adj
    from public.driver_wallet_entries where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  select min(t), max(t) into v_from, v_to from (
    select created_at t from public.driver_earnings where driver_id = p_driver_id and currency = p_currency and settlement_id is null
    union all select created_at from public.cash_reconciliation where driver_id = p_driver_id and currency = p_currency and settlement_id is null
    union all select created_at from public.driver_wallet_entries where driver_id = p_driver_id and currency = p_currency and settlement_id is null) x;
  if v_from is null then raise exception 'nothing to settle' using errcode = '55000'; end if;

  insert into public.driver_settlements(driver_id, currency, period_start, period_end, gross_minor, commission_minor,
    cash_collected_minor, adjustments_minor, net_payable_minor, status, created_by)
  values (p_driver_id, p_currency, v_from, v_to + interval '1 second', v_gross, v_comm, v_cash, v_adj,
          v_gross - v_comm - v_cash + v_adj, 'pending', (select auth.uid()))
  returning * into v_s;

  update public.driver_earnings set settlement_id = v_s.id
   where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  update public.cash_reconciliation set settlement_id = v_s.id
   where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  update public.driver_wallet_entries set settlement_id = v_s.id
   where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  perform public.write_audit('settlement.create', 'driver_settlements', v_s.id::text, null, to_jsonb(v_s));
  return v_s;
end;
$$;

-- ---------------------------------------------------------------------
-- Debt limit enforcement: going online, and dispatch
-- ---------------------------------------------------------------------
create or replace function public.driver_set_online(p_online boolean)
returns public.drivers
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_d   public.drivers;
  v_missing text[];
begin
  select * into v_d from public.drivers where id = v_uid for update;
  if not found then raise exception 'not a driver' using errcode = '42501'; end if;

  if p_online then
    if v_d.status <> 'approved' then
      raise exception 'driver account is %', v_d.status using errcode = '42501';
    end if;
    if not exists (select 1 from public.vehicles where id = v_d.current_vehicle_id and status = 'approved' and is_active) then
      raise exception 'no approved vehicle selected' using errcode = '42501';
    end if;
    select array_agg(t) into v_missing
      from unnest(array['driver_licence', 'vehicle_registration']::public.document_type[]) t
     where not exists (select 1 from public.driver_documents dd
                        where dd.driver_id = v_uid and dd.doc_type = t and dd.status = 'approved'
                          and (dd.expires_at is null or dd.expires_at >= current_date));
    if v_missing is not null then
      raise exception 'documents missing or expired: %', array_to_string(v_missing, ', ') using errcode = '42501';
    end if;
    if public.driver_over_debt_limit(v_uid) then
      raise exception 'commission owed is over the limit — top up your LiberiaRide balance to go online (see Earnings)'
        using errcode = '42501';
    end if;
    if not exists (select 1 from public.driver_locations
                    where driver_id = v_uid
                      and received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'))) then
      raise exception 'share your live location before going online' using errcode = '55000';
    end if;
    update public.drivers set is_online = true, went_online_at = now() where id = v_uid returning * into v_d;
  else
    update public.drivers set is_online = false where id = v_uid returning * into v_d;
    perform public.reject_offer(o.id, 'driver_went_offline')
       from public.booking_offers o where o.driver_id = v_uid and o.status = 'pending';
  end if;
  return v_d;
end;
$$;

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
    and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'))
    and d.id <> b.passenger_id
    and not exists (select 1 from public.booking_assignments ba where ba.driver_id = d.id and ba.released_at is null)
    and not exists (select 1 from public.booking_offers o where o.driver_id = d.id and o.status = 'pending')
    and not exists (select 1 from public.bookings rb where rb.reserved_driver_id = d.id
                    and rb.reserved_until > now() and rb.id <> b.id)
    and not exists (select 1 from public.booking_offers o2 where o2.booking_id = b.id and o2.driver_id = d.id)
    -- over the commission debt limit: finishes the current trip, then no new offers until topped up
    and not public.driver_over_debt_limit(d.id)
  order by extensions.st_distance(dl.location, b.pickup)
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- Unpaid cancellation fees
-- ---------------------------------------------------------------------
create or replace function public.my_outstanding_fees()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
    from (select p.currency, sum(p.amount_minor) total from public.payments p
           where p.payer_id = (select auth.uid()) and p.status = 'pending' and p.idempotency_key like 'cancel-fee:%'
           group by p.currency) t;
$$;

-- Booking creation snapshots the passenger's unpaid fees in this currency (shown before confirming).
create or replace function public._create_booking(
  p_passenger_id uuid,
  p_estimate_id uuid,
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_channel public.booking_channel,
  p_passenger_offer_minor bigint,
  p_note text,
  p_actor_role text)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_existing public.bookings;
  v_est      public.fare_estimates;
  v_rule     public.fare_rules;
  v_b        public.bookings;
  v_stop     jsonb;
  v_seq      smallint := 1;
  v_bidding  boolean := false;
  v_strategy public.allocation_strategy;
  v_fees     bigint;
begin
  select * into v_existing from public.bookings
   where passenger_id = p_passenger_id and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_est from public.fare_estimates where id = p_estimate_id for update;
  if not found or v_est.passenger_id <> p_passenger_id then
    raise exception 'fare estimate not found' using errcode = 'P0002';
  end if;
  if v_est.expires_at < now() then
    raise exception 'fare estimate expired' using errcode = '22023';
  end if;
  select * into v_rule from public.fare_rules where id = v_est.fare_rule_id;

  if p_passenger_offer_minor is not null then
    if not v_rule.bidding_enabled or not public.config_bool('bidding.enabled') then
      raise exception 'bidding is not enabled for this category' using errcode = '22023';
    end if;
    if p_passenger_offer_minor < round(v_est.total_minor::numeric * v_rule.bid_min_pct / 100)
       or p_passenger_offer_minor > round(v_est.total_minor::numeric * v_rule.bid_max_pct / 100) then
      raise exception 'offer outside allowed range' using errcode = '22023';
    end if;
    v_bidding := true;
  end if;
  v_strategy := case when v_bidding then 'broadcast'::public.allocation_strategy
                     else public.config_text('dispatch.default_strategy')::public.allocation_strategy end;

  select coalesce(sum(p.amount_minor), 0) into v_fees from public.payments p
   where p.payer_id = p_passenger_id and p.currency = v_est.currency and p.status = 'pending'
     and p.idempotency_key like 'cancel-fee:%';

  insert into public.bookings(
    passenger_id, category_id, channel, idempotency_key,
    pickup, pickup_address, pickup_qls_ref, dropoff, dropoff_address, dropoff_qls_ref,
    fare_estimate_id, fare_rule_id, currency,
    estimated_distance_m, estimated_duration_s, estimated_fare_minor, discount_minor, coupon_id,
    payment_method, allocation_strategy, bidding_enabled, passenger_offer_minor,
    route_polyline, passenger_note, outstanding_fee_minor)
  values (
    p_passenger_id, v_est.category_id, p_channel, p_idempotency_key,
    v_est.pickup, v_est.pickup_address, v_est.pickup_qls_ref, v_est.dropoff, v_est.dropoff_address, v_est.dropoff_qls_ref,
    v_est.id, v_est.fare_rule_id, v_est.currency,
    v_est.distance_m, v_est.duration_s, v_est.total_minor, v_est.discount_minor, v_est.coupon_id,
    p_payment_method, v_strategy, v_bidding, p_passenger_offer_minor,
    v_est.route_polyline, nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_fees)
  returning * into v_b;

  insert into public.booking_events(booking_id, from_status, to_status, actor_id, actor_role, metadata)
  values (v_b.id, null, 'DRAFT', (select auth.uid()), p_actor_role, jsonb_build_object('channel', p_channel));

  insert into public.booking_stops(booking_id, seq, kind, location, address, qls_ref)
  values (v_b.id, 0, 'pickup', v_est.pickup, v_est.pickup_address, v_est.pickup_qls_ref);
  for v_stop in select * from jsonb_array_elements(v_est.stops) loop
    insert into public.booking_stops(booking_id, seq, kind, location, address, qls_ref)
    values (v_b.id, v_seq, 'stop',
            public.make_point((v_stop->>'lat')::double precision, (v_stop->>'lng')::double precision),
            left(v_stop->>'address', 300), v_stop->>'qls_ref');
    v_seq := v_seq + 1;
  end loop;
  insert into public.booking_stops(booking_id, seq, kind, location, address, qls_ref)
  values (v_b.id, v_seq, 'dropoff', v_est.dropoff, v_est.dropoff_address, v_est.dropoff_qls_ref);

  if v_est.coupon_id is not null and v_est.discount_minor > 0 then
    insert into public.coupon_redemptions(coupon_id, user_id, booking_id, discount_minor, currency)
    values (v_est.coupon_id, p_passenger_id, v_b.id, v_est.discount_minor, v_est.currency);
    update public.coupons set redeemed_count = redeemed_count + 1 where id = v_est.coupon_id;
  end if;

  if v_bidding then
    insert into public.booking_bids(booking_id, party, amount_minor, currency, status, expires_at)
    values (v_b.id, 'passenger', p_passenger_offer_minor, v_est.currency, 'open',
            now() + make_interval(secs => public.config_int('dispatch.search_timeout_seconds')));
  end if;

  update public.fare_estimates set expires_at = least(expires_at, now()) where id = v_est.id;

  perform public._transition_booking(v_b.id, 'FARE_ESTIMATED', p_actor_role, jsonb_build_object('estimate_id', v_est.id));
  return public._transition_booking(v_b.id, 'PENDING_CONFIRMATION', p_actor_role, '{}'::jsonb);
end;
$$;

-- Completion collects carried fees with the fare and credits the driver who was cancelled on.
create or replace function public.driver_complete_trip(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid       uuid := public.require_active_user();
  v_b         public.bookings := public._lock_driver_booking(p_booking_id, v_uid);
  v_rule      public.fare_rules;
  v_trip      public.trips;
  v_tracked   integer;
  v_straight  integer;
  v_cap       integer;
  v_billed    integer;
  v_bill_dur  integer;
  v_source    text;
  v_duration  integer;
  v_stops     integer;
  v_fare      jsonb;
  v_final     bigint;
  v_comm      bigint;
  v_end       extensions.geography;
  v_end_dist  integer;
  v_near      boolean;
  v_fees      bigint := 0;
  v_fee       record;
  v_fee_driver uuid;
  v_fee_bps   integer;
begin
  if v_b.status = 'COMPLETED' then return v_b; end if;
  if v_b.status <> 'IN_PROGRESS' then raise exception 'trip not in progress' using errcode = '55000'; end if;

  select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
  select * into v_trip from public.trips where booking_id = p_booking_id for update;
  select dl.location into v_end from public.driver_locations dl where dl.driver_id = v_uid;
  select round(extensions.st_distance(dl.location, v_b.dropoff))::integer into v_end_dist
    from public.driver_locations dl
   where dl.driver_id = v_uid
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));
  v_near := v_end_dist is not null and v_end_dist <= coalesce(public.config_int('trip.dropoff_radius_m'), 500);

  select round(coalesce(extensions.st_length(extensions.st_makeline(tl.location::extensions.geometry order by tl.recorded_at)::extensions.geography), 0))::integer
    into v_tracked
    from public.trip_locations tl
   where tl.trip_id = v_trip.id and tl.accuracy_m <= public.config_int('gps.billing_accuracy_m');
  v_straight := round(coalesce(extensions.st_distance(coalesce(v_trip.start_location, v_b.pickup), v_end), 0)
                      * public.config_numeric('fare.road_factor'))::integer;
  v_cap := round(v_b.estimated_distance_m * public.config_numeric('fare.max_distance_ratio'))::integer;
  v_duration := greatest(0, extract(epoch from now() - v_trip.started_at))::integer;
  v_bill_dur := v_duration;

  if v_near and coalesce(public.config_bool('fare.upfront_pricing'), true)
     and v_tracked <= v_b.estimated_distance_m * coalesce(public.config_numeric('fare.upfront_tolerance'), 1.25) then
    v_billed := v_b.estimated_distance_m;
    v_bill_dur := v_b.estimated_duration_s;
    v_source := 'upfront';
  elsif v_near and v_tracked >= v_b.estimated_distance_m * public.config_numeric('fare.min_track_coverage') then
    v_billed := least(v_tracked, v_cap);
    v_source := 'gps_track';
  elsif v_near then
    v_billed := v_b.estimated_distance_m;
    v_source := 'estimate';
  else
    v_billed := least(greatest(v_tracked, v_straight), v_cap);
    v_source := case when v_tracked >= v_straight then 'gps_track' else 'straight_line' end;
  end if;
  select count(*) into v_stops from public.booking_stops where booking_id = p_booking_id and kind = 'stop';

  if v_b.agreed_fare_minor is not null then
    v_final := greatest(v_b.agreed_fare_minor - v_b.discount_minor, 0);
    v_comm  := round(v_b.agreed_fare_minor::numeric * v_rule.commission_bps / 10000);
    v_fare  := jsonb_build_object('gross_minor', v_b.agreed_fare_minor, 'discount_minor', least(v_b.discount_minor, v_b.agreed_fare_minor),
                                  'total_minor', v_final, 'commission_minor', v_comm,
                                  'driver_net_minor', v_b.agreed_fare_minor - v_comm, 'fixed_price', true);
  else
    v_fare  := public.compute_fare(v_rule, v_billed, v_bill_dur, v_stops, v_trip.waiting_s, v_b.discount_minor);
    v_final := (v_fare->>'total_minor')::bigint;
    v_comm  := (v_fare->>'commission_minor')::bigint;
  end if;

  -- Unpaid cancellation / no-show fees from earlier rides (same currency) are collected with this fare.
  for v_fee in
    select p.id, p.booking_id, p.amount_minor from public.payments p
     where p.payer_id = v_b.passenger_id and p.currency = v_b.currency and p.status = 'pending'
       and p.idempotency_key like 'cancel-fee:%' and p.created_at <= v_b.created_at
     order by p.created_at
     for update
  loop
    v_fees := v_fees + v_fee.amount_minor;
    update public.payments set status = 'succeeded', confirmed_at = now(),
           collected_by_driver_id = case when v_b.payment_method = 'cash' then v_uid end
     where id = v_fee.id;
    insert into public.payment_transactions(payment_id, kind, provider_status, payload)
    values (v_fee.id, 'manual', 'carried_over', jsonb_build_object('collected_with_booking', p_booking_id));
    -- The driver who drove to the pickup and was cancelled on gets the fee, minus commission.
    select ba.driver_id into v_fee_driver from public.booking_assignments ba
     where ba.booking_id = v_fee.booking_id and ba.release_reason in ('booking_cancelled', 'passenger_no_show')
     order by ba.released_at desc limit 1;
    if v_fee_driver is not null then
      select fr.commission_bps into v_fee_bps from public.bookings ob join public.fare_rules fr on fr.id = ob.fare_rule_id
       where ob.id = v_fee.booking_id;
      insert into public.driver_wallet_entries(driver_id, currency, kind, amount_minor, reference, booking_id, note)
      select v_fee_driver, v_b.currency, 'cancellation_fee',
             v_fee.amount_minor - round(v_fee.amount_minor::numeric * coalesce(v_fee_bps, 0) / 10000)::bigint,
             'cancel-fee:' || v_fee.booking_id, v_fee.booking_id, 'Cancellation fee collected'
       where v_fee.amount_minor - round(v_fee.amount_minor::numeric * coalesce(v_fee_bps, 0) / 10000)::bigint <> 0
      on conflict (reference) do nothing;
    end if;
  end loop;
  v_final := v_final + v_fees;

  update public.trips set ended_at = now(), end_location = v_end, tracked_distance_m = v_tracked,
         billed_distance_m = v_billed, duration_s = v_duration, distance_source = v_source
   where id = v_trip.id;

  update public.bookings set completed_at = now(), final_fare_minor = v_final where id = p_booking_id;
  update public.booking_stops set arrived_at = coalesce(arrived_at, now()) where booking_id = p_booking_id and kind = 'dropoff';

  insert into public.fare_breakdowns(booking_id, kind, currency, base_minor, distance_minor, time_minor, stops_minor,
    waiting_minor, booking_fee_minor, minimum_adjustment_minor, rounding_minor, discount_minor, cancellation_minor, total_minor,
    commission_minor, driver_net_minor, distance_m, duration_s, waiting_s)
  values (p_booking_id, 'final', v_b.currency,
    coalesce((v_fare->>'base_minor')::bigint, 0), coalesce((v_fare->>'distance_minor')::bigint, 0),
    coalesce((v_fare->>'time_minor')::bigint, 0), coalesce((v_fare->>'stops_minor')::bigint, 0),
    coalesce((v_fare->>'waiting_minor')::bigint, 0), coalesce((v_fare->>'booking_fee_minor')::bigint, 0),
    coalesce((v_fare->>'minimum_adjustment_minor')::bigint, 0), coalesce((v_fare->>'rounding_minor')::bigint, 0),
    (v_fare->>'discount_minor')::bigint, v_fees, v_final, v_comm, (v_fare->>'driver_net_minor')::bigint,
    v_billed, v_duration, v_trip.waiting_s);

  insert into public.platform_commissions(booking_id, driver_id, currency, fare_minor, rate_bps, amount_minor)
  values (p_booking_id, v_uid, v_b.currency, (v_fare->>'gross_minor')::bigint, v_rule.commission_bps, v_comm);
  insert into public.driver_earnings(driver_id, booking_id, currency, gross_minor, commission_minor, net_minor, payment_method)
  values (v_uid, p_booking_id, v_b.currency, (v_fare->>'gross_minor')::bigint, v_comm,
          (v_fare->>'gross_minor')::bigint - v_comm, v_b.payment_method);

  insert into public.payments(booking_id, payer_id, method, provider, status, amount_minor, currency, idempotency_key,
                              collected_by_driver_id)
  values (p_booking_id, v_b.passenger_id, v_b.payment_method, v_b.payment_method::text, 'pending', v_final, v_b.currency,
          'fare:' || p_booking_id, case when v_b.payment_method = 'cash' then v_uid end)
  on conflict (idempotency_key) do nothing;
  if v_b.payment_method = 'cash' then
    -- Expected cash includes any carried fee, so the collecting driver owes it on to the platform.
    insert into public.cash_reconciliation(driver_id, booking_id, currency, expected_minor)
    values (v_uid, p_booking_id, v_b.currency, v_final);
  end if;

  update public.booking_assignments set released_at = now(), release_reason = 'completed'
   where booking_id = p_booking_id and released_at is null;
  update public.drivers set completed_trips = completed_trips + 1 where id = v_uid;
  update public.passengers set completed_trips = completed_trips + 1 where id = v_b.passenger_id;
  update public.chat_conversations set closed_at = now() where booking_id = p_booking_id;

  insert into public.notifications(user_id, kind, title, body, data)
  values (v_b.passenger_id, 'booking.completed', 'Trip complete',
          'Your trip has ended. Please rate your driver.', jsonb_build_object('booking_id', p_booking_id));

  return public._transition_booking(p_booking_id, 'COMPLETED', 'driver',
    jsonb_build_object('final_fare_minor', v_final, 'billed_distance_m', v_billed, 'distance_source', v_source,
                       'tracked_distance_m', v_tracked, 'distance_to_dropoff_m', v_end_dist, 'carried_fees_minor', v_fees));
end;
$$;

-- Booking view: + outstanding_fee_minor.
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
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (v_b.passenger_id = v_uid or v_b.driver_id = v_uid or public.is_staff()) then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  v_is_pax := v_b.passenger_id = v_uid;
  v_active := v_b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');

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
    select jsonb_build_object('name', split_part(coalesce(p.full_name, 'Passenger'), ' ', 1),
                              'rating', pa.rating_avg,
                              'phone', case when v_active or public.is_staff() then p.phone end)
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

-- ---------------------------------------------------------------------
-- Push (review of 0028): kick only when a row was queued, once per transaction.
-- ---------------------------------------------------------------------
drop trigger push_outbox_kick on public.push_outbox;
drop function public.tg_push_outbox_kick();

create or replace function public._push_kick()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text := nullif(btrim(coalesce(public.config_text('push.dispatch_url'), '')), '');
  v_key text;
begin
  if v_url is null or current_setting('app.push_kicked', true) = '1' then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_invoke_key';
  if v_key is null then return; end if;
  -- One request per transaction is enough: the function drains the whole queue after commit.
  perform set_config('app.push_kicked', '1', true);
  perform net.http_post(url := v_url, body := '{}'::jsonb,
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', v_key),
                        timeout_milliseconds := 10000);
exception when others then
  raise warning 'push kick failed: %', sqlerrm;
end;
$$;

create or replace function public._push_enqueue(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_urgent boolean, p_ttl_seconds integer)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.push_outbox(user_id, kind, title, body, data, urgent, ttl_seconds)
  select p_user_id, p_kind, left(p_title, 120), left(p_body, 300), coalesce(p_data, '{}'::jsonb), p_urgent,
         least(greatest(coalesce(p_ttl_seconds, 300), 0), 86400)
   where exists (select 1 from public.push_subscriptions s where s.user_id = p_user_id);
  if found then
    perform public._push_kick();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke execute on function
  public.driver_balance(uuid, public.currency_code),
  public.driver_debt_limit(public.currency_code),
  public.driver_over_debt_limit(uuid),
  public.driver_wallet(),
  public.admin_driver_balances(),
  public.admin_record_driver_topup(uuid, public.currency_code, bigint, text, text, text),
  public.my_outstanding_fees()
  from public, anon, authenticated;
grant execute on function
  public.driver_wallet(),
  public.admin_driver_balances(),
  public.admin_record_driver_topup(uuid, public.currency_code, bigint, text, text, text),
  public.my_outstanding_fees()
  to authenticated;
