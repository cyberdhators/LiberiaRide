# Payments

## Methods

| Method | Status | How it works |
|---|---|---|
| Cash | **Live** | Driver confirms the amount received (`driver_confirm_cash_collected`); `cash_reconciliation` flags variances; settlements net out commission owed. |
| MTN MoMo (Lonestar Cell MTN) | **Implemented, not configured** | MoMo Open API, Collections. Needs merchant onboarding + production credentials. |
| Orange Money | **Disabled — awaiting documentation** | No public Liberia merchant API spec was found; no endpoints are guessed. |

Nothing is ever marked paid without provider (or driver, for cash) confirmation. No simulated successes.

## Flow (mobile money)

1. Trip completes → `payments` row `pending` (`idempotency_key = fare:<booking>`), earnings + commission booked.
2. Passenger taps **Pay** on the receipt → `POST /api/payments/initiate` → provider request →
   `payment_mark_initiated` (status `initiated`, provider reference stored).
3. Passenger approves on their phone. Results arrive by:
   * polling `POST /api/payments/status` → server **queries the provider** → `payment_record_result`;
   * provider callback `/api/payments/{provider}/callback` → treated as a hint → server queries provider → record.
4. `succeeded` notifies the passenger; terminal states are final (late callbacks are logged only).
5. If mobile money fails, the passenger can switch to cash (`passenger_switch_to_cash`).

## MTN MoMo configuration

| Env var | Meaning |
|---|---|
| `MTN_MOMO_BASE_URL` | sandbox `https://sandbox.momodeveloper.mtn.com`; production URL issued at go-live |
| `MTN_MOMO_TARGET_ENV` | `sandbox` (EUR) for testing; `mtnliberia` in production |
| `MTN_MOMO_SUBSCRIPTION_KEY` | Collections product key (Ocp-Apim-Subscription-Key) |
| `MTN_MOMO_API_USER`, `MTN_MOMO_API_KEY` | API user + key (sandbox: create via provisioning API) |

Endpoints used: `POST /collection/token/`, `POST /collection/v1_0/requesttopay` (202 + `X-Reference-Id`),
`GET /collection/v1_0/requesttopay/{referenceId}`. Currency must match the target environment (MTN Liberia's
supported wallet currencies must be confirmed during onboarding — USD and/or LRD).

**Open items with MTN / Lonestar:** production base URL, supported currencies, callback host allow-listing, settlement account.

## Orange Money — what is needed

From Orange Money Liberia business services: the merchant API documentation (Web Payment / M Payment or the
local equivalent), sandbox access, merchant key/credentials, callback signing scheme. Then implement
`OrangeMoneyProvider.initiate/checkStatus` in `apps/web/lib/payments/orange-money.ts`.

## Settlement

`admin_create_settlement(driver, currency)` sums unsettled earnings: `net_payable = gross − commission − cash
already held by the driver` (positive → platform pays driver; negative → driver owes commission).
`admin_mark_settlement_paid(reference)` closes it. All audited.

## Refunds

`refunds` table and `payment_transactions.kind = 'refund'` exist; refund execution will be added with the
first live provider (MoMo has a separate Disbursement/refund product).
