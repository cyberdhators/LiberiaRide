-- =====================================================================
-- LiberiaRide · 0030 · Fee waivers, wallet adjustments, fee commission
--
-- 1. admin_waive_fee: finance cancels a disputed cancellation / no-show fee
--    (reason required, audited, passenger notified). It is then no longer
--    carried to the passenger's next ride, and an active booking's snapshot
--    is reduced so the passenger never sees it again.
-- 2. admin_wallet_adjustment: signed correction to a driver's balance
--    (e.g. reverse an over-credit), reason required, audited.
-- 3. The commission the platform keeps from a collected cancellation fee is
--    recorded in platform_commissions (against the cancelled booking), so
--    finance reports count fee income.
-- =====================================================================

create or replace function public.admin_waive_fee(p_payment_id uuid, p_reason text)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p public.payments;
begin
  perform public.require_permission('finance.manage');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found or v_p.idempotency_key not like 'cancel-fee:%' then
    raise exception 'fee not found' using errcode = 'P0002';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'only an unpaid fee can be waived (this one is %)', v_p.status using errcode = '55000';
  end if;

  update public.payments set status = 'cancelled', failed_at = now(), failure_reason = left('waived: ' || btrim(p_reason), 300)
   where id = p_payment_id returning * into v_p;
  insert into public.payment_transactions(payment_id, kind, provider_status, payload)
  values (p_payment_id, 'manual', 'waived', jsonb_build_object('by', (select auth.uid()), 'reason', btrim(p_reason)));

  -- A ride already booked showed this fee in its price: take it back out.
  update public.bookings set outstanding_fee_minor = greatest(0, outstanding_fee_minor - v_p.amount_minor)
   where passenger_id = v_p.payer_id and currency = v_p.currency and outstanding_fee_minor > 0
     and status not in ('COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

  insert into public.notifications(user_id, kind, title, body, data)
  values (v_p.payer_id, 'booking.fee_waived', 'Fee removed',
          'LiberiaRide removed a cancellation fee of ' || v_p.currency::text || ' ' || to_char(v_p.amount_minor / 100.0, 'FM999G999G990D00')
            || ' from your account.',
          jsonb_build_object('booking_id', v_p.booking_id));
  perform public.write_audit('fee.waive', 'payments', p_payment_id::text, null, to_jsonb(v_p), p_reason);
  return v_p;
end;
$$;

create or replace function public.admin_wallet_adjustment(
  p_driver_id uuid, p_currency public.currency_code, p_amount_minor bigint, p_reason text)
returns public.driver_wallet_entries
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_e public.driver_wallet_entries;
begin
  perform public.require_permission('finance.manage');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor = 0 or abs(p_amount_minor) > 100000000 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'driver not found' using errcode = 'P0002';
  end if;
  insert into public.driver_wallet_entries(driver_id, currency, kind, amount_minor, reference, note, created_by)
  values (p_driver_id, p_currency, 'adjustment', p_amount_minor, 'adjust:' || gen_random_uuid(), left(btrim(p_reason), 300),
          (select auth.uid()))
  returning * into v_e;
  perform public.write_audit('wallet.adjust', 'driver_wallet_entries', v_e.id::text, null, to_jsonb(v_e), p_reason);
  insert into public.notifications(user_id, kind, title, body, data)
  values (p_driver_id, 'driver.wallet_adjustment', 'Balance corrected',
          case when p_amount_minor > 0 then 'LiberiaRide added ' else 'LiberiaRide deducted ' end
            || p_currency::text || ' ' || to_char(abs(p_amount_minor) / 100.0, 'FM999G999G990D00') || ': ' || left(btrim(p_reason), 120),
          jsonb_build_object('entry_id', v_e.id));
  return v_e;
end;
$$;

-- Fee commission → platform_commissions (one row per cancelled booking whose fee was collected).
create or replace function public.tg_fee_commission()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_fee  bigint;
  v_bps  integer;
begin
  if new.kind <> 'cancellation_fee' or new.booking_id is null then return null; end if;
  select p.amount_minor into v_fee from public.payments p where p.idempotency_key = 'cancel-fee:' || new.booking_id;
  select fr.commission_bps into v_bps from public.bookings b join public.fare_rules fr on fr.id = b.fare_rule_id where b.id = new.booking_id;
  if v_fee is not null and v_fee - new.amount_minor > 0 then
    insert into public.platform_commissions(booking_id, driver_id, currency, fare_minor, rate_bps, amount_minor)
    values (new.booking_id, new.driver_id, new.currency, v_fee, coalesce(v_bps, 0), v_fee - new.amount_minor)
    on conflict (booking_id) do nothing;
  end if;
  return null;
end;
$$;
create trigger driver_wallet_entries_fee_commission after insert on public.driver_wallet_entries
  for each row execute function public.tg_fee_commission();

revoke execute on function
  public.admin_waive_fee(uuid, text),
  public.admin_wallet_adjustment(uuid, public.currency_code, bigint, text),
  public.tg_fee_commission()
  from public, anon, authenticated;
grant execute on function
  public.admin_waive_fee(uuid, text),
  public.admin_wallet_adjustment(uuid, public.currency_code, bigint, text)
  to authenticated;
