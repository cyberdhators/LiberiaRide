# Setup & deployment

## Environments

| | Supabase project | Vercel | Branch |
|---|---|---|---|
| Development | `ymohklpojfyrlptiwvjr` (eu-west-1) — current | Preview deployments | every PR / non-main branch |
| Production | **to create** (separate project, same region) | Production | `main` (with deployment protection) |

Never point preview deployments at the production database.

## Local development

```bash
npm ci
cp apps/web/.env.example apps/web/.env.local   # fill in values
npm run dev                                     # http://localhost:3000
npx vitest run                                  # unit tests
RUN_DB_TESTS=1 npx vitest run apps/web/tests/integration   # real-DB tests (dev project only)
npm run db:lint                                 # parse all migrations
npm run build
```

## Database migrations

Migrations are versioned in `supabase/migrations/` and applied in filename order.

* With the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
* Or via the Supabase MCP / SQL editor (how the dev project was built).
* After applying, regenerate types into `packages/database/src/types.ts` (`supabase gen types typescript`).
* Then run the rolled-back lifecycle test: `supabase/tests/lifecycle_test.sql` → expect `"FAILURES": []`.
* Run the security advisor (Supabase dashboard → Advisors); only intentional client RPCs should remain.

**Note:** the dev project's migration history was recorded by MCP with apply-time version numbers, so
`supabase db push` against dev would try to re-apply. For dev, keep using MCP/SQL; for a new production
project, `supabase db push` from a clean state works.

## Supabase settings (dashboard)

1. **Auth → URL configuration:** Site URL = production URL; add `https://*.vercel.app/**` (previews) and
   `http://localhost:3000/**` to redirect URLs.
2. **Auth → Providers → Phone:** enable and configure an SMS provider (Twilio, Vonage, MessageBird, Textlocal)
   for phone OTP. Until then users sign in by email (link or code). Add test phone numbers for QA.
3. **Auth → Email templates → Magic link:** optionally add `{{ .Token }}` so users can type the code
   instead of opening the link.
4. **Auth → Rate limits:** keep OTP limits on (protects SMS spend).
5. **Database → Extensions:** `postgis`, `pg_cron`, `pgcrypto` (enabled by migrations).
6. **First administrator:** sign in once, then run (SQL editor, as postgres):
   `select public.bootstrap_super_admin('<your auth user id>');` — works only while no super admin exists.

## Push alerts (Web Push)

Ride requests reach drivers whose screen is off through Web Push. Per Supabase project:

1. Deploy the Edge Function **without** JWT verification (it checks its own key):
   `supabase functions deploy push-dispatch --no-verify-jwt` (source: `supabase/functions/push-dispatch/`).
2. Point the database at it (Admin → Fares & config, or SQL):
   `push.dispatch_url` = `https://<project-ref>.supabase.co/functions/v1/push-dispatch`.
3. Set `push.vapid_subject` to a real contact (`mailto:` address or `https://` site) — push services use it
   to reach the operator.

Nothing else is configured by hand: migration 0028 stores the database→function key in Vault
(`push_invoke_key`), and the function generates the VAPID key pair on its first run (Vault `push_vapid`).
Leaving `push.dispatch_url` empty switches push off; the in-app sound, polling and Realtime still work.
iPhone users must add LiberiaRide to the Home Screen before alerts can be turned on (iOS 16.4+).

## Vercel

1. Import the GitHub repo `cyberdhators/LiberiaRide`.
2. **Root Directory:** `apps/web` (framework: Next.js). Install command can stay default; npm workspaces resolve
   `@liberia-ride/*` packages from the repo root.
3. Environment variables (Production and Preview separately):

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | per environment |
| `NEXT_PUBLIC_SITE_URL` | public | e.g. `https://liberiaride.com` |
| `SUPABASE_SECRET_KEY` | server | **sensitive** |
| `QLS_API_KEY`, `QLS_BASE_URL`, `QLS_LIBERIA_COUNTRY_ID` | server | sensitive |
| `MTN_MOMO_*` | server | when onboarded |
| `NEXT_PUBLIC_MAP_STYLE_URL` | public | optional |
| `CRON_SECRET` | server | only if WhatsApp is re-enabled |

4. **Deployment protection:** enable Vercel Authentication for previews; production protected by branch rules
   (require CI to pass on `main`).
5. Region: choose the Vercel function region closest to Supabase (`dub1`/Dublin for eu-west-1).

## CI

`.github/workflows/ci.yml` runs on every push/PR: migration parse, unit tests, typecheck, production build.
The real-DB job runs when the repo variable `RUN_DB_TESTS=1` and secrets `DEV_SUPABASE_URL`,
`DEV_SUPABASE_PUBLISHABLE_KEY`, `DEV_SUPABASE_SECRET_KEY` are set (dev project only).

## Monitoring

* `GET /api/health` → DB reachability + which integrations are configured (for uptime monitors).
* Vercel runtime logs / errors; Supabase logs + advisors.
* `qls_usage` table + Admin overview "QLS calls (24 h)" — credit consumption (≈ US$0.10/call).
* `cron.job_run_details` for the 5-second dispatch job.
* Recommended next: an error tracker (e.g. Sentry) wired in `instrumentation.ts`.

## Cleanup helpers

`node scripts/cleanup-test-users.mjs` removes `*@liberiaride.test` users left by an interrupted integration run.
