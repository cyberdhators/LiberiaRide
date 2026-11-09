-- =====================================================================
-- LiberiaRide · 0006 · Payments, earnings, commissions, settlements
-- Payment status is only ever changed by server code (service role) after
-- provider verification, or by the driver confirming cash collection via RPC.
-- =====================================================================

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete restrict,
  payer_id           uuid not null references public.profiles(id) on delete restrict,
  method             public.payment_method not null,
  provider           text not null check (provider in ('cash', 'orange_money', 'mtn_momo')),
  status             public.payment_status not null default 'pending',
  amount_minor       bigint not null check (amount_minor >= 0),
  currency           public.currency_code not null,
  provider_reference text,
  payer_msisdn       text check (payer_msisdn is null or payer_msisdn ~ '^\+[1-9][0-9]{6,14}$'),
  idempotency_key    text not null unique,
  initiated_at       timestamptz,
  confirmed_at       timestamptz,
  failed_at          timestamptz,
  failure_reason     text,
  collected_by_driver_id uuid references public.drivers(id) on delete set null,  -- cash only
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index payments_provider_ref_uq on public.payments(provider, provider_reference) where provider_reference is not null;
create index payments_booking_idx on public.payments(booking_id);
create index payments_status_idx on public.payments(status, created_at desc);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Raw provider interactions (requests, callbacks, verifications). Secrets stripped before insert.
create table public.payment_transactions (
  id               bigint generated always as identity primary key,
  payment_id       uuid not null references public.payments(id) on delete cascade,
  kind             text not null check (kind in ('initiate', 'verify', 'webhook', 'refund', 'manual')),
  provider_status  text,
  http_status      integer,
  signature_valid  boolean,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index payment_transactions_payment_idx on public.payment_transactions(payment_id, id);

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.payments(id) on delete restrict,
  amount_minor       bigint not null check (amount_minor > 0),
  currency           public.currency_code not null,
  reason             text not null,
  status             public.payment_status not null default 'pending',
  provider_reference text,
  requested_by       uuid references public.profiles(id) on delete set null,
  approved_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index refunds_payment_idx on public.refunds(payment_id);
create trigger refunds_updated_at before update on public.refunds
  for each row execute function public.set_updated_at();

create table public.driver_settlements (
  id                   uuid primary key default gen_random_uuid(),
  driver_id            uuid not null references public.drivers(id) on delete restrict,
  currency             public.currency_code not null,
  period_start         timestamptz not null,
  period_end           timestamptz not null,
  gross_minor          bigint not null default 0,
  commission_minor     bigint not null default 0,
  cash_collected_minor bigint not null default 0,   -- cash the driver already holds
  net_payable_minor    bigint not null default 0,   -- >0 platform owes driver; <0 driver owes platform
  status               public.settlement_status not null default 'draft',
  paid_at              timestamptz,
  payout_reference     text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint driver_settlements_period check (period_end > period_start)
);
create index driver_settlements_driver_idx on public.driver_settlements(driver_id, period_end desc);
create trigger driver_settlements_updated_at before update on public.driver_settlements
  for each row execute function public.set_updated_at();

create table public.driver_earnings (
  id               uuid primary key default gen_random_uuid(),
  driver_id        uuid not null references public.drivers(id) on delete restrict,
  booking_id       uuid not null unique references public.bookings(id) on delete restrict,
  currency         public.currency_code not null,
  gross_minor      bigint not null check (gross_minor >= 0),
  commission_minor bigint not null check (commission_minor >= 0),
  net_minor        bigint not null,
  payment_method   public.payment_method not null,
  settlement_id    uuid references public.driver_settlements(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint driver_earnings_math check (net_minor = gross_minor - commission_minor)
);
create index driver_earnings_driver_idx on public.driver_earnings(driver_id, created_at desc);
create index driver_earnings_unsettled_idx on public.driver_earnings(driver_id) where settlement_id is null;

create table public.platform_commissions (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null unique references public.bookings(id) on delete restrict,
  driver_id     uuid not null references public.drivers(id) on delete restrict,
  currency      public.currency_code not null,
  fare_minor    bigint not null check (fare_minor >= 0),
  rate_bps      integer not null check (rate_bps between 0 and 10000),
  amount_minor  bigint not null check (amount_minor >= 0),
  created_at    timestamptz not null default now()
);
create index platform_commissions_driver_idx on public.platform_commissions(driver_id, created_at desc);

create table public.cash_reconciliation (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.drivers(id) on delete restrict,
  booking_id          uuid references public.bookings(id) on delete set null,
  settlement_id       uuid references public.driver_settlements(id) on delete set null,
  currency            public.currency_code not null,
  expected_minor      bigint not null check (expected_minor >= 0),
  collected_minor     bigint check (collected_minor >= 0),
  variance_minor      bigint generated always as (coalesce(collected_minor, 0) - expected_minor) stored,
  status              public.reconciliation_status not null default 'pending',
  note                text,
  reconciled_by       uuid references public.profiles(id) on delete set null,
  reconciled_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index cash_reconciliation_booking_uq on public.cash_reconciliation(booking_id) where booking_id is not null;
create index cash_reconciliation_driver_idx on public.cash_reconciliation(driver_id, status);
create trigger cash_reconciliation_updated_at before update on public.cash_reconciliation
  for each row execute function public.set_updated_at();
