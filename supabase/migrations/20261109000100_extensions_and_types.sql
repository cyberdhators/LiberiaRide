-- =====================================================================
-- LiberiaRide · 0001 · Extensions, enum types, shared helpers
-- =====================================================================
-- Conventions used across all migrations
--   * Money is stored as BIGINT minor units (cents) + currency_code. Never float.
--   * Geography columns are extensions.geography(Point, 4326) (lon/lat, metres).
--   * Every SECURITY DEFINER function pins `search_path = public, extensions, pg_temp`.
--     That is only safe because untrusted roles cannot CREATE in public (revoked below).
--   * Clients write sensitive state ONLY through RPC functions; tables expose
--     read access via RLS and a small set of column-limited direct writes.
-- =====================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Harden the public schema: API roles may use it but never create objects in it,
-- so a pinned search_path cannot be hijacked by shadowing functions/operators.
revoke create on schema public from public;
revoke create on schema public from anon, authenticated;

-- ---------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------
create type public.app_role as enum (
  'passenger', 'driver', 'fleet_operator', 'support_agent', 'admin', 'super_admin'
);

create type public.booking_status as enum (
  'DRAFT', 'FARE_ESTIMATED', 'PENDING_CONFIRMATION', 'SEARCHING_DRIVER',
  'DRIVER_OFFERED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED',
  'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'
);

create type public.driver_status       as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.review_status       as enum ('pending', 'approved', 'rejected');
create type public.document_type       as enum ('driver_licence', 'vehicle_registration', 'insurance', 'national_id', 'profile_photo', 'vehicle_photo', 'other');
create type public.currency_code       as enum ('USD', 'LRD');
create type public.payment_method      as enum ('cash', 'orange_money', 'mtn_momo');
create type public.payment_status      as enum ('pending', 'initiated', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');
create type public.offer_status        as enum ('pending', 'accepted', 'rejected', 'expired', 'cancelled');
create type public.allocation_strategy as enum ('nearest', 'sequential', 'soft', 'broadcast', 'manual');
create type public.bid_party           as enum ('passenger', 'driver');
create type public.bid_status          as enum ('open', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn');
create type public.booking_channel     as enum ('web', 'whatsapp', 'admin');
create type public.stop_kind           as enum ('pickup', 'stop', 'dropoff');
create type public.incident_kind       as enum ('sos', 'safety', 'accident', 'harassment', 'vehicle', 'other');
create type public.case_status         as enum ('open', 'acknowledged', 'investigating', 'resolved', 'closed');
create type public.settlement_status   as enum ('draft', 'pending', 'paid', 'cancelled');
create type public.reconciliation_status as enum ('pending', 'matched', 'variance', 'resolved');
create type public.message_direction   as enum ('inbound', 'outbound');
create type public.saved_location_kind as enum ('saved', 'recent');

-- ---------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Money helpers (integer minor units, half-up rounding to an increment)
-- ---------------------------------------------------------------------
-- round_minor(1234, 25) -> 1225 ; round_minor(1238, 25) -> 1250
create or replace function public.round_minor(amount numeric, increment bigint)
returns bigint
language sql
immutable
parallel safe
set search_path = public, extensions, pg_temp
as $$
  select case
    when increment is null or increment <= 1 then round(amount)::bigint
    else (round(amount / increment) * increment)::bigint
  end;
$$;

-- Build a geography point from lat/lng with range validation.
create or replace function public.make_point(lat double precision, lng double precision)
returns extensions.geography
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if lat is null or lng is null or lat < -90 or lat > 90 or lng < -180 or lng > 180 then
    raise exception 'invalid coordinates (%, %)', lat, lng using errcode = '22023';
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography;
end;
$$;
