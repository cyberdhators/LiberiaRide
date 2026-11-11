# Implementation checklist

Status as of 11 Nov 2026. ✅ done and verified · 🟡 built, waiting on something external · ⬜ not started · ⏸ paused.

## Platform

| Item | Status | Notes |
|---|---|---|
| Monorepo (Next.js 16 app + `shared`, `geospatial`, `database` packages) | ✅ | npm workspaces |
| Supabase schema, 39 migrations, PostGIS, pg_cron, pg_net, Vault | ✅ | applied to dev project `ymohklpojfyrlptiwvjr` |
| RLS on every table, locked-down function privileges | ✅ | security advisor clean except intentional client RPCs |
| Generated database types | ✅ | `packages/database/src/types.ts` |
| CI (migration parse, unit tests, typecheck, build) | ✅ | green on GitHub; `.github/workflows/ci.yml`; real-DB job needs `RUN_DB_TESTS` + dev secrets |
| Vercel deployment | 🟡 | waiting for the go-ahead; see [DEPLOYMENT.md](DEPLOYMENT.md) |
| Production Supabase project | ⬜ | separate project, same region |

## Engines

| Item | Status | Notes |
|---|---|---|
| Booking state machine, every transition validated and logged | ✅ | SQL ↔ TypeScript parity test |
| Server-side fares (USD / LRD), coupons, promotions | ✅ | fare values are **placeholders** until real prices are set |
| Dispatch: nearest, sequential, soft, broadcast, manual, bidding | ✅ | 3 concurrent accepts → exactly one winner (integration test) |
| Idempotency on booking creation | ✅ | concurrent duplicate requests → one booking |
| Trust: start-ride PIN, GPS-verified arrival/no-show, upfront price, billing on distance actually driven | ✅ | migration 0026 |
| Fair acceptance rate (lost broadcast offers not counted), trip GPS retention 90 days | ✅ | migration 0026 |
| Driver "Cancel — reassign" works (was blocked by a constraint); PIN tries reset for the next driver | ✅ | migration 0027 |
| Push alerts: ride requests (urgent, vibrate, stay on screen), driver assigned/arrived, all notifications | ✅ | migration 0028 + Edge Function `push-dispatch`; verify on a real phone |
| Never miss a ride: in-page sound alert, 10–30 s polling when Realtime drops, refresh on focus/reconnect | ✅ | |
| Offline GPS: fixes queued on the phone during network gaps, uploaded with `driver_upload_track` before billing | ✅ | migration 0028 |
| Installable app (manifest, PNG/maskable/Apple icon) and offline page | ✅ | service worker `public/sw.js` |
| Driver wallet: one balance per currency (earnings − cash held + top-ups + fee credits), shown on Earnings and in Finance | ✅ | migration 0029 |
| Commission debt limit: over-limit drivers can't go online and get no offers until a top-up is recorded | ✅ | `wallet.max_debt_minor_usd/lrd` (placeholders: US$25 / L$4,500) |
| Top-ups recorded by finance (receipt reference, idempotent, audited); self-serve MoMo top-up when credentials arrive | 🟡 | |
| Unpaid cancellation/no-show fees shown before booking and collected with the next fare; cancelled-on driver credited fee − commission | ✅ | migration 0029 |
| Finance: waive a disputed fee (reason, audited, passenger notified); correct a driver balance up or down; fee commission counted as income | ✅ | migration 0030 |
| Scheduled rides: 30 min–7 days ahead, price locked, released to dispatch 15 min before; max 3 upcoming; free cancel | ✅ | migrations 0031–0032 |
| Book for someone else: rider name + phone (passenger-only table), driver sees rider, share PIN + trip link (share sheet — no SMS provider yet) | ✅ | migration 0033 |
| Busy-hour pricing: windows by day/time/zone, ×1.05–3.00, shown before booking, upfront price kept | ✅ | migration 0034 |
| Referrals: personal code, friend's code once before first trip, 20% one-ride coupon for both, monthly cap | ✅ | migration 0035 |
| Call-centre booking (`/admin/bookings/new`): account found/created by phone, QLS-priced, booked as the operator (audited), no PIN | ✅ | migration 0036 |
| Realtime (private broadcast channels) | ✅ | |
| Audit log | ✅ | |

