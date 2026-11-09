-- =====================================================================
-- LiberiaRide · 0011 · Administrative RPCs (permission-checked + audited)
-- =====================================================================

create or replace function public.admin_review_driver(
  p_driver_id uuid, p_decision public.driver_status, p_note text default null)
returns public.drivers
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_before public.drivers;
  v_after  public.drivers;
begin
  perform public.require_permission(case when p_decision = 'suspended' then 'drivers.suspend' else 'drivers.review' end);
  select * into v_before from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'driver not found' using errcode = 'P0002'; end if;
  if p_decision in ('rejected', 'suspended') and coalesce(btrim(p_note), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  update public.drivers set
    status = p_decision,
    is_online = case when p_decision = 'approved' then is_online else false end,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note,
    suspended_reason = case when p_decision = 'suspended' then p_note else null end
  where id = p_driver_id returning * into v_after;

  if p_decision <> 'approved' then
    perform public.reject_offer(o.id, 'driver_' || p_decision::text)
       from public.booking_offers o where o.driver_id = p_driver_id and o.status = 'pending';
  end if;

  insert into public.notifications(user_id, kind, title, body)
  values (p_driver_id, 'driver.review', 'Driver account ' || p_decision::text,
          coalesce(p_note, case when p_decision = 'approved' then 'You can now go online.' end));
  perform public.write_audit('driver.' || p_decision::text, 'drivers', p_driver_id::text,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_after.status), p_note);
  return v_after;
end;
$$;

create or replace function public.admin_review_vehicle(p_vehicle_id uuid, p_decision public.review_status, p_note text default null)
returns public.vehicles
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_before public.vehicles;
  v_after  public.vehicles;
begin
  perform public.require_permission('drivers.review');
  select * into v_before from public.vehicles where id = p_vehicle_id for update;
  if not found then raise exception 'vehicle not found' using errcode = 'P0002'; end if;
  update public.vehicles set status = p_decision, reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note
   where id = p_vehicle_id returning * into v_after;
  perform public.write_audit('vehicle.' || p_decision::text, 'vehicles', p_vehicle_id::text,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_after.status), p_note);
  return v_after;
end;
$$;

create or replace function public.admin_review_document(p_document_id uuid, p_decision public.review_status, p_note text default null)
returns public.driver_documents
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_before public.driver_documents;
  v_after  public.driver_documents;
begin
  perform public.require_permission('drivers.review');
  select * into v_before from public.driver_documents where id = p_document_id for update;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  update public.driver_documents set status = p_decision, reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note
   where id = p_document_id returning * into v_after;
  perform public.write_audit('document.' || p_decision::text, 'driver_documents', p_document_id::text,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_after.status), p_note);
  return v_after;
end;
$$;

create or replace function public.admin_set_user_suspension(p_user_id uuid, p_suspended boolean, p_reason text)
returns public.profiles
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p public.profiles;
begin
  perform public.require_permission('users.suspend');
  if p_user_id = (select auth.uid()) then raise exception 'cannot suspend yourself' using errcode = '22023'; end if;
  if public.has_any_role(array['super_admin']::public.app_role[]) is false
     and exists (select 1 from public.user_roles where user_id = p_user_id and role in ('admin', 'super_admin')) then
    raise exception 'only a super administrator can suspend administrators' using errcode = '42501';
  end if;
  if p_suspended and coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;

  update public.profiles set is_suspended = p_suspended,
         suspended_reason = case when p_suspended then p_reason end,
         suspended_at = case when p_suspended then now() end
   where id = p_user_id returning * into v_p;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if p_suspended then
    update public.drivers set is_online = false where id = p_user_id;
  end if;
  perform public.write_audit(case when p_suspended then 'user.suspend' else 'user.unsuspend' end,
    'profiles', p_user_id::text, null, jsonb_build_object('is_suspended', p_suspended), p_reason);
  return v_p;
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('roles.manage');
  if p_role = 'super_admin' and not public.has_role('super_admin') then
    raise exception 'only a super administrator can grant super_admin' using errcode = '42501';
  end if;
  if p_grant then
    insert into public.user_roles(user_id, role, granted_by) values (p_user_id, p_role, (select auth.uid()))
    on conflict do nothing;
  else
    if p_user_id = (select auth.uid()) and p_role in ('admin', 'super_admin') then
      raise exception 'cannot remove your own administrator role' using errcode = '22023';
    end if;
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
  perform public.write_audit(case when p_grant then 'role.grant' else 'role.revoke' end, 'user_roles', p_user_id::text,
    null, jsonb_build_object('role', p_role));
end;
$$;

