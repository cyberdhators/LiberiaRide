-- =====================================================================
-- LiberiaRide · 0022 · Mobile-money payment state + WhatsApp channel helpers
-- All functions here are SERVICE-ROLE ONLY: they are called by server
-- route handlers after verifying the caller (session, webhook signature,
-- or provider status check). Clients cannot execute them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
-- Record that a provider request was created (never marks success).
create or replace function public.payment_mark_initiated(
  p_payment_id uuid, p_provider text, p_provider_reference text, p_payer_msisdn text, p_payload jsonb)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p public.payments;
begin
  update public.payments
     set status = 'initiated', provider = p_provider, provider_reference = p_provider_reference,
         payer_msisdn = p_payer_msisdn, initiated_at = now(), failure_reason = null
   where id = p_payment_id and status in ('pending', 'failed', 'cancelled')
  returning * into v_p;
  if not found then raise exception 'payment cannot be initiated' using errcode = '55000'; end if;
  insert into public.payment_transactions(payment_id, kind, provider_status, payload)
  values (p_payment_id, 'initiate', 'initiated', coalesce(p_payload, '{}'::jsonb));
  update public.bookings set payment_status = 'initiated' where id = v_p.booking_id;
  return v_p;
end;
$$;

-- Apply a VERIFIED provider result (from a server-side status query, not a raw callback body).
create or replace function public.payment_record_result(
  p_provider text, p_provider_reference text, p_status public.payment_status, p_kind text,
  p_failure_reason text, p_payload jsonb, p_signature_valid boolean default null)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p public.payments;
begin
  if p_status not in ('processing', 'succeeded', 'failed', 'cancelled') then
    raise exception 'unsupported result status %', p_status using errcode = '22023';
  end if;
  select * into v_p from public.payments where provider = p_provider and provider_reference = p_provider_reference for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;

  insert into public.payment_transactions(payment_id, kind, provider_status, signature_valid, payload)
  values (v_p.id, p_kind, p_status::text, p_signature_valid, coalesce(p_payload, '{}'::jsonb));

  -- Terminal states are final; late/duplicate callbacks are logged but change nothing.
  if v_p.status in ('succeeded', 'refunded', 'partially_refunded') then
    return v_p;
  end if;

  update public.payments set
    status = p_status,
    confirmed_at = case when p_status = 'succeeded' then now() else confirmed_at end,
    failed_at = case when p_status in ('failed', 'cancelled') then now() else failed_at end,
    failure_reason = case when p_status in ('failed', 'cancelled') then left(p_failure_reason, 300) else null end
  where id = v_p.id returning * into v_p;

  update public.bookings set payment_status = p_status where id = v_p.booking_id;
  if p_status = 'succeeded' then
    insert into public.notifications(user_id, kind, title, body, data)
    values (v_p.payer_id, 'payment.succeeded', 'Payment received', 'Thank you — your payment was successful.',
            jsonb_build_object('booking_id', v_p.booking_id, 'payment_id', v_p.id));
  end if;
  return v_p;
end;
$$;