## Location (QLS)

| Item | Status | Notes |
|---|---|---|
| Address / place search, directions | ✅ | verified against live API |
| Ping lookup, driver distance | 🟡 | implemented to the documented shape; not yet exercised live |
| Map tiles (gap) | ✅ | MapLibre + OpenFreeMap adapter |
| Reverse geocoding (gap) | ✅ | landmark aliases + cache adapter |

## Apps

| Item | Status |
|---|---|
| Passenger: map-first booking, multi-stop, prices, promo, offers, live tracking, chat, SOS, share, receipt, rating | ✅ |
| Driver: registration + documents, online/offline, GPS, offers, trip operations, cash, earnings | ✅ |
| Admin: KPIs, live map, drivers, bookings + manual assign, passengers, safety, finance, fares/promotions/config/landmarks, audit | ✅ |
| Sign-in by email link or code (`/auth/callback`) | ✅ |
| Sign-in by SMS | 🟡 needs an SMS provider in Supabase Auth |
| Staff & roles page (`/admin/staff`): grant/revoke support agent, fleet operator, admin (super admin only) | ✅ |
| Saved places (Home, Work, named; from GPS, search or a starred recent trip) | ✅ |
| In-app notifications (`/notifications`, live unread badge via Realtime) | ✅ |
| Fleets: admin creates a fleet for an owner; drivers join by code (Earnings page); operator console `/fleet` (drivers, 7-day earnings, remove, rotate code) | ✅ |
| Ride types & service areas (`/admin/areas`): edit/add types (must be priced to offer), GeoJSON areas on a map, last service area protected | ✅ |
| Avatar upload, vehicle switching, document-expiry reminders, refunds, geofence events | ⬜ |

## Payments and messaging

| Item | Status | Notes |
|---|---|---|
| Cash | ✅ | |
| MTN MoMo | 🟡 | implemented; needs merchant credentials |
| Orange Money | 🟡 | disabled until official Liberia API docs are available |
| WhatsApp booking | ⏸ | code kept, channel paused |

## Tests

| Suite | Status |
|---|---|
| Unit (Vitest): 68 tests (incl. VAPID signing, scheduled state machine) | ✅ |
| Real-DB integration (`RUN_DB_TESTS=1`) | ✅ |
| SQL lifecycle/security test (`supabase/tests/lifecycle_test.sql`) | ✅ `FAILURES: []` |
| SQL role-management test (`supabase/tests/roles_test.sql`) | ✅ `FAILURES: []` |
| SQL fleet test (`supabase/tests/fleet_test.sql`) | ✅ `FAILURES: []` (19 checks) |
| SQL areas test (`supabase/tests/areas_test.sql`) | ✅ `FAILURES: []` |
| SQL push & offline-track test (`supabase/tests/push_test.sql`) | ✅ `FAILURES: []` |
| SQL wallet & fee carry-over test (`supabase/tests/wallet_test.sql`) | ✅ `FAILURES: []` (35 checks) |
| SQL fee waiver & adjustment test (`supabase/tests/finance_ops_test.sql`) | ✅ `FAILURES: []` |
| SQL group 4 tests (`scheduled_test`, `rider_test`, `surge_test`, `referral_test`, `phone_booking_test`) | ✅ `FAILURES: []` |
| SQL trust & billing test (`supabase/tests/trust_test.sql`) | ✅ `FAILURES: []` (33 checks, incl. lockout → reassign → new driver starts) |
| Browser E2E (Playwright): home, auth redirect, book → cancel, save Home, live notification, fleet join/remove, admin ride types & areas, installable app + offline page, finance top-up/correction, schedule for someone else, busy hours, referral code, call-centre booking | ✅ 13/13 |

## Quality, later

Error tracking (Sentry), load testing, accessibility audit.

## Needs the owner

1. "Deploy" to publish a Vercel preview.
2. Real fares, an SMS provider, MTN MoMo credentials, Orange Money documentation.