-- Manual allocation by an operator.
create or replace function public.admin_assign_driver(p_booking_id uuid, p_driver_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b public.bookings;
begin
  perform public.require_permission('bookings.assign');
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if v_b.status not in ('SEARCHING_DRIVER', 'DRIVER_OFFERED') then
    raise exception 'booking cannot be assigned in status %', v_b.status using errcode = '55000';
  end if;
  if not exists (select 1 from public.drivers d join public.vehicles v on v.id = d.current_vehicle_id
                  join public.profiles p on p.id = d.id
                  where d.id = p_driver_id and d.status = 'approved' and v.status = 'approved'
                    and v.category_id = v_b.category_id and not p.is_suspended) then
    raise exception 'driver is not eligible for this booking' using errcode = '42501';
  end if;
  if exists (select 1 from public.booking_assignments where driver_id = p_driver_id and released_at is null) then
    raise exception 'driver is busy with another ride' using errcode = '55000';
  end if;
  update public.booking_offers set status = 'cancelled', responded_at = now(), response_reason = 'manual_assignment'
   where driver_id = p_driver_id and status = 'pending';

  v_b := public._assign_driver(p_booking_id, p_driver_id, 'manual', null, null, null, 'admin');
  insert into public.notifications(user_id, kind, title, body, data)
  values (p_driver_id, 'booking.assigned', 'New ride assigned', 'An operator assigned you a ride.',
          jsonb_build_object('booking_id', p_booking_id));
  perform public.write_audit('booking.assign', 'bookings', p_booking_id::text, null,
    jsonb_build_object('driver_id', p_driver_id), p_reason);
  return v_b;
end;
$$;

create or replace function public.admin_cancel_booking(p_booking_id uuid, p_reason text, p_charge_fee boolean default false)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_b public.bookings;
begin
  perform public.require_permission('bookings.cancel');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.status = 'IN_PROGRESS' then
    -- Operators can terminate a running trip as FAILED (e.g. breakdown, safety).
    update public.booking_assignments set released_at = now(), release_reason = 'admin_failed'
     where booking_id = p_booking_id and released_at is null;
    v_b := public._transition_booking(p_booking_id, 'FAILED', 'admin', jsonb_build_object('reason', p_reason));
  else
    v_b := public._cancel_booking(p_booking_id, 'admin', p_reason, p_charge_fee);
  end if;
  perform public.write_audit('booking.cancel', 'bookings', p_booking_id::text, null,
    jsonb_build_object('status', v_b.status, 'fee', p_charge_fee), p_reason);
  return v_b;
end;
$$;

-- Fare rules are versioned: the active rule is closed and a new row inserted.
create or replace function public.admin_upsert_fare_rule(p_rule jsonb)
returns public.fare_rules
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old public.fare_rules;
  v_new public.fare_rules;
  v_cat uuid := (p_rule->>'category_id')::uuid;
  v_cur public.currency_code := (p_rule->>'currency')::public.currency_code;
  v_geo uuid := nullif(p_rule->>'geofence_id', '')::uuid;
begin
  perform public.require_permission('fares.manage');
  select * into v_old from public.fare_rules
   where category_id = v_cat and currency = v_cur and geofence_id is not distinct from v_geo and is_active
   for update;
  if found then
    update public.fare_rules set is_active = false, valid_to = now() where id = v_old.id;
  end if;

  insert into public.fare_rules(category_id, geofence_id, currency, base_fare_minor, per_km_minor, per_minute_minor,
    minimum_fare_minor, booking_fee_minor, per_stop_minor, waiting_free_minutes, waiting_per_minute_minor,
    cancellation_fee_minor, cancellation_grace_seconds, rounding_increment_minor, commission_bps,
    bidding_enabled, bid_min_pct, bid_max_pct, created_by)
  values (v_cat, v_geo, v_cur,
    (p_rule->>'base_fare_minor')::bigint, (p_rule->>'per_km_minor')::bigint, (p_rule->>'per_minute_minor')::bigint,
    (p_rule->>'minimum_fare_minor')::bigint, coalesce((p_rule->>'booking_fee_minor')::bigint, 0),
    coalesce((p_rule->>'per_stop_minor')::bigint, 0), coalesce((p_rule->>'waiting_free_minutes')::smallint, 3),
    coalesce((p_rule->>'waiting_per_minute_minor')::bigint, 0), coalesce((p_rule->>'cancellation_fee_minor')::bigint, 0),
    coalesce((p_rule->>'cancellation_grace_seconds')::integer, 120), coalesce((p_rule->>'rounding_increment_minor')::bigint, 1),
    (p_rule->>'commission_bps')::integer, coalesce((p_rule->>'bidding_enabled')::boolean, false),
    coalesce((p_rule->>'bid_min_pct')::smallint, 80), coalesce((p_rule->>'bid_max_pct')::smallint, 150),
    (select auth.uid()))
  returning * into v_new;

  perform public.write_audit('fare_rule.update', 'fare_rules', v_new.id::text,
    case when v_old.id is not null then to_jsonb(v_old) end, to_jsonb(v_new), p_rule->>'reason');
  return v_new;
end;
$$;

create or replace function public.admin_set_config(p_key text, p_value jsonb, p_reason text default null)
returns public.configuration_settings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old public.configuration_settings;
  v_new public.configuration_settings;
begin
  perform public.require_permission('config.manage');
  select * into v_old from public.configuration_settings where key = p_key for update;
  if not found then raise exception 'unknown setting %', p_key using errcode = 'P0002'; end if;
  if jsonb_typeof(p_value) <> jsonb_typeof(v_old.value) then
    raise exception 'setting % expects a %', p_key, jsonb_typeof(v_old.value) using errcode = '22023';
  end if;
  update public.configuration_settings set value = p_value, updated_by = (select auth.uid()), updated_at = now()
   where key = p_key returning * into v_new;
  perform public.write_audit('config.update', 'configuration_settings', p_key,
    jsonb_build_object('value', v_old.value), jsonb_build_object('value', p_value), p_reason);
  return v_new;
end;
$$;

create or replace function public.admin_update_case(
  p_table text, p_id uuid, p_status public.case_status, p_assign_to uuid default null, p_resolution text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('safety.manage');
  if p_table = 'safety_incidents' then
    update public.safety_incidents set status = p_status, assigned_to = coalesce(p_assign_to, assigned_to),
      acknowledged_at = case when p_status <> 'open' then coalesce(acknowledged_at, now()) end,
      resolved_at = case when p_status in ('resolved', 'closed') then now() end,
      resolution = coalesce(p_resolution, resolution)
     where id = p_id;
  elsif p_table = 'complaints' then
    update public.complaints set status = p_status, assigned_to = coalesce(p_assign_to, assigned_to),
      resolved_at = case when p_status in ('resolved', 'closed') then now() end,
      resolution = coalesce(p_resolution, resolution)
     where id = p_id;
  else
    raise exception 'unknown case table' using errcode = '22023';
  end if;
  if not found then raise exception 'case not found' using errcode = 'P0002'; end if;
  perform public.write_audit('case.' || p_status::text, p_table, p_id::text, null,
    jsonb_build_object('status', p_status, 'assigned_to', p_assign_to), p_resolution);
end;
$$;

create or replace function public.admin_reconcile_cash(p_reconciliation_id uuid, p_collected_minor bigint, p_note text)
returns public.cash_reconciliation
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_r public.cash_reconciliation;
begin
  perform public.require_permission('finance.manage');
  update public.cash_reconciliation set collected_minor = p_collected_minor,
         status = 'resolved', note = p_note, reconciled_by = (select auth.uid()), reconciled_at = now()
   where id = p_reconciliation_id returning * into v_r;
  if not found then raise exception 'reconciliation not found' using errcode = 'P0002'; end if;
  perform public.write_audit('cash.reconcile', 'cash_reconciliation', p_reconciliation_id::text, null, to_jsonb(v_r), p_note);
  return v_r;
end;
$$;

-- Build a settlement from all unsettled earnings of a driver in one currency.
create or replace function public.admin_create_settlement(p_driver_id uuid, p_currency public.currency_code)
returns public.driver_settlements
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s public.driver_settlements;
  v_gross bigint; v_comm bigint; v_cash bigint;
  v_from timestamptz; v_to timestamptz;
begin
  perform public.require_permission('finance.manage');
  select coalesce(sum(gross_minor), 0), coalesce(sum(commission_minor), 0),
         coalesce(sum(gross_minor) filter (where payment_method = 'cash'), 0),
         min(created_at), max(created_at)
    into v_gross, v_comm, v_cash, v_from, v_to
    from public.driver_earnings where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  if v_from is null then raise exception 'nothing to settle' using errcode = '55000'; end if;

  insert into public.driver_settlements(driver_id, currency, period_start, period_end, gross_minor, commission_minor,
    cash_collected_minor, net_payable_minor, status, created_by)
  values (p_driver_id, p_currency, v_from, v_to + interval '1 second', v_gross, v_comm, v_cash,
          v_gross - v_comm - v_cash, 'pending', (select auth.uid()))
  returning * into v_s;

  update public.driver_earnings set settlement_id = v_s.id
   where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  update public.cash_reconciliation set settlement_id = v_s.id
   where driver_id = p_driver_id and currency = p_currency and settlement_id is null;
  perform public.write_audit('settlement.create', 'driver_settlements', v_s.id::text, null, to_jsonb(v_s));
  return v_s;
end;
$$;

create or replace function public.admin_mark_settlement_paid(p_settlement_id uuid, p_reference text)
returns public.driver_settlements
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s public.driver_settlements;
begin
  perform public.require_permission('finance.manage');
  update public.driver_settlements set status = 'paid', paid_at = now(), payout_reference = p_reference
   where id = p_settlement_id and status = 'pending' returning * into v_s;
  if not found then raise exception 'pending settlement not found' using errcode = 'P0002'; end if;
  perform public.write_audit('settlement.paid', 'driver_settlements', p_settlement_id::text, null, to_jsonb(v_s), p_reference);
  return v_s;
end;
$$;

-- Operational KPIs for the admin dashboard (single round-trip).
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_fresh interval := make_interval(secs => public.config_int('dispatch.location_fresh_seconds'));
begin
  if not public.is_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'passengers', (select count(*) from public.passengers),
    'drivers_registered', (select count(*) from public.drivers),
    'drivers_verified', (select count(*) from public.drivers where status = 'approved'),
    'drivers_pending', (select count(*) from public.drivers where status = 'pending'),
    'drivers_online', (select count(*) from public.drivers d join public.driver_locations dl on dl.driver_id = d.id
                        where d.is_online and dl.received_at > now() - v_fresh),
    'rides_active', (select count(*) from public.bookings where status in
                      ('SEARCHING_DRIVER', 'DRIVER_OFFERED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS')),
    'rides_completed_today', (select count(*) from public.bookings where status = 'COMPLETED'
                               and completed_at >= date_trunc('day', now() at time zone 'Africa/Monrovia') at time zone 'Africa/Monrovia'),
    'rides_completed', (select count(*) from public.bookings where status = 'COMPLETED'),
    'rides_cancelled', (select count(*) from public.bookings where status = 'CANCELLED'),
    'rides_expired', (select count(*) from public.bookings where status = 'EXPIRED'),
    'revenue', (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) from
                 (select currency, sum(final_fare_minor) total from public.bookings where status = 'COMPLETED' group by currency) t),
    'commissions', (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) from
                 (select currency, sum(amount_minor) total from public.platform_commissions group by currency) t),
    'open_sos', (select count(*) from public.safety_incidents where kind = 'sos' and status in ('open', 'acknowledged')),
    'open_complaints', (select count(*) from public.complaints where status in ('open', 'acknowledged', 'investigating')),
    'qls_calls_24h', (select count(*) from public.qls_usage where billed and created_at > now() - interval '24 hours')
  );
