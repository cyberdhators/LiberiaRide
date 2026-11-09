# Implementation checklist

Status as of 9 Nov 2026. ✅ done and verified · 🟡 built, waiting on something external · ⬜ not started · ⏸ paused.

## Platform

| Item | Status | Notes |
|---|---|---|
| Monorepo (Next.js 16 app + `shared`, `geospatial`, `database` packages) | ✅ | npm workspaces |
| Supabase schema, 22 migrations, PostGIS, pg_cron | ✅ | applied to dev project `ymohklpojfyrlptiwvjr` |
| RLS on every table, locked-down function privileges | ✅ | security advisor clean except intentional client RPCs |
| Generated database types | ✅ | `packages/database/src/types.ts` |
| CI (migration parse, unit tests, typecheck, build) | ✅ | `.github/workflows/ci.yml`; real-DB job needs `RUN_DB_TESTS` + dev secrets |
| Vercel deployment | 🟡 | waiting for the go-ahead; see [DEPLOYMENT.md](DEPLOYMENT.md) |
| Production Supabase project | ⬜ | separate project, same region |

## Engines

| Item | Status | Notes |
|---|---|---|
| Booking state machine, every transition validated and logged | ✅ | SQL ↔ TypeScript parity test |
| Server-side fares (USD / LRD), coupons, promotions | ✅ | fare values are **placeholders** until real prices are set |
| Dispatch: nearest, sequential, soft, broadcast, manual, bidding | ✅ | 3 concurrent accepts → exactly one winner (integration test) |
| Idempotency on booking creation | ✅ | concurrent duplicate requests → one booking |
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
| Role management page (make staff without SQL) | ⬜ |
| Save Home / Work, in-app notifications list | ⬜ |
| Fleet operator pages | ⬜ |
| Categories / service-area editor, avatar upload, vehicle switching, document-expiry reminders, refunds, geofence events | ⬜ |

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
| Unit (Vitest): 65 tests | ✅ |
| Real-DB integration (`RUN_DB_TESTS=1`) | ✅ |
| SQL lifecycle/security test (`supabase/tests/lifecycle_test.sql`) | ✅ `FAILURES: []` |
| Browser E2E (Playwright): home, auth redirect, book → cancel | ✅ 3/3 |

## Quality, later

Error tracking (Sentry), PWA/offline shell, load testing, accessibility audit.

## Needs the owner

1. Your sign-in email, to make you the first super admin (`bootstrap_super_admin`).
2. "Deploy" to publish a Vercel preview.
3. Real fares, an SMS provider, MTN MoMo credentials, Orange Money documentation.
