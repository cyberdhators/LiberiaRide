-- =====================================================================
-- LiberiaRide · 0005 · Bookings, dispatch offers, bids, trips
-- Status changes happen ONLY through public._transition_booking()
-- (enforced by trigger), which validates the state machine and logs
-- booking_events.
-- =====================================================================

create sequence public.booking_code_seq;

create table public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique default ('LR-' || to_char(now() at time zone 'Africa/Monrovia', 'YYMMDD') || '-' || lpad(nextval('public.booking_code_seq')::text, 5, '0')),
  passenger_id          uuid not null references public.profiles(id) on delete restrict,
  category_id           uuid not null references public.vehicle_categories(id),
  channel               public.booking_channel not null default 'web',
  status                public.booking_status not null default 'DRAFT',
  idempotency_key       text not null check (char_length(idempotency_key) between 8 and 100),

  pickup                extensions.geography(Point, 4326) not null,
  pickup_address        text not null,
  pickup_qls_ref        text,
  dropoff               extensions.geography(Point, 4326) not null,
  dropoff_address       text not null,
  dropoff_qls_ref       text,

  fare_estimate_id      uuid references public.fare_estimates(id) on delete set null,
  fare_rule_id          uuid not null references public.fare_rules(id),
  currency              public.currency_code not null,
  estimated_distance_m  integer not null check (estimated_distance_m >= 0),
  estimated_duration_s  integer not null check (estimated_duration_s >= 0),
  estimated_fare_minor  bigint not null check (estimated_fare_minor >= 0),
  discount_minor        bigint not null default 0 check (discount_minor >= 0),
  agreed_fare_minor     bigint check (agreed_fare_minor >= 0),   -- set when a bid is accepted (fixed price)
  final_fare_minor      bigint check (final_fare_minor >= 0),
  coupon_id             uuid references public.coupons(id) on delete set null,
  payment_method        public.payment_method not null default 'cash',
  payment_status        public.payment_status not null default 'pending',

  allocation_strategy   public.allocation_strategy not null default 'soft',
  bidding_enabled       boolean not null default false,
  passenger_offer_minor bigint check (passenger_offer_minor > 0),
  dispatch_round        integer not null default 0 check (dispatch_round >= 0),
  search_expires_at     timestamptz,
  reserved_driver_id    uuid references public.drivers(id) on delete set null,  -- soft allocation hold
  reserved_until        timestamptz,

  driver_id             uuid references public.drivers(id) on delete set null,
  vehicle_id            uuid references public.vehicles(id) on delete set null,

  route_polyline        text,
  share_token           text unique default encode(extensions.gen_random_bytes(18), 'base64'),
  passenger_note        text check (char_length(passenger_note) <= 300),

  confirmed_at          timestamptz,
  assigned_at           timestamptz,
  arrived_at            timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid references public.profiles(id) on delete set null,
  cancelled_by_role     text check (cancelled_by_role in ('passenger', 'driver', 'admin', 'system')),
  cancel_reason         text check (char_length(cancel_reason) <= 300),
  cancellation_fee_minor bigint not null default 0 check (cancellation_fee_minor >= 0),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (passenger_id, idempotency_key),
  constraint bookings_driver_when_assigned check (
    status not in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED')
    or driver_id is not null
  ),
  constraint bookings_final_fare_when_completed check (status <> 'COMPLETED' or final_fare_minor is not null)
);
create index bookings_passenger_idx on public.bookings(passenger_id, created_at desc);
create index bookings_driver_idx on public.bookings(driver_id, created_at desc) where driver_id is not null;
create index bookings_status_idx on public.bookings(status, created_at desc);
create index bookings_searching_idx on public.bookings(search_expires_at)
  where status in ('SEARCHING_DRIVER', 'DRIVER_OFFERED');
create index bookings_pickup_gix on public.bookings using gist(pickup);
-- A passenger may have at most one ride in flight.
create unique index bookings_one_active_per_passenger on public.bookings(passenger_id)
  where status in ('PENDING_CONFIRMATION', 'SEARCHING_DRIVER', 'DRIVER_OFFERED', 'DRIVER_ASSIGNED',
                   'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');
-- A driver may serve at most one ride at a time.
create unique index bookings_one_active_per_driver on public.bookings(driver_id)
  where status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

create table public.booking_stops (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  seq         smallint not null check (seq >= 0),
  kind        public.stop_kind not null,
  location    extensions.geography(Point, 4326) not null,
  address     text not null,
  qls_ref     text,
  arrived_at  timestamptz,
  departed_at timestamptz,
  unique (booking_id, seq)
);

