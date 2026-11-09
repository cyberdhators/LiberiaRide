-- =====================================================================
-- LiberiaRide · 0003 · Locations, geofences, driver positions
-- =====================================================================
-- Freshness model:
--   recorded_at = device timestamp (untrusted clock, kept for diagnostics)
--   received_at = server timestamp (authoritative for freshness checks)
-- A driver position is "live" only if received_at > now() - config.location_fresh_seconds.
-- =====================================================================

create table public.saved_locations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         public.saved_location_kind not null default 'saved',
  label        text not null check (char_length(label) between 1 and 60),
  address_text text not null check (char_length(address_text) between 1 and 300),
  qls_code     text,                         -- QLS digital address / location code
  provider_place_id text,                    -- opaque id from the geocoding provider
  location     extensions.geography(Point, 4326) not null,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index saved_locations_user_idx on public.saved_locations(user_id, kind, last_used_at desc);
create unique index saved_locations_user_label_uq on public.saved_locations(user_id, lower(label)) where kind = 'saved';
create trigger saved_locations_updated_at before update on public.saved_locations
  for each row execute function public.set_updated_at();

-- Keep at most 20 "recent" rows per user.
create or replace function public.trim_recent_locations()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.kind = 'recent' then
    delete from public.saved_locations
     where user_id = new.user_id and kind = 'recent'
       and id in (
         select id from public.saved_locations
          where user_id = new.user_id and kind = 'recent'
          order by last_used_at desc
          offset 20
       );
  end if;
  return null;
end;
$$;
create trigger saved_locations_trim_recent after insert on public.saved_locations
  for each row execute function public.trim_recent_locations();

-- Local landmark names → coordinates ("Red Light", "ELWA Junction", "Sinkor 14th Street").
-- Many Monrovia pickups are described by landmark rather than street address.
create table public.address_aliases (
  id          uuid primary key default gen_random_uuid(),
  alias       text not null check (char_length(alias) between 2 and 120),
  normalized  text generated always as (lower(regexp_replace(trim(alias), '\s+', ' ', 'g'))) stored,
  address_text text,
  qls_code    text,
  location    extensions.geography(Point, 4326) not null,
  is_verified boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index address_aliases_normalized_uq on public.address_aliases(normalized);
create index address_aliases_location_gix on public.address_aliases using gist(location);
create trigger address_aliases_updated_at before update on public.address_aliases
  for each row execute function public.set_updated_at();

-- Geofences: service areas, airport zones, restricted areas, surge zones.
create table public.geofences (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9_]+$'),
  name        text not null,
  kind        text not null check (kind in ('service_area', 'airport', 'restricted', 'pricing_zone')),
  area        extensions.geography(MultiPolygon, 4326) not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index geofences_area_gix on public.geofences using gist(area);
create trigger geofences_updated_at before update on public.geofences
  for each row execute function public.set_updated_at();

-- Latest position per driver (one row per driver, upserted).
create table public.driver_locations (
  driver_id    uuid primary key references public.drivers(id) on delete cascade,
  location     extensions.geography(Point, 4326) not null,
  accuracy_m   real check (accuracy_m >= 0),
  heading_deg  real check (heading_deg >= 0 and heading_deg < 360),
  speed_mps    real check (speed_mps >= 0),
  recorded_at  timestamptz not null,
  received_at  timestamptz not null default now(),
  source       text not null default 'browser' check (source in ('browser', 'admin', 'test'))
);
create index driver_locations_gix on public.driver_locations using gist(location);
create index driver_locations_received_idx on public.driver_locations(received_at desc);

-- Append-only history of driver positions (retention handled by a scheduled job).
create table public.location_history (
  id          bigint generated always as identity primary key,
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  booking_id  uuid,                           -- FK added in bookings migration
  location    extensions.geography(Point, 4326) not null,
  accuracy_m  real,
  speed_mps   real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index location_history_driver_time_idx on public.location_history(driver_id, received_at desc);
create index location_history_booking_idx on public.location_history(booking_id) where booking_id is not null;

create table public.geofence_events (
  id          bigint generated always as identity primary key,
  geofence_id uuid not null references public.geofences(id) on delete cascade,
  driver_id   uuid references public.drivers(id) on delete cascade,
  booking_id  uuid,                           -- FK added in bookings migration
  event_type  text not null check (event_type in ('enter', 'exit', 'dwell')),
  location    extensions.geography(Point, 4326),
  occurred_at timestamptz not null default now()
);
create index geofence_events_geofence_time_idx on public.geofence_events(geofence_id, occurred_at desc);
create index geofence_events_driver_idx on public.geofence_events(driver_id, occurred_at desc);