-- Passenger may switch an unpaid mobile-money fare to cash (driver then confirms collection).
create or replace function public.passenger_switch_to_cash(p_booking_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_p public.payments;
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id and passenger_id = v_uid and status = 'COMPLETED' for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  update public.payments set method = 'cash', provider = 'cash', status = 'pending', collected_by_driver_id = v_b.driver_id,
         provider_reference = null
   where booking_id = p_booking_id and idempotency_key = 'fare:' || p_booking_id and status in ('pending', 'failed', 'cancelled')
  returning * into v_p;
  if not found then raise exception 'payment can no longer be changed' using errcode = '55000'; end if;
  insert into public.cash_reconciliation(driver_id, booking_id, currency, expected_minor)
  values (v_b.driver_id, p_booking_id, v_p.currency, v_p.amount_minor)
  on conflict (booking_id) where booking_id is not null do nothing;
  update public.bookings set payment_method = 'cash', payment_status = 'pending' where id = p_booking_id;
  update public.driver_earnings set payment_method = 'cash' where booking_id = p_booking_id;
  return v_p;
end;
$$;

-- ---------------------------------------------------------------------
-- WhatsApp channel (same booking engine, different front door)
-- ---------------------------------------------------------------------
-- Geodesic estimate for a passenger identified server-side (WhatsApp has no Supabase session).
create or replace function public.create_fare_estimate_for(
  p_passenger_id uuid, p_category_code text, p_currency public.currency_code,
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text,
  p_dropoff_lat double precision, p_dropoff_lng double precision, p_dropoff_address text)
returns public.fare_estimates
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_route record;
begin
  if exists (select 1 from public.profiles where id = p_passenger_id and is_suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  select * into v_route from public.geodesic_route_estimate(array[
    public.make_point(p_pickup_lat, p_pickup_lng), public.make_point(p_dropoff_lat, p_dropoff_lng)]);
  return public._insert_fare_estimate(p_passenger_id, p_category_code, p_currency,
    p_pickup_lat, p_pickup_lng, p_pickup_address, null, p_dropoff_lat, p_dropoff_lng, p_dropoff_address, null,
    '[]'::jsonb, v_route.distance_m, v_route.duration_s, 'geodesic_fallback', null, null, null);
end;
$$;

create or replace function public.whatsapp_create_booking(
  p_passenger_id uuid, p_estimate_id uuid, p_idempotency_key text)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b public.bookings;
begin
  v_b := public._create_booking(p_passenger_id, p_estimate_id, 'cash', p_idempotency_key, 'whatsapp', null, null, 'whatsapp');
  if v_b.status = 'PENDING_CONFIRMATION' then
    v_b := public.confirm_booking(v_b.id);
  end if;
  return v_b;
end;
$$;

create or replace function public.whatsapp_cancel_booking(p_passenger_id uuid, p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b    public.bookings;
  v_rule public.fare_rules;
  v_fee  boolean := false;
begin
  select * into v_b from public.bookings where id = p_booking_id and passenger_id = p_passenger_id for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if v_b.status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED') then
    select * into v_rule from public.fare_rules where id = v_b.fare_rule_id;
    v_fee := v_b.assigned_at < now() - make_interval(secs => v_rule.cancellation_grace_seconds);
  end if;
  return public._cancel_booking(p_booking_id, 'passenger', 'cancelled_via_whatsapp', v_fee);
end;
$$;

-- Outbox: booking updates for WhatsApp passengers are queued durably, then delivered
-- by the server (/api/whatsapp/outbox). Realtime cannot reach WhatsApp users.
create table public.whatsapp_outbox (
  id          bigint generated always as identity primary key,
  wa_id       text not null,
  booking_id  uuid references public.bookings(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1024),
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts    smallint not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index whatsapp_outbox_pending_idx on public.whatsapp_outbox(created_at) where status = 'pending';
alter table public.whatsapp_outbox enable row level security;
create policy whatsapp_outbox_staff_read on public.whatsapp_outbox for select to authenticated using (public.is_staff());
grant select on public.whatsapp_outbox to authenticated;

create or replace function public.tg_whatsapp_booking_updates()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_wa   text;
  v_text text;
  v_drv  record;
begin
  if new.channel <> 'whatsapp' or new.status is not distinct from old.status then
    return null;
  end if;
  select wa_id into v_wa from public.whatsapp_conversations where profile_id = new.passenger_id;
  if v_wa is null then return null; end if;

  if new.driver_id is not null then
    select split_part(coalesce(p.full_name, 'Your driver'), ' ', 1) as name, p.phone, v.color, v.make, v.model, v.plate_number
      into v_drv
      from public.profiles p left join public.vehicles v on v.id = new.vehicle_id where p.id = new.driver_id;
  end if;

  v_text := case new.status
    when 'DRIVER_ASSIGNED' then format('Driver found: %s — %s %s %s, plate %s. Call: %s. Reply CANCEL to cancel.',
                                       v_drv.name, v_drv.color, v_drv.make, v_drv.model, v_drv.plate_number, coalesce(v_drv.phone, 'n/a'))
    when 'DRIVER_ARRIVING' then format('%s is on the way to your pickup.', v_drv.name)
    when 'DRIVER_ARRIVED'  then format('%s has arrived at your pickup (%s).', v_drv.name, v_drv.plate_number)
    when 'IN_PROGRESS'     then 'Your trip has started. Have a safe ride!'
    when 'COMPLETED'       then format('Trip complete. Fare: %s %s. Please pay your driver. Thank you for riding with LiberiaRide.',
                                       new.currency, to_char(new.final_fare_minor / 100.0, 'FM999999990.00'))
    when 'CANCELLED'       then 'Your ride was cancelled.' || case when new.cancellation_fee_minor > 0
                                  then format(' A cancellation fee of %s %s applies.', new.currency, to_char(new.cancellation_fee_minor / 100.0, 'FM999999990.00')) else '' end
    when 'EXPIRED'         then 'Sorry — no driver was available. Send HI to try again.'
    else null end;
  if v_text is not null then
    insert into public.whatsapp_outbox(wa_id, booking_id, body) values (v_wa, new.id, v_text);
  end if;
  return null;
end;
$$;
create trigger bookings_whatsapp_updates after update of status on public.bookings
  for each row execute function public.tg_whatsapp_booking_updates();

revoke execute on function
  public.payment_mark_initiated(uuid, text, text, text, jsonb),
  public.payment_record_result(text, text, public.payment_status, text, text, jsonb, boolean),
  public.create_fare_estimate_for(uuid, text, public.currency_code, double precision, double precision, text, double precision, double precision, text),
  public.whatsapp_create_booking(uuid, uuid, text),
  public.whatsapp_cancel_booking(uuid, uuid),
  public.tg_whatsapp_booking_updates()
  from public, anon, authenticated;
grant execute on function
  public.payment_mark_initiated(uuid, text, text, text, jsonb),
  public.payment_record_result(text, text, public.payment_status, text, text, jsonb, boolean),
  public.create_fare_estimate_for(uuid, text, public.currency_code, double precision, double precision, text, double precision, double precision, text),
  public.whatsapp_create_booking(uuid, uuid, text),
  public.whatsapp_cancel_booking(uuid, uuid),
  public.confirm_booking(uuid)
  to service_role;
grant execute on function public.passenger_switch_to_cash(uuid) to authenticated;
grant select, insert, update on public.whatsapp_outbox, public.whatsapp_conversations, public.whatsapp_messages to service_role;
