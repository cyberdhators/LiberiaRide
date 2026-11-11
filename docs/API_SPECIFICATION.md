# API specification

Two surfaces:

1. **Supabase RPCs** called directly from browsers with the user's JWT (`supabase.rpc(name, args)`).
   Authorisation is inside each function. Errors use SQLSTATE: `22023` validation, `42501` permission,
   `P0002` not found, `55000` state conflict, `23514` invalid transition, `28000` sign-in required.
2. **Next.js route handlers** (`/api/*`) for work that needs server secrets (QLS, service role, payments).
   JSON in/out; errors are `{ "error": { "message", "code" } }`; all responses `Cache-Control: no-store`.

## Route handlers

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/geo/search` | session | `{ q: string(3..120), kind?: "auto"\|"place"\|"address" }` | `{ results: ResolvedLocation[], source, notice? }`; 404 `place_not_found`, 429 budget, 503 QLS unavailable |
| `POST /api/geo/ping` | session | `{ pin: share-link \| id }` | `{ result: ResolvedLocation }`; 409 `ping_inactive` |
| `POST /api/geo/reverse` | session | `{ lat, lng }` | `{ result }` — landmark/cache label or "Pinned location"; never calls QLS |
| `POST /api/fares/estimate` | session | `{ pickup, dropoff, stops[≤3], categories[], currency: "USD"\|"LRD", coupon? }` (points: `{lat,lng,address,qlsRef?}`) | `{ estimates: [{ category, estimateId, totalMinor, subtotalMinor, discountMinor, distanceM, durationS, routeSource, expiresAt } \| { category, error }], route, notice }` |
| `POST /api/payments/initiate` | session (payer) | `{ bookingId, msisdn }` | `{ status: "initiated" }`; 503 provider unavailable |
| `POST /api/payments/status` | session (payer) | `{ bookingId }` | `{ status, reason? }` (verified with provider) |
| `POST\|PUT /api/payments/{provider}/callback` | none (untrusted hint) | provider body | `{ ok: true }` — re-verifies with provider |
| `GET /api/health` | none | — | `{ status, database, qls, payments, … }` (presence only, never values) |
| `GET/POST /api/whatsapp/webhook` | Meta verify token / `X-Hub-Signature-256` | — | **paused** (503 until configured) |
| `GET /api/whatsapp/outbox` | `Bearer CRON_SECRET` | — | **paused** |
| `POST /auth/signout` | session | — | 303 → `/` |

`ResolvedLocation = { point: {lat,lng}, label, source: "qls_place"|"qls_address"|"qls_ping"|"alias"|"pin", qlsRef?, details? }`

## RPCs (authenticated)

### Passenger
| RPC | Args | Notes |
|---|---|---|
| `create_fare_estimate` | category, currency, pickup/dropoff lat/lng/address, stops jsonb, qls refs, coupon | geodesic fallback estimate |
| `create_booking` | `p_estimate_id, p_payment_method, p_idempotency_key, p_confirm=true, p_passenger_offer_minor?, p_note?` | idempotent; returns booking |
| `confirm_booking` | booking id | idempotent |
| `passenger_cancel_booking` | booking id, reason | fee after grace |
| `passenger_accept_bid` / `passenger_reject_bid` | bid id | atomic assignment |
| `passenger_switch_to_cash` | booking id | unpaid mobile money → cash |
| `get_booking_view` | booking id | party-scoped JSON view |
| `rate_booking` | booking, score 1–5, tags, comment | once per direction, 7-day window |
| `raise_sos`, `report_incident`, `file_complaint` | … | |
| `my_saved_locations`, `save_location`, `nearest_place_label`, `search_address_aliases`, `nearby_driver_count` | … | read models |

### Driver
| RPC | Notes |
|---|---|
| `register_driver`, `register_vehicle`, `submit_driver_document` | onboarding (documents must exist in storage under `<uid>/`) |
| `driver_set_online(bool)` | requires approval, approved vehicle, licence + registration approved, fresh GPS |
| `driver_update_location(lat, lng, accuracy, heading?, speed?, recorded_at?)` | returns `{accepted, reason?}`; reasons: `throttled`, `low_accuracy`, `stale_fix`, `implausible_jump`, `not_approved` |
| `driver_dashboard()` | status, vehicle, documents, location, pending offers, active booking, today |
| `accept_offer`, `reject_offer`, `driver_counter_bid` | dispatch |
| `driver_mark_arriving`, `driver_mark_arrived`, `driver_record_stop`, `driver_complete_trip` | trip; arrival needs a fresh GPS fix within `trip.arrival_radius_m` |
| `driver_start_trip(booking, pin?)` | returns `{ok, reason?, attempts_left?}`; web bookings need the passenger's 4-digit ride PIN (`booking_start_pins`, passenger-readable only); wrong tries are counted, 5 lock it (driver reassigns). Other channels need proximity to the pickup |
| `driver_confirm_cash_collected(booking, amount_minor)` | reconciliation |
| `driver_cancel_booking(booking, reason)` | re-dispatch to another driver (PIN tries reset), or `passenger_no_show` fee after the wait — needs a fresh GPS fix at the pickup |
| `driver_upload_track(booking, points[])` | up to 300 buffered GPS fixes taken during an in-progress trip; same accuracy/plausibility rules as live updates; returns `{accepted, rejected}` |
| `push_subscribe(endpoint, p256dh, auth, ua?)`, `push_unsubscribe(endpoint)`, `push_public_key()`, `push_take_recent()` | phone alerts (any signed-in user); endpoints limited to real push services |
| `driver_wallet()` | own balance per currency, debt limit, `blocked`, recent entries |
| `my_outstanding_fees()` | passenger's unpaid cancellation fees per currency (added to the next fare) |
| `driver_join_fleet(code)`, `driver_leave_fleet()` | fleet membership (driver consent via the fleet join code) |

### Operations (permission-checked, audited)
`admin_review_driver`, `admin_review_vehicle`, `admin_review_document`, `admin_set_user_suspension`,
`admin_set_role`, `admin_assign_driver`, `admin_assignable_drivers`, `admin_cancel_booking`,
`admin_driver_balances` (finance.view), `admin_record_driver_topup` (finance.manage; idempotent on reference),
`admin_upsert_fare_rule`, `admin_create_promotion`, `admin_set_promotion_active`, `admin_set_config`,
`admin_upsert_alias`, `admin_update_case`, `admin_reconcile_cash`, `admin_create_settlement`,
`admin_mark_settlement_paid`, `admin_dashboard_stats`, `admin_live_map`,
`admin_create_fleet(owner, name, phone?)` (makes the owner a fleet operator), `admin_set_fleet_active`, `admin_set_driver_fleet`.

`admin_set_role` rules: only a super admin changes `admin`/`super_admin`; `passenger`/`driver` are not managed here;
you cannot remove your own admin role; the last super admin cannot be removed; no roles for suspended accounts.

### Fleet operator
`fleet_overview()` (own fleets, drivers, 7-day trips and net earnings), `fleet_remove_driver(driver)`,
`fleet_regenerate_code(fleet)`. Operators read their drivers' rows, earnings and settlements through RLS.

### Anonymous
`get_shared_trip(token)`.

### Service role only (server)
`create_fare_estimate_routed`, `create_fare_estimate_for`, `_create_booking`, `dispatch_booking`,
`run_dispatch_maintenance`, `payment_mark_initiated`, `payment_record_result`, `whatsapp_*`,
`bootstrap_super_admin`.

## Realtime topics (private broadcast)

| Topic | Events | Subscribers |
|---|---|---|
| `booking:<id>` | `booking_status`, `driver_location`, `bid`, `chat` | passenger, assigned driver, staff |
| `driver:<uid>` | `offer`, `bid` | that driver |
| `user:<uid>` | `notification` | that user |
| `admin:ops` | `booking_status`, `sos`, `incident` | staff |
| `admin:fleet` | `driver_location` | staff |

Join with `supabase.channel(topic, { config: { private: true } })` after `realtime.setAuth(jwt)`.
