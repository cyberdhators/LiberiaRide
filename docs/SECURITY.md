# Security

## Secrets

| Secret | Where | Never |
|---|---|---|
| `SUPABASE_SECRET_KEY` (service role) | Vercel env (server), `.env.local` | in client bundles (`lib/server-env.ts` and `lib/supabase/admin.ts` import `server-only`) |
| `QLS_API_KEY` | server only | sent to browsers; each call costs credit |
| `MTN_MOMO_*`, `ORANGE_MONEY_*` | server only | logged (payloads pass through `redact()`) |
| `WHATSAPP_*` | server only (feature paused) | |
| `CRON_SECRET` | Vercel | |

`.env*` files are git-ignored (`!.env.example` only); CI builds with placeholders.

## Roles

`passenger`, `driver`, `fleet_operator`, `support_agent`, `admin`, `super_admin` in `user_roles`;
permissions in `role_permissions` (see `…_reference_data.sql`). Every new user gets `passenger`;
`register_driver` adds `driver`; staff roles only via `admin_set_role` (`roles.manage`; only a
super-admin can grant `super_admin`). The first super-admin is created with the service-role-only
`bootstrap_super_admin(user_id)`, which refuses once one exists.

## Database enforcement

* **RLS enabled on every `public` table**; policies listed in `…_rls_and_grants.sql`.
* API roles' table privileges are revoked, then `SELECT` is granted (filtered by RLS). Direct writes exist
  only for user-owned rows and **specific columns**: profile name/email/avatar/locale/currency, passenger
  default payment, saved places, emergency contacts, notification `read_at`, chat messages.
* Everything else is a `SECURITY DEFINER` RPC with `search_path` pinned (`public, extensions, pg_temp`;
  `CREATE` on `public` revoked from API roles so the path cannot be hijacked). Each RPC calls
  `require_active_user()` or `require_permission(code)` first.
* `EXECUTE` is revoked from `PUBLIC/anon/authenticated` for all functions and granted one by one; Supabase's
  global default privileges are overridden (0017) so new functions start private.
* Privileged actions write `audit_logs` (actor, roles, action, entity, before/after, reason).

### Things the client can never set

fare amounts · booking status · driver assignment · payment status · driver/vehicle/document
verification · commission — all computed or changed inside RPCs (tests `t01_*`, `t04_*`, `t05_*`, `t06_*`).

### Privacy

* Passengers see only their bookings; drivers only bookings **assigned** to them. Offers are
  denormalised so an offered driver never reads the booking or passenger row.
* Counter-party phone numbers are returned by `get_booking_view` only while the ride is active.
* Driver documents are in a **private** bucket under `<driver_id>/…`; staff view them via 5-minute signed URLs.
* Trip sharing uses an unguessable hex token and stops one hour after completion; it exposes first name,
  vehicle, plate and live position only.
* Location history is purged after 90 days; Realtime event log after 30 days.

## Realtime

All topics are **private**; RLS on `realtime.messages` calls `realtime_can_read(topic)`:
`user:<uid>` (self), `driver:<uid>` (self + driver role), `booking:<id>` (its passenger, its assigned
driver, staff), `admin:ops|fleet` (staff). Clients cannot publish (no insert policy) and `public.publish`
is not executable by API roles (fixed in 0017 after the security advisor flagged it).

## Web app

* Proxy refreshes sessions; layouts re-verify the user with `auth.getUser()` and check roles; the DB re-checks.
* Login redirect `next` is restricted to same-site relative paths (no open redirect).
* Security headers: HSTS, `X-Frame-Options: DENY`, `nosniff`, strict `Referrer-Policy`,
  `Permissions-Policy` (geolocation self only).
* QLS endpoints require a session and enforce per-user budgets (12/min, 150/day) from the `qls_usage` ledger.

## Payments

Provider callbacks are untrusted hints; results are recorded only after a server-side status query
(`payment_record_result`, service role). Terminal states are final; duplicates are logged and ignored.
No payment is ever marked successful without provider confirmation (cash: driver confirmation + reconciliation).

## Verification

* `supabase/tests/lifecycle_test.sql` — rolled-back end-to-end security & lifecycle test (FAILURES: []).
* `apps/web/tests/integration` — real API concurrency + RLS test.
* Supabase security advisor: remaining warnings are the intentional client RPCs (callable by signed-in users by design).

## Reporting

Report vulnerabilities privately to the repository owner; do not open public issues.
