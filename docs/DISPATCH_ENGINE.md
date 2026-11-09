# Dispatch engine

Implemented in `supabase/migrations/…_dispatch.sql`; driven event-first (confirm, reject, driver
cancel) and by `run_dispatch_maintenance()` every 5 seconds via pg_cron.

## Eligibility (`find_eligible_drivers`)

A driver can receive an offer only if **all** hold:

* `drivers.status = 'approved'`, `is_online`, profile not suspended
* current vehicle `approved`, active, and of the booking's **category**
* last position **fresh**: `received_at > now() − dispatch.location_fresh_seconds` (45 s)
* within the round's **radius** of the pickup (`ST_DWithin` on a GiST index)
* not the passenger, no active assignment, no pending offer anywhere,
  not soft-reserved by another booking, and never offered this booking before

Radius per round = `min(radius_m + round × radius_step_m, max_radius_m)` → 3 km, 5 km, 7 km, 8 km…

## Strategies (`dispatch.default_strategy`, admin-configurable)

| Strategy | Behaviour |
|---|---|
| `nearest` | One offer per round to the closest eligible driver (re-ranked every round). |
| `sequential` | One offer per round, ranked by ETA band (500 m buckets), then longest idle, then acceptance rate — fairer queue. |
| `soft` *(default)* | Like `nearest`, plus a **provisional reservation**: `bookings.reserved_driver_id/reserved_until` hold the booking for that driver for the offer timeout. Passenger sees "a driver is reviewing your request". Released on reject/expiry, confirmed atomically on accept. |
| `broadcast` | Offers to up to `dispatch.broadcast_size` (5) drivers at once; first accept wins. Used automatically for **bidding**. |
| `manual` | No automatic offers; the booking waits in the admin queue for `admin_assign_driver`. |

## Offer lifecycle

`pending` → `accepted` | `rejected` | `expired` (cron) | `cancelled` (assigned elsewhere / booking cancelled /
driver offline). Offer timeout: `dispatch.offer_timeout_seconds` (20 s); bidding window 60 s.
Offers are denormalised (pickup, destination if allowed, fare, distances) so drivers never need read access
to the booking row — and RLS gives them none until they are assigned.

## Concurrency guarantees

* **Lock order** everywhere: `bookings` row → `drivers` row → offer/bid rows (no deadlock cycles).
* `accept_offer` re-reads the offer and booking **under `FOR UPDATE`**, then checks status, expiry, booking state
  and driver eligibility before assigning.
* **Partial unique indexes** make double allocation impossible even if a code path were wrong:
  `booking_assignments_one_active_per_booking`, `…_per_driver`, `bookings_one_active_per_driver`,
  `booking_offers_one_pending_per_driver`.
* Verified on the real database: 3 drivers accepting the same broadcast booking simultaneously →
  exactly 1 success, 2 failures, 1 active assignment (`apps/web/tests/integration`).

## Bidding

1. Passenger offers a price within `[bid_min_pct, bid_max_pct]` of the estimate (per fare rule; global switch
   `bidding.enabled`). Booking uses `broadcast`.
2. Drivers either **accept** (price = passenger offer) or **counter** (`driver_counter_bid`, same bounds,
   TTL `bidding.counter_ttl_seconds`). Counters reach the passenger on `booking:<id>`.
3. Passenger `passenger_accept_bid` → atomic assignment at the agreed price (fixed-price trip).

## Manual allocation

`admin_assignable_drivers(booking)` lists fresh, free, category-matching drivers by distance;
`admin_assign_driver` requires `bookings.assign`, writes an audit entry and notifies the driver.

## Maintenance loop (`run_dispatch_maintenance`, every 5 s)

1. Expire pending offers/bids past `expires_at`; release soft reservations.
2. Expire unconfirmed bookings (15 min).
3. For each searching booking: expire after `dispatch.search_timeout_seconds` (passenger notified) or run another round.
4. Take drivers offline after `dispatch.auto_offline_seconds` (600 s) without GPS (when not on a trip).

Rows are processed with `FOR UPDATE SKIP LOCKED`, so the loop never blocks user actions.
