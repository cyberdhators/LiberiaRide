-- =====================================================================
-- LiberiaRide · 0004 · Pricing: fare rules, promotions, estimates
-- All amounts are BIGINT minor units (USD cents / LRD cents).
-- =====================================================================

create table public.fare_rules (
  id                       uuid primary key default gen_random_uuid(),
  category_id              uuid not null references public.vehicle_categories(id) on delete restrict,
  geofence_id              uuid references public.geofences(id) on delete restrict, -- null = default for all areas
  currency                 public.currency_code not null,
  base_fare_minor          bigint not null check (base_fare_minor >= 0),
  per_km_minor             bigint not null check (per_km_minor >= 0),
  per_minute_minor         bigint not null check (per_minute_minor >= 0),
  minimum_fare_minor       bigint not null check (minimum_fare_minor >= 0),
  booking_fee_minor        bigint not null default 0 check (booking_fee_minor >= 0),
  per_stop_minor           bigint not null default 0 check (per_stop_minor >= 0),
  waiting_free_minutes     smallint not null default 3 check (waiting_free_minutes between 0 and 60),
  waiting_per_minute_minor bigint not null default 0 check (waiting_per_minute_minor >= 0),
  cancellation_fee_minor   bigint not null default 0 check (cancellation_fee_minor >= 0),
  cancellation_grace_seconds integer not null default 120 check (cancellation_grace_seconds between 0 and 3600),
  rounding_increment_minor bigint not null default 1 check (rounding_increment_minor >= 1),
  commission_bps           integer not null check (commission_bps between 0 and 10000),
  bidding_enabled          boolean not null default false,
  bid_min_pct              smallint not null default 80 check (bid_min_pct between 10 and 100),
  bid_max_pct              smallint not null default 150 check (bid_max_pct between 100 and 500),
  is_active                boolean not null default true,
  valid_from               timestamptz not null default now(),
  valid_to                 timestamptz,
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fare_rules_valid_window check (valid_to is null or valid_to > valid_from),
  constraint fare_rules_bid_window check (bid_min_pct <= bid_max_pct)
);
-- One active rule per (category, currency, zone). NULL zone treated as a value via coalesce.
create unique index fare_rules_active_uq
  on public.fare_rules(category_id, currency, coalesce(geofence_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;
create trigger fare_rules_updated_at before update on public.fare_rules
  for each row execute function public.set_updated_at();

create table public.promotions (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  discount_type      text not null check (discount_type in ('percent', 'fixed')),
  discount_value     bigint not null check (discount_value > 0),     -- percent: basis points; fixed: minor units
  currency           public.currency_code,                            -- required for fixed discounts
  max_discount_minor bigint check (max_discount_minor > 0),
  min_fare_minor     bigint not null default 0 check (min_fare_minor >= 0),
  category_id        uuid references public.vehicle_categories(id) on delete set null,
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  usage_limit        integer check (usage_limit > 0),
  per_user_limit     integer not null default 1 check (per_user_limit > 0),
  is_active          boolean not null default true,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint promotions_percent_range check (discount_type <> 'percent' or discount_value <= 10000),
  constraint promotions_fixed_currency check (discount_type <> 'fixed' or currency is not null),
  constraint promotions_window check (ends_at is null or ends_at > starts_at)
);
create trigger promotions_updated_at before update on public.promotions
  for each row execute function public.set_updated_at();

create table public.coupons (
  id               uuid primary key default gen_random_uuid(),
  promotion_id     uuid not null references public.promotions(id) on delete cascade,
  code             text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  assigned_user_id uuid references public.profiles(id) on delete cascade, -- null = public code
  redeemed_count   integer not null default 0 check (redeemed_count >= 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create unique index coupons_code_uq on public.coupons(code);

create table public.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  booking_id  uuid not null,                       -- FK added in bookings migration
  discount_minor bigint not null check (discount_minor >= 0),
  currency    public.currency_code not null,
  created_at  timestamptz not null default now(),
  unique (booking_id)
);
create index coupon_redemptions_user_idx on public.coupon_redemptions(coupon_id, user_id);

-- Server-computed quote. A booking can only be created from an unexpired estimate
-- owned by the same passenger; the client never supplies a price.
create table public.fare_estimates (
  id                uuid primary key default gen_random_uuid(),
  passenger_id      uuid not null references public.profiles(id) on delete cascade,
  category_id       uuid not null references public.vehicle_categories(id),
  fare_rule_id      uuid not null references public.fare_rules(id),
  currency          public.currency_code not null,
  pickup            extensions.geography(Point, 4326) not null,
  pickup_address    text not null,
  pickup_qls_ref    text,
  dropoff           extensions.geography(Point, 4326) not null,
  dropoff_address   text not null,
  dropoff_qls_ref   text,
  stops             jsonb not null default '[]'::jsonb,   -- [{lat,lng,address,qls_ref}]
  distance_m        integer not null check (distance_m >= 0),
  duration_s        integer not null check (duration_s >= 0),
  route_source      text not null check (route_source in ('qls_directions', 'geodesic_fallback')),
  route_polyline    text,
  route_steps       jsonb,
  subtotal_minor    bigint not null check (subtotal_minor >= 0),
  discount_minor    bigint not null default 0 check (discount_minor >= 0),
  total_minor       bigint not null check (total_minor >= 0),
  coupon_id         uuid references public.coupons(id) on delete set null,
  breakdown         jsonb not null,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  constraint fare_estimates_stops_array check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) <= 5)
);
create index fare_estimates_passenger_idx on public.fare_estimates(passenger_id, created_at desc);

-- Immutable line-item record for an estimate or a final fare.
create table public.fare_breakdowns (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid,                         -- FK added in bookings migration
  fare_estimate_id   uuid references public.fare_estimates(id) on delete cascade,
  kind               text not null check (kind in ('estimate', 'final', 'cancellation')),
  currency           public.currency_code not null,
  base_minor         bigint not null default 0,
  distance_minor     bigint not null default 0,
  time_minor         bigint not null default 0,
  stops_minor        bigint not null default 0,
  waiting_minor      bigint not null default 0,
  booking_fee_minor  bigint not null default 0,
  minimum_adjustment_minor bigint not null default 0,
  rounding_minor     bigint not null default 0,
  discount_minor     bigint not null default 0,
  cancellation_minor bigint not null default 0,
  total_minor        bigint not null check (total_minor >= 0),
  commission_minor   bigint not null default 0,
  driver_net_minor   bigint not null default 0,
  distance_m         integer,
  duration_s         integer,
  waiting_s          integer,
  created_at         timestamptz not null default now(),
  constraint fare_breakdowns_owner check (booking_id is not null or fare_estimate_id is not null)
);
create index fare_breakdowns_booking_idx on public.fare_breakdowns(booking_id);
