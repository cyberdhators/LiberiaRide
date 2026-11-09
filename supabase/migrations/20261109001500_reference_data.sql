-- =====================================================================
-- LiberiaRide · 0015 · Reference data required in every environment
-- (roles, permissions, categories, starting fares, configuration, service area)
--
-- !! PRICING BELOW IS A PLACEHOLDER FOR LAUNCH CONFIGURATION !!
-- Values are reasonable starting points for Monrovia, not market research.
-- Operators must review them in Admin → Fares before going live.
-- LRD rules assume ~190 LRD/USD and round to 10 LRD.
-- =====================================================================

insert into public.roles(code, name, description) values
  ('passenger',      'Passenger',            'Books rides'),
  ('driver',         'Driver',               'Accepts and completes rides'),
  ('fleet_operator', 'Fleet operator',       'Manages a fleet of drivers and vehicles'),
  ('support_agent',  'Support agent',        'Handles bookings, complaints and safety cases'),
  ('admin',          'Administrator',        'Operates the platform'),
  ('super_admin',    'Super administrator',  'Full control including role management')
on conflict (code) do nothing;

insert into public.permissions(code, description) values
  ('users.view',       'View passenger and driver accounts'),
  ('users.suspend',    'Suspend or reinstate accounts'),
  ('roles.manage',     'Grant and revoke roles'),
  ('drivers.review',   'Approve or reject drivers, vehicles and documents'),
  ('drivers.suspend',  'Suspend drivers'),
  ('bookings.view',    'View all bookings'),
  ('bookings.assign',  'Manually assign drivers'),
  ('bookings.cancel',  'Cancel or fail bookings'),
  ('fares.manage',     'Edit fare rules and promotions'),
  ('config.manage',    'Edit platform configuration'),
  ('safety.manage',    'Handle SOS, incidents and complaints'),
  ('finance.view',     'View payments and settlements'),
  ('finance.manage',   'Reconcile cash and manage settlements'),
  ('audit.view',       'View the audit log'),
  ('fleets.manage',    'Manage own fleet')
on conflict (code) do nothing;

insert into public.role_permissions(role, permission)
select 'super_admin'::public.app_role, code from public.permissions
union all
select 'admin'::public.app_role, code from public.permissions where code <> 'fleets.manage'
union all
select 'support_agent'::public.app_role, unnest(array['users.view', 'bookings.view', 'bookings.assign', 'bookings.cancel', 'safety.manage', 'finance.view'])
union all
select 'fleet_operator'::public.app_role, 'fleets.manage'
on conflict do nothing;

insert into public.vehicle_categories(code, name, description, seats, icon, sort_order, is_active) values
  ('keke',      'Keke',        'Tricycle — cheapest way around town', 3, 'tuk-tuk', 10, true),
  ('car',       'Car',         'Standard 4-seat car',                 4, 'car',     20, true),
  ('comfort',   'Comfort',     'Newer car with air-conditioning',     4, 'car-ac',  30, true),
  ('xl',        'XL',          'Minivan or SUV for groups',           6, 'van',     40, true),
  -- Commercial motorbikes are restricted in parts of central Monrovia; disabled until legal review.
  ('motorbike', 'Pen-pen',     'Motorbike taxi',                      1, 'bike',    5,  false)
on conflict (code) do nothing;

-- Starting fare rules (USD cents / LRD cents). Commission 15%.
insert into public.fare_rules(category_id, currency, base_fare_minor, per_km_minor, per_minute_minor, minimum_fare_minor,
  booking_fee_minor, per_stop_minor, waiting_free_minutes, waiting_per_minute_minor, cancellation_fee_minor,
  rounding_increment_minor, commission_bps, bidding_enabled)
