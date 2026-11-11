# Database tests

`lifecycle_test.sql` exercises the full booking lifecycle, dispatch, RLS isolation,
privilege boundaries, idempotency, payments and ratings against a real database.

It runs as one `DO` block that **ends by raising** `TEST_RESULT {json}`, so every change
is rolled back. Pass criteria: `"FAILURES": []` and the `t0x_*` values below.

Run (any of):
- Supabase SQL editor → paste file → Run
- Supabase MCP `execute_sql`
- `psql "$SUPABASE_DB_URL" -f supabase/tests/lifecycle_test.sql`

`trust_test.sql` covers migration 0026: ride PIN privacy and lockout, GPS-verified arrival,
upfront price vs. early drop-off billing, broadcast acceptance fairness and trip GPS retention.
`push_test.sql` covers migration 0028: push privileges (dispatcher RPCs service-role only), push
service allowlist, subscription/outbox privacy, offer/arrival/notification enqueueing, claim/report,
and offline track upload validation.
`wallet_test.sql` covers migration 0029: balance maths, debt limit (online + dispatch), no-show fee carried
to the next fare and credited to the cancelled-on driver, finance-only idempotent top-ups, settlement =
balance, and one push kick per transaction.

Last run: 2026-11-10 against project ymohklpojfyrlptiwvjr — lifecycle and trust tests FAILURES: [] (see docs/CHECKLIST.md).

Not covered here (needs multiple concurrent sessions): true parallel `accept_offer`
races. Exclusivity is guaranteed by row locks plus the partial unique indexes
`booking_assignments_one_active_per_booking/driver`, and the unique-violation path is
asserted (`t06_second_assignment_unique_violation`). A parallel race test lives in
`apps/web/tests/integration/concurrency.test.ts` (runs in CI with a DB URL).
