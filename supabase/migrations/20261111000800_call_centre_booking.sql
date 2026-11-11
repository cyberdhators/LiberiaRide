-- =====================================================================
-- LiberiaRide · 0036 · Call-centre booking
--
-- An operator (bookings.create) books for a caller without a smartphone.
-- The server finds or creates the caller's passenger account by phone and
-- prices the trip for that passenger (service role); the booking itself is
-- created HERE, as the operator, so permission and audit trail are enforced
-- in the database. Channel 'admin' → no ride PIN (the caller has no app);
-- the driver must instead be at the pickup to start (0026).
-- =====================================================================

create or replace function public.admin_create_booking_for(
  p_passenger_id uuid, p_estimate_id uuid, p_payment_method public.payment_method,
  p_idempotency_key text, p_note text default null, p_scheduled_for timestamptz default null)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_b   public.bookings;
begin
  perform public.require_permission('bookings.create');
  if p_passenger_id = v_uid then
    raise exception 'use the passenger app to book for yourself' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_passenger_id and is_suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  v_b := public._create_booking(p_passenger_id, p_estimate_id, p_payment_method, p_idempotency_key, 'admin',
                                null, p_note, 'admin');
  if v_b.status <> 'PENDING_CONFIRMATION' then return v_b; end if;   -- idempotent retry of the same call
  update public.bookings set created_by = v_uid where id = v_b.id;

  if p_scheduled_for is not null then
    v_b := public.schedule_booking(v_b.id, p_scheduled_for);
  else
    v_b := public.confirm_booking(v_b.id);
  end if;
  perform public.write_audit('booking.create_for', 'bookings', v_b.id::text, null,
    jsonb_build_object('passenger_id', p_passenger_id, 'code', v_b.code, 'scheduled_for', p_scheduled_for), p_note);
  return v_b;
end;
$$;

revoke execute on function public.admin_create_booking_for(uuid, uuid, public.payment_method, text, text, timestamptz) from public, anon;
grant execute on function public.admin_create_booking_for(uuid, uuid, public.payment_method, text, text, timestamptz) to authenticated;