select c.id, v.currency::public.currency_code, v.base, v.km, v.min, v.minimum, v.fee, v.stop, 3, v.wait, v.cancel, v.round, 1500, v.bid
from public.vehicle_categories c
join (values
  --  code       cur    base   km     min   minimum fee   stop  wait  cancel round  bid
  ('keke',      'USD',    50,   25,    3,    100,    0,    25,    3,    50,   25,  true),
  ('keke',      'LRD',  9000, 5000,  600,  19000,    0,  5000,  600, 10000, 1000,  true),
  ('car',       'USD',   100,   50,    5,    250,    0,    50,    5,   100,   25,  true),
  ('car',       'LRD', 19000, 9500, 1000,  48000,    0, 10000, 1000, 19000, 1000,  true),
  ('comfort',   'USD',   150,   75,    8,    400,    0,    75,    8,   150,   25,  false),
  ('comfort',   'LRD', 28000,14000, 1500,  76000,    0, 14000, 1500, 28000, 1000,  false),
  ('xl',        'USD',   200,   90,   10,    500,    0,   100,   10,   200,   25,  false),
  ('xl',        'LRD', 38000,17000, 2000,  95000,    0, 19000, 2000, 38000, 1000,  false)
) as v(code, currency, base, km, min, minimum, fee, stop, wait, cancel, round, bid) on v.code = c.code
where not exists (select 1 from public.fare_rules fr where fr.category_id = c.id and fr.currency = v.currency::public.currency_code);

insert into public.configuration_settings(key, value, description, is_public) values
  ('dispatch.default_strategy',             '"soft"', 'nearest | sequential | soft | broadcast | manual', false),
  ('dispatch.radius_m',                     '3000',   'Initial search radius (m)', false),
  ('dispatch.radius_step_m',                '2000',   'Radius growth per dispatch round (m)', false),
  ('dispatch.max_radius_m',                 '8000',   'Maximum search radius (m)', false),
  ('dispatch.offer_timeout_seconds',        '20',     'Seconds a driver has to accept an offer', true),
  ('dispatch.broadcast_size',               '5',      'Drivers offered simultaneously in broadcast mode', false),
  ('dispatch.search_timeout_seconds',       '300',    'Give up searching after this many seconds', true),
  ('dispatch.location_fresh_seconds',       '45',     'A driver position older than this is stale', true),
  ('dispatch.auto_offline_seconds',         '600',    'Idle drivers without GPS for this long go offline', false),
  ('dispatch.show_destination_before_accept','true',  'Show destination in offers before acceptance', false),
  ('booking.max_stops',                     '3',      'Maximum intermediate stops', true),
  ('booking.confirmation_ttl_seconds',      '900',    'Unconfirmed bookings expire after this', false),
  ('fare.estimate_ttl_seconds',             '600',    'Fare quote validity', true),
  ('fare.road_factor',                      '1.35',   'Straight-line → road distance factor when routing is unavailable', false),
  ('fare.fallback_speed_kmh',               '22',     'Average speed for fallback duration estimate', false),
  ('fare.min_track_coverage',               '0.7',    'GPS track must cover this share of the estimate to be billed', false),
  ('fare.max_distance_ratio',               '1.6',    'Billed distance cap as multiple of estimate', false),
  ('bidding.enabled',                       'true',   'Global bidding switch', true),
  ('bidding.window_seconds',                '60',     'How long drivers can respond to a bidding request', true),
  ('bidding.counter_ttl_seconds',           '60',     'Validity of a driver counter-offer', true),
  ('gps.max_accuracy_m',                    '150',    'Reject GPS fixes worse than this', true),
  ('gps.min_interval_seconds',              '3',      'Server-side throttle between fixes', true),
  ('gps.billing_accuracy_m',                '50',     'Only fixes better than this count toward billed distance', false),
  ('trip.arrival_radius_m',                 '250',    'Driver must be within this distance to mark arrived', true),
  ('trip.no_show_wait_minutes',             '5',      'Minutes after arrival before a no-show can be declared', true)
on conflict (key) do nothing;

-- Greater Monrovia service area (Bushrod Island → Paynesville/ELWA, Brewerville → Congo Town).
-- Coarse polygon for launch; refine in Admin.
insert into public.geofences(code, name, kind, area)
values ('greater_monrovia', 'Greater Monrovia', 'service_area',
  extensions.st_multi(extensions.st_geomfromtext(
    'POLYGON((-10.900 6.200, -10.560 6.200, -10.560 6.440, -10.900 6.440, -10.900 6.200))', 4326))::extensions.geography)
on conflict (code) do nothing;

-- One-time bootstrap of the first super administrator (service role only; no-op once one exists).
create or replace function public.bootstrap_super_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if exists (select 1 from public.user_roles where role = 'super_admin') then
    return false;
  end if;
  insert into public.user_roles(user_id, role) values (p_user_id, 'super_admin'), (p_user_id, 'admin')
  on conflict do nothing;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id)
  values (null, 'system', 'role.bootstrap_super_admin', 'user_roles', p_user_id::text);
  return true;
end;
$$;
revoke execute on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid) to service_role;
