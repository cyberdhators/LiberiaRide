-- =====================================================================
-- LiberiaRide · 0012 · Row Level Security + privileges
--
-- Model (see docs/SECURITY.md):
--   1. RLS is enabled on EVERY public table. No table is left without it.
--   2. API roles (anon, authenticated) lose all table privileges, then get back:
--        - SELECT on tables (rows filtered by policies below)
--        - INSERT/UPDATE/DELETE only on a handful of user-owned tables, column-limited.
--   3. All state-changing business operations go through SECURITY DEFINER RPCs.
--      EXECUTE is revoked from PUBLIC and granted function-by-function.
--   4. service_role bypasses RLS (Supabase default) and is used only server-side.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enable RLS everywhere
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Table privileges
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant select on public.vehicle_categories to anon;

-- Future tables/functions created by migrations start locked down too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Column-limited direct writes (everything else is RPC-only)
grant update (full_name, email, avatar_path, locale, preferred_currency) on public.profiles to authenticated;
grant update (default_payment_method) on public.passengers to authenticated;
grant insert (kind, label, address_text, qls_code, provider_place_id, location),
      update (label, address_text, qls_code, provider_place_id, location, last_used_at),
      delete on public.saved_locations to authenticated;
grant insert (name, phone, relationship), update (name, phone, relationship), delete
      on public.emergency_contacts to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (conversation_id, body) on public.chat_messages to authenticated;

alter table public.saved_locations    alter column user_id   set default auth.uid();
alter table public.emergency_contacts alter column user_id   set default auth.uid();
alter table public.chat_messages      alter column sender_id set default auth.uid();

-- ---------------------------------------------------------------------
-- 3. Function privileges
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- Helpers referenced from RLS policies must be executable by the querying role.
grant execute on function
  public.has_role(public.app_role), public.has_any_role(public.app_role[]), public.has_permission(text),
  public.is_staff(), public.is_admin(), public.is_fleet_operator_of_driver(uuid)
  to authenticated;

-- Client RPCs (authenticated)
grant execute on function
  public.create_fare_estimate(text, public.currency_code, double precision, double precision, text, double precision, double precision, text, jsonb, text, text, text),
  public.create_booking(uuid, public.payment_method, text, boolean, bigint, text),
  public.confirm_booking(uuid),
  public.passenger_cancel_booking(uuid, text),
  public.passenger_accept_bid(uuid),
  public.passenger_reject_bid(uuid),
  public.register_driver(text, text, date, date, text),
  public.register_vehicle(text, text, text, smallint, text, text, text),
  public.submit_driver_document(public.document_type, text, text, uuid, text, date),
  public.driver_set_online(boolean),
  public.driver_update_location(double precision, double precision, real, real, real, timestamptz),
  public.accept_offer(uuid),
  public.reject_offer(uuid, text),
  public.driver_counter_bid(uuid, bigint),
  public.driver_mark_arriving(uuid),
  public.driver_mark_arrived(uuid),
  public.driver_start_trip(uuid),
  public.driver_record_stop(uuid, uuid, text),
  public.driver_complete_trip(uuid),
  public.driver_confirm_cash_collected(uuid, bigint),
  public.driver_cancel_booking(uuid, text),
  public.rate_booking(uuid, smallint, text[], text),
  public.raise_sos(uuid, double precision, double precision, text),
  public.report_incident(uuid, public.incident_kind, text, smallint),
  public.file_complaint(uuid, text, text),
  public.get_booking_view(uuid),
  public.admin_review_driver(uuid, public.driver_status, text),
  public.admin_review_vehicle(uuid, public.review_status, text),
  public.admin_review_document(uuid, public.review_status, text),
  public.admin_set_user_suspension(uuid, boolean, text),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_assign_driver(uuid, uuid, text),
  public.admin_cancel_booking(uuid, text, boolean),
  public.admin_upsert_fare_rule(jsonb),
  public.admin_set_config(text, jsonb, text),
  public.admin_update_case(text, uuid, public.case_status, uuid, text),
  public.admin_reconcile_cash(uuid, bigint, text),
  public.admin_create_settlement(uuid, public.currency_code),
  public.admin_mark_settlement_paid(uuid, text),
  public.admin_dashboard_stats(),
  public.admin_live_map()
  to authenticated;

-- Anonymous: trip-share link only.
grant execute on function public.get_shared_trip(text) to anon, authenticated;

-- Server-only (service_role): routed estimates, WhatsApp/admin booking creation, maintenance.
grant execute on function
  public.create_fare_estimate_routed(uuid, text, public.currency_code, double precision, double precision, text, text,
    double precision, double precision, text, text, jsonb, integer, integer, text, jsonb, text),
  public._create_booking(uuid, uuid, public.payment_method, text, public.booking_channel, bigint, text, text),
  public.run_dispatch_maintenance(),
  public.dispatch_booking(uuid)
  to service_role;

-- ---------------------------------------------------------------------
-- 4. Policies
-- Pattern: `(select auth.uid())` is evaluated once per statement (initPlan).
-- ---------------------------------------------------------------------

-- Reference data readable by any signed-in user
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy vehicle_categories_read on public.vehicle_categories for select to anon, authenticated
  using (is_active or public.is_staff());
create policy geofences_read on public.geofences for select to authenticated using (is_active or public.is_staff());
create policy address_aliases_read on public.address_aliases for select to authenticated using (is_verified or public.is_staff());
create policy fare_rules_read on public.fare_rules for select to authenticated using (is_active or public.is_staff());
create policy configuration_read on public.configuration_settings for select to authenticated
  using (is_public or public.is_admin());