-- Append-only audit of every status transition.
create table public.booking_events (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  from_status public.booking_status,
  to_status   public.booking_status not null,
  event_type  text not null default 'status_change',
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  text not null check (actor_role in ('passenger', 'driver', 'admin', 'system', 'whatsapp')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events(booking_id, id);

-- Offers made to drivers by the dispatch engine.
-- Driver-facing fields are denormalised so a driver can evaluate an offer
-- WITHOUT read access to the booking row (and its passenger data).
create table public.booking_offers (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references public.bookings(id) on delete cascade,
  driver_id        uuid not null references public.drivers(id) on delete cascade,
  strategy         public.allocation_strategy not null,
  dispatch_round   integer not null,
  rank             smallint not null default 1,
  status           public.offer_status not null default 'pending',
  pickup           extensions.geography(Point, 4326) not null,
  pickup_address   text not null,
  dropoff_address  text,                -- null when config hides destination before acceptance
  category_code    text not null,
  currency         public.currency_code not null,
  fare_minor       bigint not null check (fare_minor >= 0),
  trip_distance_m  integer not null,
  trip_duration_s  integer not null,
  pickup_distance_m integer not null check (pickup_distance_m >= 0),
  bidding_enabled  boolean not null default false,
  offered_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  responded_at     timestamptz,
  response_reason  text check (char_length(response_reason) <= 200),
  constraint booking_offers_expiry check (expires_at > offered_at)
);
create unique index booking_offers_one_pending_per_pair on public.booking_offers(booking_id, driver_id) where status = 'pending';
-- A driver can hold only one pending offer at a time (prevents double-booking across bookings).
create unique index booking_offers_one_pending_per_driver on public.booking_offers(driver_id) where status = 'pending';
create index booking_offers_booking_idx on public.booking_offers(booking_id, status);
create index booking_offers_expiry_idx on public.booking_offers(expires_at) where status = 'pending';

-- Authoritative assignment history (re-assignments create new rows).
create table public.booking_assignments (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  driver_id      uuid not null references public.drivers(id) on delete restrict,
  vehicle_id     uuid references public.vehicles(id) on delete set null,
  offer_id       uuid references public.booking_offers(id) on delete set null,
  bid_id         uuid,                          -- FK added below
  method         public.allocation_strategy not null,
  assigned_by    uuid references public.profiles(id) on delete set null,
  assigned_at    timestamptz not null default now(),
  released_at    timestamptz,
  release_reason text
);
create unique index booking_assignments_one_active_per_booking on public.booking_assignments(booking_id) where released_at is null;
create unique index booking_assignments_one_active_per_driver on public.booking_assignments(driver_id) where released_at is null;
create index booking_assignments_driver_idx on public.booking_assignments(driver_id, assigned_at desc);

-- Bidding: passenger offers a price; drivers counter; passenger accepts one.
create table public.booking_bids (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings(id) on delete cascade,
  party         public.bid_party not null,
  driver_id     uuid references public.drivers(id) on delete cascade,
  offer_id      uuid references public.booking_offers(id) on delete set null,
  parent_bid_id uuid references public.booking_bids(id) on delete set null,
  amount_minor  bigint not null check (amount_minor > 0),
  currency      public.currency_code not null,
  status        public.bid_status not null default 'open',
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint booking_bids_driver_party check ((party = 'driver') = (driver_id is not null))
);
create index booking_bids_booking_idx on public.booking_bids(booking_id, status);
create unique index booking_bids_one_open_per_driver on public.booking_bids(booking_id, driver_id) where status = 'open' and party = 'driver';

alter table public.booking_assignments
  add constraint booking_assignments_bid_fk foreign key (bid_id) references public.booking_bids(id) on delete set null;

-- Trip = the physical ride once started.
create table public.trips (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null unique references public.bookings(id) on delete cascade,
  driver_id        uuid not null references public.drivers(id) on delete restrict,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  start_location   extensions.geography(Point, 4326),
  end_location     extensions.geography(Point, 4326),
  tracked_distance_m integer check (tracked_distance_m >= 0),
  billed_distance_m  integer check (billed_distance_m >= 0),
  duration_s       integer check (duration_s >= 0),
  waiting_s        integer not null default 0 check (waiting_s >= 0),
  distance_source  text check (distance_source in ('gps_track', 'estimate')),
  created_at       timestamptz not null default now()
);
create index trips_driver_idx on public.trips(driver_id, started_at desc);

create table public.trip_locations (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  location    extensions.geography(Point, 4326) not null,
  accuracy_m  real,
  speed_mps   real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index trip_locations_trip_idx on public.trip_locations(trip_id, recorded_at);

create table public.trip_waypoints (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  stop_id     uuid references public.booking_stops(id) on delete set null,
  kind        text not null check (kind in ('arrived', 'departed', 'stop_recorded')),
  location    extensions.geography(Point, 4326),
  occurred_at timestamptz not null default now()
);
create index trip_waypoints_trip_idx on public.trip_waypoints(trip_id, occurred_at);

-- Two-way ratings after completion.
create table public.ratings (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  rater_id    uuid not null references public.profiles(id) on delete cascade,
  ratee_id    uuid not null references public.profiles(id) on delete cascade,
  direction   text not null check (direction in ('passenger_to_driver', 'driver_to_passenger')),
  score       smallint not null check (score between 1 and 5),
  tags        text[] not null default '{}',
  comment     text check (char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  unique (booking_id, direction)
);
create index ratings_ratee_idx on public.ratings(ratee_id);

-- Deferred foreign keys from earlier migrations.
alter table public.location_history
  add constraint location_history_booking_fk foreign key (booking_id) references public.bookings(id) on delete set null;
alter table public.geofence_events
  add constraint geofence_events_booking_fk foreign key (booking_id) references public.bookings(id) on delete set null;
alter table public.coupon_redemptions
  add constraint coupon_redemptions_booking_fk foreign key (booking_id) references public.bookings(id) on delete cascade;
alter table public.fare_breakdowns
  add constraint fare_breakdowns_booking_fk foreign key (booking_id) references public.bookings(id) on delete cascade;