end;
$$;

-- Live map feed for operators: drivers with freshness + active bookings.
create or replace function public.admin_live_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_fresh integer := public.config_int('dispatch.location_fresh_seconds');
begin
  if not public.is_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'drivers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', p.full_name, 'online', d.is_online,
        'busy', exists (select 1 from public.booking_assignments ba where ba.driver_id = d.id and ba.released_at is null),
        'lat', extensions.st_y(dl.location::extensions.geometry), 'lng', extensions.st_x(dl.location::extensions.geometry),
        'heading', dl.heading_deg, 'accuracy_m', dl.accuracy_m, 'received_at', dl.received_at,
        'age_s', extract(epoch from now() - dl.received_at)::integer,
        'fresh', dl.received_at > now() - make_interval(secs => v_fresh))), '[]'::jsonb)
      from public.drivers d join public.profiles p on p.id = d.id
      join public.driver_locations dl on dl.driver_id = d.id
      where d.status = 'approved' and (d.is_online or dl.received_at > now() - interval '30 minutes')),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'code', b.code, 'status', b.status, 'driver_id', b.driver_id,
        'pickup', jsonb_build_object('lat', extensions.st_y(b.pickup::extensions.geometry), 'lng', extensions.st_x(b.pickup::extensions.geometry), 'address', b.pickup_address),
        'dropoff', jsonb_build_object('lat', extensions.st_y(b.dropoff::extensions.geometry), 'lng', extensions.st_x(b.dropoff::extensions.geometry), 'address', b.dropoff_address),
        'created_at', b.created_at)), '[]'::jsonb)
      from public.bookings b
      where b.status in ('SEARCHING_DRIVER', 'DRIVER_OFFERED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'))
  );
end;
$$;
