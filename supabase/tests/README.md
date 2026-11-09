# Database tests

`lifecycle_test.sql` exercises the full booking lifecycle, dispatch, RLS isolation,
privilege boundaries, idempotency, payments and ratings against a real database.

It runs as one `DO` block that **ends by raising** `TEST_RESULT {json}`, so every change
is rolled back. Pass criteria: `"FAILURES": []` and the `t0x_*` values below.

Run (any of):
- Supabase SQL editor → paste file → Run
- Supabase MCP `execute_sql`
- `psql "$SUPABASE_DB_URL" -f supabase/tests/lifecycle_test.sql`

Last run: 2026-11-09 against project ymohklpojfyrlptiwvjr — FAILURES: [] (see docs/CHECKLIST.md).

Not covered here (needs multiple concurrent sessions): true parallel `accept_offer`
races. Exclusivity is guaranteed by row locks plus the partial unique indexes
`booking_assignments_one_active_per_booking/driver`, and the unique-violation path is
asserted (`t06_second_assignment_unique_violation`). A parallel race test lives in
`apps/web/tests/integration/concurrency.test.ts` (runs in CI with a DB URL).
