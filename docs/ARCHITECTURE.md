# Architecture

LiberiaRide is a web-first ride-hailing platform for Monrovia, Liberia. One Next.js
application serves three interfaces (passenger, driver, operations) on top of one
Supabase backend. There is no separate application server: business rules live in
PostgreSQL, and Next.js route handlers only do work that needs secrets or third-party APIs.

```
                         ┌───────────────────────── Vercel ─────────────────────────┐
 Passenger browser ─────►│ Next.js 16 (apps/web)                                    │
 Driver browser    ─────►│  /passenger  /driver  /admin   (RSC + client islands)    │
 Ops browser       ─────►│  /api/geo/*  /api/fares/estimate  /api/payments/*        │──► QLS (QuantumLoc) rideshare API
                         │  proxy.ts  (session refresh, optimistic route guard)     │──► MTN MoMo Open API (when configured)
                         └───────────┬───────────────────────────────┬──────────────┘
                                     │ user JWT (RLS)                │ service role (server only)
                         ┌───────────▼───────────────────────────────▼──────────────┐
                         │ Supabase                                                  │
                         │  Postgres + PostGIS: schema, RLS, booking engine RPCs, │
                         │    dispatch engine, fare engine, audit                    │
                         │  pg_cron: dispatch maintenance every 5 s, retention daily │
                         │  Auth: phone/email OTP                                    │
                         │  Realtime: PRIVATE broadcast topics (RLS-authorised)      │
                         │  Storage: driver-documents (private), avatars (public)    │
                         └───────────────────────────────────────────────────────────┘
```

## Principles

1. **The database is the source of truth and the policy engine.** Every state change
   (booking status, assignment, fare, payment status, driver approval) happens inside a
   `SECURITY DEFINER` PL/pgSQL function that validates the caller and the state machine in
   one transaction. Clients never write those columns (no table privilege, enforced by tests).
2. **RLS everywhere.** Every `public` table has RLS enabled; API roles get `SELECT` filtered
   by policies and a handful of column-limited writes on user-owned rows. See `SECURITY.md`.
3. **QLS is the location provider.** All geocoding, address lookup, pings and routing go to
   QuantumLoc. Gaps (map tiles, reverse geocoding) use clearly isolated adapters
   (`QLS_INTEGRATION.md` §5). Live tracking distances use PostGIS because QLS bills per call.
4. **Realtime is transport, not storage.** Clients subscribe to private topics, and on every
   (re)connect reload authoritative state over RPC. Important events are also persisted
   (`booking_events`, `realtime_events`, `notifications`).
5. **Money is integers.** All amounts are `bigint` minor units with an explicit currency
   (USD/LRD). The SQL fare engine is authoritative; a TypeScript mirror is parity-tested.
6. **Honest web limits.** Browser GPS stops when the tab is hidden. The driver UI says so,
   holds a screen wake lock, sends heartbeats, and the server treats positions older than
   45 s as stale (excluded from dispatch, greyed on maps).

## Repository layout

```
apps/web/                 Next.js app (App Router)
  app/passenger|driver|admin|share|login     UI routes
  app/api/geo/*           QLS search / ping / reverse (gap adapter)
  app/api/fares/estimate  QLS directions → routed estimate RPC
  app/api/payments/*      mobile-money initiate / verify / callback
  app/api/whatsapp/*      WhatsApp Cloud API (PAUSED — not enabled)
  components/             UI kit, map (MapLibre adapter), feature components
  lib/                    supabase clients, auth, QLS wiring, payments, errors
  proxy.ts                session refresh + optimistic redirects (Next 16 "proxy")
packages/shared           booking state machine, fare engine, money, phone, idempotency
packages/geospatial       QLS client + providers, parsing, map/reverse gap adapters
packages/database         generated Supabase types
supabase/migrations       versioned SQL (schema, RLS, engines, jobs)
supabase/tests            rolled-back lifecycle/security test
docs/                     this documentation
```

## Request flows

**Fare estimate** — browser → `POST /api/fares/estimate` → verify session → QLS directions
(cached 1 h; credit refunded by QLS when no route) → `create_fare_estimate_routed` with the
session user id (service role) → one estimate row per category. If QLS is unavailable the
user-session RPC `create_fare_estimate` computes a flagged geodesic fallback.

**Booking** — browser → `rpc create_booking(estimate, payment, idempotency_key)` → validates
estimate ownership/expiry → inserts booking in DRAFT → FARE_ESTIMATED → PENDING_CONFIRMATION →
`confirm_booking` → SEARCHING_DRIVER → `dispatch_booking` creates offers → DRIVER_OFFERED.

**Offer** — `booking_offers` insert → trigger → `realtime.send` on `driver:<uid>` → driver
console shows a countdown → `rpc accept_offer` (row locks + partial unique indexes guarantee
one winner) → DRIVER_ASSIGNED → passenger's `booking:<id>` topic updates.

**Live location** — driver `watchPosition` → `rpc driver_update_location` (validated, throttled)
→ `driver_locations` upsert + history (+ `trip_locations` during a trip) → trigger broadcasts
to `booking:<id>` (only while assigned) and `admin:fleet`.

**Completion** — `driver_complete_trip` computes the final fare server-side and writes earnings,
commission, payment and cash reconciliation rows atomically. Upfront pricing: a trip that ends
within `trip.dropoff_radius_m` of the destination is billed the quoted price plus waiting; it is
metered from the GPS track only when that track exceeds the estimate by `fare.upfront_tolerance`.
A trip that ends away from the destination is billed on the distance actually driven (GPS track or
straight line × road factor, whichever is larger), never the full estimate.

**Start-ride PIN** — every booking gets a 4-digit PIN in `booking_start_pins`, readable only by the
passenger. The driver must enter it to start a web booking; wrong attempts persist and lock after
`trip.start_pin_max_attempts`. Acceptance rate counts only offers the driver could act on
(accepted, declined, expired), not offers lost to another driver.

**Driver wallet** — `driver_balance(driver, currency)` is the single computation behind the driver's
Earnings card, the Finance page and settlements: unsettled net earnings − cash the driver collected
+ wallet entries (top-ups, cancellation-fee credits, adjustments) + unpaid settlements. A driver owing
more than `wallet.max_debt_minor_<currency>` cannot go online and is skipped by dispatch until finance
records a top-up. A passenger's unpaid cancellation fees are snapshotted onto the next booking
(`outstanding_fee_minor`), shown before confirming, collected with that fare (cash expected includes it),
and credited — minus commission — to the driver who was cancelled on.

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| UI | Next.js 16 App Router, React 19, Tailwind v4, shadcn-style primitives | RSC for fast first paint on low-end phones; small client islands |
| Maps | MapLibre GL (gap adapter) | QLS ships no tiles; open-source, no vendor key |
| DB logic | PL/pgSQL `SECURITY DEFINER` RPCs | Atomic, close to data, enforceable with RLS |
| Jobs | pg_cron (5 s) | Offer expiry / re-dispatch without an extra server |
| Realtime | Supabase Broadcast, private channels | Authorised per topic via RLS on `realtime.messages` |
| Tests | Vitest (unit, SQL parity, real-DB integration), SQL lifecycle test | See `CHECKLIST.md` |
