# LiberiaRide

Web-first ride-hailing for Liberia, starting in Monrovia. Passenger app, driver app and operations
dashboard in one Next.js project on Supabase, with Quantum Location Services (QLS) for location.

| Area | Route | Highlights |
|---|---|---|
| Passenger | `/passenger` | Map-first booking from landmarks, QLS addresses, Pings or a pin; multi-stop; Keke/Car/Comfort/XL; USD or LRD; promo codes; price offers; live tracking; chat, SOS, trip sharing; receipt & rating |
| Driver | `/driver` | Registration with private document upload; online/offline; live GPS with freshness + honest background warning; offers with countdown, accept/decline/counter; full trip operations; cash confirmation; earnings & settlements |
| Operations | `/admin` | KPIs, live ops feed with SOS alerts, live fleet map, driver review, bookings with state/allocation history and manual assignment, passengers, safety & complaints, finance, fares/promotions/config/landmarks, audit log |

**Status (9 Nov 2026):** core platform built and verified on the development Supabase project.
Mobile money (MTN MoMo) is implemented but awaits merchant credentials; Orange Money awaits official
documentation; WhatsApp booking is **paused**. See [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + PostGIS, Auth, Realtime, Storage, pg_cron) ·
MapLibre (map rendering gap adapter) · QLS · Vitest · GitHub Actions · Vercel.

## Quick start

```bash
npm ci
cp apps/web/.env.example apps/web/.env.local   # add Supabase + QLS keys
npm run dev
```

Tests: `npx vitest run` (unit) · `RUN_DB_TESTS=1 npx vitest run apps/web/tests/integration` (real DB) ·
`supabase/tests/lifecycle_test.sql` (rolled-back SQL lifecycle/security test).

## Documentation

* [Architecture](docs/ARCHITECTURE.md)
* [Database schema & ERD](docs/DATABASE_SCHEMA.md)
* [QLS integration & capability matrix](docs/QLS_INTEGRATION.md)
* [Booking lifecycle](docs/BOOKING_LIFECYCLE.md)
* [Dispatch engine](docs/DISPATCH_ENGINE.md)
* [Security](docs/SECURITY.md)
* [API specification](docs/API_SPECIFICATION.md)
* [Payments](docs/PAYMENTS.md)
* [Setup & deployment](docs/DEPLOYMENT.md)
* [Implementation checklist](docs/CHECKLIST.md)

## License

See [LICENSE](LICENSE).