-- Identity
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy passengers_read on public.passengers for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());
create policy passengers_update_own on public.passengers for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy fleets_read on public.fleets for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_staff()
         or exists (select 1 from public.drivers d where d.id = (select auth.uid()) and d.fleet_id = fleets.id));
create policy fleet_drivers_read on public.fleet_drivers for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff()
         or exists (select 1 from public.fleets f where f.id = fleet_id and f.owner_id = (select auth.uid())));

create policy drivers_read on public.drivers for select to authenticated
  using (id = (select auth.uid()) or public.is_staff() or public.is_fleet_operator_of_driver(id));
create policy vehicles_read on public.vehicles for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff()
         or exists (select 1 from public.fleets f where f.id = fleet_id and f.owner_id = (select auth.uid())));
create policy driver_documents_read on public.driver_documents for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff());

-- Location
create policy saved_locations_owner on public.saved_locations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy driver_locations_read on public.driver_locations for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff());
create policy location_history_read on public.location_history for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff());
create policy geofence_events_read on public.geofence_events for select to authenticated using (public.is_staff());

-- Pricing
create policy promotions_read on public.promotions for select to authenticated using (public.is_staff());
create policy coupons_read on public.coupons for select to authenticated
  using (assigned_user_id = (select auth.uid()) or public.is_staff());
create policy coupon_redemptions_read on public.coupon_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
create policy fare_estimates_read on public.fare_estimates for select to authenticated
  using (passenger_id = (select auth.uid()) or public.is_staff());

-- Bookings: passenger sees own; driver sees ONLY bookings assigned to them; staff sees all;
-- fleet operators see bookings served by their drivers. Drivers evaluating an offer read
-- booking_offers (denormalised, no passenger identity), never the booking row.
create or replace function public.can_read_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and (b.passenger_id = (select auth.uid())
           or b.driver_id = (select auth.uid())
           or public.is_staff()
           or (b.driver_id is not null and public.is_fleet_operator_of_driver(b.driver_id)))
  );
$$;
grant execute on function public.can_read_booking(uuid) to authenticated;

create policy bookings_read on public.bookings for select to authenticated
  using (passenger_id = (select auth.uid()) or driver_id = (select auth.uid()) or public.is_staff()
         or (driver_id is not null and public.is_fleet_operator_of_driver(driver_id)));
create policy booking_stops_read on public.booking_stops for select to authenticated
  using (public.can_read_booking(booking_id));
create policy booking_events_read on public.booking_events for select to authenticated
  using (public.can_read_booking(booking_id));
create policy booking_offers_read on public.booking_offers for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff());
create policy booking_assignments_read on public.booking_assignments for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff()
         or exists (select 1 from public.bookings b where b.id = booking_id and b.passenger_id = (select auth.uid())));
create policy booking_bids_read on public.booking_bids for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff()
         or exists (select 1 from public.bookings b where b.id = booking_id and b.passenger_id = (select auth.uid())));
create policy trips_read on public.trips for select to authenticated using (public.can_read_booking(booking_id));
create policy trip_locations_read on public.trip_locations for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and public.can_read_booking(t.booking_id)));
create policy trip_waypoints_read on public.trip_waypoints for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and public.can_read_booking(t.booking_id)));
create policy ratings_read on public.ratings for select to authenticated
  using (rater_id = (select auth.uid()) or public.is_staff());
create policy fare_breakdowns_read on public.fare_breakdowns for select to authenticated
  using ((booking_id is not null and public.can_read_booking(booking_id))
         or (fare_estimate_id is not null and exists (select 1 from public.fare_estimates fe
               where fe.id = fare_estimate_id and fe.passenger_id = (select auth.uid())))
         or public.is_staff());

-- Payments & finance
create policy payments_read on public.payments for select to authenticated
  using (payer_id = (select auth.uid()) or public.is_staff()
         or exists (select 1 from public.bookings b where b.id = booking_id and b.driver_id = (select auth.uid())));
create policy payment_transactions_read on public.payment_transactions for select to authenticated using (public.is_staff());
create policy refunds_read on public.refunds for select to authenticated
  using (public.is_staff() or exists (select 1 from public.payments p where p.id = payment_id and p.payer_id = (select auth.uid())));
create policy driver_earnings_read on public.driver_earnings for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff() or public.is_fleet_operator_of_driver(driver_id));
create policy driver_settlements_read on public.driver_settlements for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff() or public.is_fleet_operator_of_driver(driver_id));
create policy platform_commissions_read on public.platform_commissions for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff());
create policy cash_reconciliation_read on public.cash_reconciliation for select to authenticated
  using (driver_id = (select auth.uid()) or public.is_staff());

-- Communication
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (passenger_id = (select auth.uid()) or driver_id = (select auth.uid()) or public.is_staff());
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_conversations c where c.id = conversation_id
                 and (c.passenger_id = (select auth.uid()) or c.driver_id = (select auth.uid()) or public.is_staff())));
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid())
              and exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.closed_at is null
                          and (c.passenger_id = (select auth.uid()) or c.driver_id = (select auth.uid()))));
create policy realtime_events_read on public.realtime_events for select to authenticated using (public.is_staff());
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated using (public.is_staff());
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated using (public.is_staff());

-- Safety
create policy emergency_contacts_owner on public.emergency_contacts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy safety_incidents_read on public.safety_incidents for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_staff());
create policy complaints_read on public.complaints for select to authenticated
  using (complainant_id = (select auth.uid()) or public.is_staff());

-- Administration
create policy audit_logs_read on public.audit_logs for select to authenticated using (public.is_admin());
create policy qls_lookup_cache_read on public.qls_lookup_cache for select to authenticated using (public.is_admin());
create policy qls_usage_read on public.qls_usage for select to authenticated using (public.is_admin());
